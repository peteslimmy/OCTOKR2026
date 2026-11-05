-- Business Unit goals: what a unit commits to for the quarter, in its own words. A weekly goal is aligned twice: to the organisation's Sub-KR
-- (as before) and to one of its own unit's goals. A Business Unit Lead keeps the list; a Super Admin may keep it for any unit that files weekly reports.
-- Once a unit has active goals for the quarter, every KR-aligned weekly goal must name one of them; a stretch goal may.

create table bu_goals (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id),
  quarter_id       uuid not null references quarters(id),
  title            text not null check (btrim(title) <> '' and char_length(title) <= 500),
  position         int  not null default 0,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_by       uuid references users(id),
  created_at       timestamptz not null default app_now(),
  updated_at       timestamptz not null default app_now()
);
create index bu_goals_unit_quarter_idx on bu_goals (business_unit_id, quarter_id);
create unique index bu_goals_title_idx on bu_goals (business_unit_id, quarter_id, lower(btrim(title))) where status = 'ACTIVE';
alter table bu_goals enable row level security;
grant select on bu_goals to authenticated;
create policy read_scoped on bu_goals for select to authenticated using (auth_can_view_bu(business_unit_id));

alter table smart_goals add column bu_goal_id uuid references bu_goals(id);
create index smart_goals_bu_goal_idx on smart_goals (bu_goal_id) where bu_goal_id is not null;

insert into permissions (code, description) values ('bu_goals.manage', 'Add, change and retire the Business Unit''s own goals for a quarter');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code in ('BU_LEAD', 'ADMIN', 'SUPER_ADMIN') and p.code = 'bu_goals.manage';

-- keep a unit's goals: p_id null adds one; p_status 'RETIRED' retires it (past weekly goals keep pointing at it), 'ACTIVE' restores it
create or replace function save_bu_goal(p_actor uuid, p_id uuid, p_bu uuid, p_quarter uuid, p_title text, p_status text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_bu uuid; v_q quarters; v_title text := btrim(coalesce(p_title, '')); v_status text := coalesce(p_status, 'ACTIVE'); g bu_goals;
begin
  perform require_permission(p_actor, 'bu_goals.manage');
  if v_status not in ('ACTIVE', 'RETIRED') then raise exception 'VALIDATION_ERROR' using detail = 'status must be ACTIVE or RETIRED'; end if;
  if v_id is not null then
    select * into g from bu_goals where id = v_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_bu := g.business_unit_id; p_quarter := g.quarter_id;
  else
    v_bu := coalesce(p_bu, actor_bu(p_actor));
  end if;
  if not actor_may_file_for(p_actor, v_bu) then raise exception 'BU_SCOPE_DENIED'; end if;
  if not (select reports_weekly from business_units where id = v_bu) then raise exception 'REPORTING_NOT_REQUIRED' using detail = 'this Business Unit does not file weekly reports'; end if;
  select * into v_q from quarters where id = p_quarter;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_q.status = 'LOCKED' then raise exception 'QUARTER_NOT_ACTIVE' using detail = 'a locked quarter is a closed record'; end if;
  if v_title = '' or char_length(v_title) > 500 then raise exception 'VALIDATION_ERROR' using detail = 'a goal needs a title of up to 500 characters'; end if;
  if v_id is null then
    insert into bu_goals (business_unit_id, quarter_id, title, position, status, created_by)
    values (v_bu, p_quarter, v_title, coalesce((select max(position) + 1 from bu_goals where business_unit_id = v_bu and quarter_id = p_quarter), 0), v_status, p_actor) returning id into v_id;
  else
    update bu_goals set title = v_title, status = v_status, updated_at = app_now() where id = v_id;
  end if;
  perform write_audit(p_actor, case when p_id is null then 'BU_GOAL_ADDED' when v_status = 'RETIRED' then 'BU_GOAL_RETIRED' else 'BU_GOAL_SAVED' end, 'bu_goal', v_id::text,
    case when p_id is null then null else jsonb_build_object('title', g.title, 'status', g.status) end, jsonb_build_object('title', v_title, 'status', v_status), null, v_bu);
  return v_id;
exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'your unit already has an active goal with that title this quarter';
end $$;

-- the unit goal named on a weekly goal must be this unit's, for this report's quarter and still active; once the unit has goals, a KR-aligned goal must name one
create or replace function assert_bu_goal_valid(p_bu_goal_id uuid, p_report_id uuid, p_goal_type text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r weekly_reports; v_quarter uuid; v_has boolean;
begin
  select * into r from weekly_reports where id = p_report_id;
  select quarter_id into v_quarter from reporting_weeks where id = r.reporting_week_id;
  if p_bu_goal_id is null then
    select exists (select 1 from bu_goals where business_unit_id = r.business_unit_id and quarter_id = v_quarter and status = 'ACTIVE') into v_has;
    if v_has and p_goal_type = 'KR_ALIGNED' then raise exception 'GOAL_BU_GOAL_REQUIRED'; end if;
    return;
  end if;
  if not exists (select 1 from bu_goals where id = p_bu_goal_id and business_unit_id = r.business_unit_id and quarter_id = v_quarter and status = 'ACTIVE') then
    raise exception 'GOAL_BU_GOAL_INVALID' using detail = 'choose one of this unit''s active goals for the quarter';
  end if;
end $$;

-- create_goal and update_goal learn the unit goal (an optional last argument, so existing calls keep working)
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('create_goal(uuid,uuid,text,uuid,text,text,jsonb,jsonb,integer)'::regprocedure);
  if position('p_expected_version integer)' in v_def) = 0 or position('insert into smart_goals (weekly_report_id, business_unit_id, goal_type, sub_key_result_id, title, description, position, created_by)' in v_def) = 0
     or position('v_r := assert_report_editable(p_actor, p_report_id, ''goal.create'', p_expected_version);' in v_def) = 0 then raise exception 'create_goal no longer contains the expected lines'; end if;
  v_def := replace(v_def, 'p_expected_version integer)', 'p_expected_version integer, p_bu_goal_id uuid DEFAULT NULL)');
  v_def := replace(v_def, 'v_r := assert_report_editable(p_actor, p_report_id, ''goal.create'', p_expected_version);',
    'v_r := assert_report_editable(p_actor, p_report_id, ''goal.create'', p_expected_version);' || chr(10) || '  perform assert_bu_goal_valid(p_bu_goal_id, p_report_id, p_goal_type);');
  v_def := replace(v_def, 'insert into smart_goals (weekly_report_id, business_unit_id, goal_type, sub_key_result_id, title, description, position, created_by)',
    'insert into smart_goals (weekly_report_id, business_unit_id, goal_type, sub_key_result_id, bu_goal_id, title, description, position, created_by)');
  v_def := replace(v_def, 'values (p_report_id, v_r.business_unit_id, p_goal_type, p_sub_kr_id, btrim(p_title)', 'values (p_report_id, v_r.business_unit_id, p_goal_type, p_sub_kr_id, p_bu_goal_id, btrim(p_title)');
  if position('p_bu_goal_id, btrim(p_title)' in v_def) = 0 then raise exception 'create_goal insert values not found'; end if;
  drop function create_goal(uuid, uuid, text, uuid, text, text, jsonb, jsonb, integer);
  execute v_def;

  v_def := pg_get_functiondef('update_goal(uuid,uuid,text,uuid,text,text,jsonb,integer)'::regprocedure);
  if position('p_expected_version integer)' in v_def) = 0 or position('update smart_goals set goal_type = p_goal_type, sub_key_result_id = p_sub_kr_id,' in v_def) = 0
     or position('v_r := assert_report_editable(p_actor, v_g.weekly_report_id, ''goal.edit'', p_expected_version);' in v_def) = 0 then raise exception 'update_goal no longer contains the expected lines'; end if;
  v_def := replace(v_def, 'p_expected_version integer)', 'p_expected_version integer, p_bu_goal_id uuid DEFAULT NULL)');
  v_def := replace(v_def, 'v_r := assert_report_editable(p_actor, v_g.weekly_report_id, ''goal.edit'', p_expected_version);',
    'v_r := assert_report_editable(p_actor, v_g.weekly_report_id, ''goal.edit'', p_expected_version);' || chr(10) || '  perform assert_bu_goal_valid(p_bu_goal_id, v_g.weekly_report_id, p_goal_type);');
  v_def := replace(v_def, 'update smart_goals set goal_type = p_goal_type, sub_key_result_id = p_sub_kr_id,', 'update smart_goals set goal_type = p_goal_type, sub_key_result_id = p_sub_kr_id, bu_goal_id = p_bu_goal_id,');
  drop function update_goal(uuid, uuid, text, uuid, text, text, jsonb, integer);
  execute v_def;

  v_def := pg_get_functiondef('bulk_create_goals(uuid,uuid,jsonb)'::regprocedure);
  if position('g->''evaluation'', null)' in v_def) = 0 then raise exception 'bulk_create_goals no longer contains the expected line'; end if;
  execute replace(v_def, 'g->''evaluation'', null)', 'g->''evaluation'', null, nullif(g->>''bu_goal_id'', '''')::uuid)');

  v_def := pg_get_functiondef('read_report_view_base(uuid)'::regprocedure);
  if position('''sub_key_result'', case when s.id is null' in v_def) = 0 then raise exception 'read_report_view_base no longer contains the expected line'; end if;
  execute replace(v_def, '''sub_key_result'', case when s.id is null',
    '''bu_goal'', (select jsonb_build_object(''id'', bg.id, ''title'', bg.title) from bu_goals bg where bg.id = g.bu_goal_id), ''sub_key_result'', case when s.id is null');
end $$;

select lock_down_function_grants();

-- Historical weekly reports (ADR-077) and reserved permissions.
--
-- 1. RBAC: a permission can be RESERVED. A reserved permission can sit only on a role that also holds roles.manage (the Super Admin tier): it can never be put on any
--    other role by anybody, however the role is created or changed, and it is never offered as an individual designation. history.import is the first one made for
--    this purpose; the Super-Admin-only emergency and approval permissions that already existed are marked too.
-- 2. Historical weekly reports: a Super Admin uploads past weeks (goals and their tasks with Done / Not Done) for closed quarters. The rows are STAGED, checked by the
--    database, REHEARSED (the real commit run inside a transaction that is always undone, so the Super Admin sees exactly the recomputed scores before anything is
--    written) and then COMMITTED in one transaction. Scores are recomputed by the ordinary scoring engine (finalize_reporting_week); nothing is copied from a legacy
--    score. Nothing is sent to anybody while it runs (no notifications, email or webhooks). Reports are never deleted by the application, so a committed batch cannot
--    be undone by it: the rehearsal and a database backup are the safety.

-- ------------------------------------------------------------------ 1. reserved permissions
alter table permissions add column reserved boolean not null default false;

insert into permissions (code, description, protected, reserved) values
  ('history.import', 'Upload and commit historical weekly reports for closed quarters (Super Admin tier only)', true, true);
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'SUPER_ADMIN' and p.code = 'history.import';

update permissions set reserved = true, protected = true where code in
  ('roles.manage','config.protected.approve','config.emergency','ledger.reversal.emergency','attendance.session.outcome.emergency','strategy.annual_theme.change_exception','history.import');

-- the role engine refuses to leave a reserved permission on a role that cannot manage roles
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'apply_role_change';
  v_new := replace(v_def, '  -- rule 4: never remove the last holder',
$r$  if v_action <> 'DELETE' then
    if exists (select 1 from role_permissions rp join permissions x on x.id = rp.permission_id where rp.role_id = v_rid::uuid and x.reserved)
       and not exists (select 1 from role_permissions rp join permissions x on x.id = rp.permission_id where rp.role_id = v_rid::uuid and x.code = 'roles.manage') then
      raise exception 'ROLE_RESERVED' using detail = 'a reserved permission can only be held by a role that can manage roles (the Super Admin tier)';
    end if;
  end if;
  -- rule 4: never remove the last holder$r$);
  if v_new = v_def then raise exception 'expected text not found in apply_role_change'; end if;
  execute v_new;
end $$;

create or replace function read_permissions() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'description', p.description, 'protected', p.protected, 'reserved', p.reserved) order by p.code), '[]'::jsonb) from permissions p;
$$;

-- ------------------------------------------------------------------ 2. nothing is sent while history is loaded
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'finalize_reporting_week';
  v_new := replace(v_def, 'perform notify_users(users_with_permission(''weekly_report.submit''), ''FINAL_LOCKED''', 'if coalesce(current_setting(''app.historical_import'', true), '''') <> ''on'' then perform notify_users(users_with_permission(''weekly_report.submit''), ''FINAL_LOCKED''');
  v_new := replace(v_new, '''final-lock:'' || p_week_id);', '''final-lock:'' || p_week_id); end if;');
  v_new := replace(v_new, 'perform snapshot_quarterly_scores(w.quarter_id);', 'if coalesce(current_setting(''app.historical_import'', true), '''') <> ''on'' then perform snapshot_quarterly_scores(w.quarter_id); end if;');
  if v_new = v_def or position('app.historical_import' in v_new) = 0 then raise exception 'expected text not found in finalize_reporting_week'; end if;
  execute v_new;
end $$;

create or replace function enqueue_webhooks() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.historical_import', true), '') = 'on' then return null; end if;     -- loading history never reaches an outside system
  begin
    insert into webhook_outbox (integration_id, event_type, payload)
    select i.id, new.action, jsonb_build_object('event', new.action, 'entity_type', new.entity_type, 'entity_id', new.entity_id, 'outcome', new.outcome,
                                                'actor_role', new.actor_role, 'occurred_at', new.occurred_at, 'correlation_id', new.correlation_id, 'delivery_of', 'audit_event')
      from integrations i
     where i.slot = 'WEBHOOK' and i.enabled
       and exists (select 1 from jsonb_array_elements_text(coalesce(i.settings->'events', '["*"]'::jsonb)) p
                    where p = '*' or p = new.action or (right(p, 1) = '*' and new.action like left(p, length(p) - 1) || '%'));
  exception when others then
    raise warning 'webhook enqueue failed: %', sqlerrm;
  end;
  return null;
end $$;

alter table task_status_history drop constraint task_status_history_change_source_check;
alter table task_status_history add constraint task_status_history_change_source_check
  check (change_source = any (array['BU_LEAD_EXECUTION','SYSTEM_FINAL_LOCK','INTEGRITY_CORRECTION','HISTORICAL_IMPORT']));

-- ------------------------------------------------------------------ 3. staging
create table historical_import_batches (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  file_sha256   text not null unique,
  row_count     int not null,
  status        text not null default 'STAGING' check (status in ('STAGING','STAGED','COMMITTED')),
  issue_count   int,
  result        jsonb,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default app_now(),
  committed_at  timestamptz
);
create table historical_import_rows (
  batch_id   uuid not null references historical_import_batches(id),
  row_no     int not null,
  year       int not null,
  week       int not null,
  monday     date not null,
  bu_id      uuid not null references business_units(id),
  sub_kr     text,                                   -- "1.1": key result 1, Sub-KR 1; null means a stretch goal
  goal       text not null,
  tasks      jsonb not null,                         -- [{"d": "description", "s": "DONE"|"NOT_DONE"}]
  primary key (batch_id, row_no)
);
create index historical_import_rows_week on historical_import_rows (batch_id, monday, bu_id);
alter table historical_import_batches enable row level security;
alter table historical_import_rows enable row level security;          -- no policy, no grant: only the functions below touch them

create or replace function forbid_committed_history_change() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from historical_import_batches where id = coalesce(old.batch_id, new.batch_id);
  if v_status = 'COMMITTED' then raise exception 'IMMUTABLE_RECORD' using detail = 'a committed historical import is evidence and cannot change'; end if;
  return coalesce(new, old);
end $$;
create trigger historical_import_rows_frozen before update or delete on historical_import_rows for each row execute function forbid_committed_history_change();

create or replace function iso_week_monday(p_year int, p_week int) returns date
language sql immutable as $$
  select (make_date(p_year, 1, 4) - (extract(isodow from make_date(p_year, 1, 4))::int - 1) + (p_week - 1) * 7)::date;
$$;

create or replace function history_create_batch(p_actor uuid, p_file text, p_sha text, p_rows int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b historical_import_batches;
begin
  perform require_permission(p_actor, 'history.import');
  if p_sha is null or length(p_sha) <> 64 or p_rows is null or p_rows < 1 then raise exception 'VALIDATION_ERROR' using detail = 'the file is empty or could not be identified'; end if;
  select * into b from historical_import_batches where file_sha256 = p_sha for update;
  if found then
    if b.status = 'COMMITTED' then raise exception 'HISTORY_ALREADY_IMPORTED' using detail = 'this exact file was imported on ' || to_char(b.committed_at at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI'); end if;
    delete from historical_import_rows where batch_id = b.id;                       -- a fresh attempt with the same file starts again
    update historical_import_batches set status = 'STAGING', issue_count = null, row_count = p_rows, created_by = p_actor where id = b.id;
    return jsonb_build_object('batch_id', b.id, 'reused', true);
  end if;
  insert into historical_import_batches (file_name, file_sha256, row_count, created_by) values (left(p_file, 200), p_sha, p_rows, p_actor) returning * into b;
  return jsonb_build_object('batch_id', b.id, 'reused', false);
end $$;

create or replace function history_stage_rows(p_actor uuid, p_batch uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; v_status text;
begin
  perform require_permission(p_actor, 'history.import');
  select status into v_status from historical_import_batches where id = p_batch for update;
  if v_status is distinct from 'STAGING' then raise exception 'HISTORY_BATCH_STATE' using detail = 'rows can only be added while the file is being read'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'send at most 2000 rows at a time'; end if;
  insert into historical_import_rows (batch_id, row_no, year, week, monday, bu_id, sub_kr, goal, tasks)
  select p_batch, r.row_no, r.year, r.week, iso_week_monday(r.year, r.week), r.bu_id, nullif(btrim(r.sub_kr), ''), btrim(r.goal), r.tasks
    from jsonb_to_recordset(p_rows) as r(row_no int, year int, week int, bu_id uuid, sub_kr text, goal text, tasks jsonb)
   where r.year between 2000 and 2100 and r.week between 1 and 53
     and extract(isoyear from iso_week_monday(r.year, r.week))::int = r.year and extract(week from iso_week_monday(r.year, r.week))::int = r.week;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(p_rows) then raise exception 'VALIDATION_ERROR' using detail = 'a row has a year or week that does not exist'; end if;
  return n;
end $$;

-- every reason a staged file cannot be committed, with the row it came from (the first 200 are returned; "count" is all of them)
create or replace function history_issues(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_sched reporting_schedule_versions := active_schedule();
begin
  with r as (
    select h.*, (h.monday::timestamp at time zone 'Africa/Lagos') as week_start,
           (date_trunc('quarter', h.monday)::date + interval '3 months')::date as next_quarter_start
      from historical_import_rows h where h.batch_id = p_batch
  ), w as (
    select r.*, rw.id as week_id, rw.status as week_status, rw.reporting_state, rw.final_lock_at as stored_final
      from r left join reporting_weeks rw on rw.week_start_at = r.week_start
  ), found as (
    select w.row_no, case
      when not exists (select 1 from business_units b where b.id = w.bu_id) then 'The Business Unit no longer exists.'
      when w.sub_kr is not null and w.sub_kr !~ '^[1-4]\.[1-9][0-9]?$' then 'The Sub-KR "' || w.sub_kr || '" must look like 1.1 (key result 1 to 4, then the Sub-KR number).'
      when w.goal = '' or char_length(w.goal) > 500 then 'The goal needs a title of up to 500 characters.'
      when jsonb_array_length(w.tasks) = 0 then 'The goal has no task.'
      when exists (select 1 from jsonb_array_elements(w.tasks) t where coalesce(btrim(t->>'d'), '') = '' or char_length(t->>'d') > 1000 or t->>'s' not in ('DONE','NOT_DONE')) then 'A task has no description (up to 1000 characters) or no Done / Not Done status.'
      when app_now() < ((w.next_quarter_start)::timestamp at time zone 'Africa/Lagos') then 'This week belongs to a quarter that has not ended. Only closed quarters can be loaded here.'
      when app_now() < coalesce(w.stored_final, schedule_final_lock(v_sched, w.monday)) then 'This week has not closed yet.'
      when w.week_id is not null and w.reporting_state <> 'NORMAL' then 'This week was declared an organisation holiday, so no report is expected.'
      when w.week_id is not null and w.week_status = 'FINAL_LOCKED' then 'The application has already closed this week; a report can be added to it only through a late-report exception.'
      when exists (select 1 from weekly_reports x where x.reporting_week_id = w.week_id and x.business_unit_id = w.bu_id) then 'This unit already has a report for this week.'
      when exists (select 1 from r r2 where r2.bu_id = w.bu_id and r2.monday = w.monday and coalesce(r2.sub_kr, '') = coalesce(w.sub_kr, '') and lower(r2.goal) = lower(w.goal) and r2.row_no < w.row_no) then 'This goal appears twice for the same unit and week.'
      end as message
      from w
  ), bad as (select row_no, message from found where message is not null order by row_no)
  select jsonb_build_object('count', (select count(*) from bad), 'issues', coalesce((select jsonb_agg(jsonb_build_object('row', row_no, 'message', message)) from (select * from bad limit 200) x), '[]'::jsonb)) into v;
  return v;
end $$;

create or replace function history_finish_staging(p_actor uuid, p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb; b historical_import_batches; n int;
begin
  perform require_permission(p_actor, 'history.import');
  select * into b from historical_import_batches where id = p_batch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'STAGING' then raise exception 'HISTORY_BATCH_STATE' using detail = 'this file has already been read'; end if;
  select count(*) into n from historical_import_rows where batch_id = p_batch;
  if n <> b.row_count then raise exception 'VALIDATION_ERROR' using detail = 'only ' || n || ' of ' || b.row_count || ' rows reached the database; read the file again'; end if;
  v := history_issues(p_batch);
  update historical_import_batches set status = 'STAGED', issue_count = (v->>'count')::int where id = p_batch;
  return v || jsonb_build_object('batch_id', p_batch, 'rows', n);
end $$;

-- ------------------------------------------------------------------ 4. the work itself (always run through rehearse or commit)
create or replace function history_apply(p_batch uuid, p_actor uuid, p_fill_gaps boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_issues jsonb; q record; v_q quarters; v_obj uuid; kr record; v_kr uuid; sk record; v_skr uuid; m record; g record; w record; rpt uuid; v_goal uuid; v_pos int; t jsonb; v_tpos int; v_task uuid;
  v_week uuid; v_new_quarters int := 0; v_obj_n int := 0; v_kr_n int := 0; v_sk_n int := 0; v_reports int := 0; v_goals int := 0; v_tasks int := 0; v_done int := 0; v_weeks int := 0;
  v_backdated jsonb := '[]'::jsonb; v_cnt int; v_per_quarter jsonb; v_scores jsonb; v_touched uuid[] := '{}'; v_fin jsonb; v_gap_weeks int := 0;
begin
  perform set_config('app.historical_import', 'on', true);
  v_issues := history_issues(p_batch);
  if (v_issues->>'count')::int > 0 then raise exception 'HISTORY_HAS_ISSUES' using detail = (v_issues->>'count') || ' rows cannot be loaded; fix the file and read it again'; end if;
  select id into v_org from organisations limit 1;

  -- the quarters the file touches: they exist, closed, with placeholder strategy where none was ever entered
  for q in select distinct date_trunc('quarter', monday)::date as qs from historical_import_rows where batch_id = p_batch order by 1 loop
    select * into v_q from quarters where organisation_id = v_org and year = extract(year from q.qs)::int and quarter_number = extract(quarter from q.qs)::int;
    if not found then
      insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on, status, activated_at, locked_at)
        values (v_org, extract(year from q.qs)::int, extract(quarter from q.qs)::int, q.qs, (q.qs + interval '3 months' - interval '1 day')::date, 'LOCKED', (q.qs::timestamp at time zone 'Africa/Lagos'), app_now())
        returning * into v_q;
      v_new_quarters := v_new_quarters + 1;
    elsif v_q.status <> 'LOCKED' then
      update quarters set status = 'LOCKED', locked_at = coalesce(locked_at, app_now()) where id = v_q.id returning * into v_q;
    end if;
    v_touched := v_touched || v_q.id;
    select id into v_obj from quarterly_objectives where quarter_id = v_q.id;
    if v_obj is null then
      insert into quarterly_objectives (quarter_id, title, description, created_by)
        values (v_q.id, 'Objective of ' || v_q.year || ' Q' || v_q.quarter_number || ' (historical, imported)', 'Placeholder created by the historical import: the real wording was never entered in this application.', p_actor) returning id into v_obj;
      v_obj_n := v_obj_n + 1;
    end if;
    for kr in select distinct split_part(sub_kr, '.', 1)::int as n from historical_import_rows
               where batch_id = p_batch and sub_kr is not null and date_trunc('quarter', monday)::date = q.qs order by 1 loop
      select id into v_kr from key_results where objective_id = v_obj and sequence = kr.n;
      if v_kr is null then
        insert into key_results (objective_id, sequence, code, title) values (v_obj, kr.n, 'KR' || kr.n, 'KR' || kr.n || ' (historical, imported)') returning id into v_kr;
        v_kr_n := v_kr_n + 1;
      end if;
      for sk in select distinct split_part(sub_kr, '.', 2)::int as n from historical_import_rows
                 where batch_id = p_batch and sub_kr is not null and date_trunc('quarter', monday)::date = q.qs and split_part(sub_kr, '.', 1)::int = kr.n order by 1 loop
        if not exists (select 1 from sub_key_results where key_result_id = v_kr and sequence = sk.n) then
          insert into sub_key_results (key_result_id, sequence, code, title) values (v_kr, sk.n, 'KR' || kr.n || '.' || sk.n, 'Sub-KR ' || kr.n || '.' || sk.n || ' (historical, imported)');
          v_sk_n := v_sk_n + 1;
        end if;
      end loop;
    end loop;
  end loop;

  -- a unit counts as existing from the first week the file has for it (the app records when a unit was created, which is now)
  for m in select bu_id, min(monday) as first_monday from historical_import_rows where batch_id = p_batch group by bu_id loop
    update business_units set created_at = (m.first_monday::timestamp at time zone 'Africa/Lagos') where id = m.bu_id and created_at > (m.first_monday::timestamp at time zone 'Africa/Lagos');
    get diagnostics v_cnt = row_count;
    if v_cnt > 0 then v_backdated := v_backdated || jsonb_build_object('business_unit_id', m.bu_id, 'from', m.first_monday); end if;
  end loop;

  -- the weeks, the reports, their goals and tasks
  for w in select distinct monday from historical_import_rows where batch_id = p_batch order by monday loop
    v_week := ensure_reporting_week(w.monday);
    v_weeks := v_weeks + 1;
    for m in select distinct bu_id from historical_import_rows where batch_id = p_batch and monday = w.monday loop
      insert into weekly_reports (business_unit_id, reporting_week_id, status, submission_status, review_status, submitted_at, submitted_by, reviewed_at, reviewed_by, created_by, created_at, updated_at)
        select m.bu_id, v_week, 'OPEN', 'SUBMITTED', 'REVIEWED', rw.content_lock_at - interval '1 hour', p_actor, rw.final_lock_at, p_actor, p_actor, rw.week_start_at, rw.week_start_at
          from reporting_weeks rw where rw.id = v_week returning id into rpt;
      v_reports := v_reports + 1; v_pos := 0;
      for g in select * from historical_import_rows where batch_id = p_batch and monday = w.monday and bu_id = m.bu_id order by row_no loop
        v_skr := null;
        if g.sub_kr is not null then
          select s.id into v_skr from sub_key_results s join key_results k on k.id = s.key_result_id join quarterly_objectives o on o.id = k.objective_id join quarters qq on qq.id = o.quarter_id
           where qq.organisation_id = v_org and qq.starts_on = date_trunc('quarter', g.monday)::date and k.sequence = split_part(g.sub_kr, '.', 1)::int and s.sequence = split_part(g.sub_kr, '.', 2)::int;
        end if;
        insert into smart_goals (weekly_report_id, business_unit_id, goal_type, sub_key_result_id, title, position, created_by)
          values (rpt, m.bu_id, case when v_skr is null then 'STRETCH' else 'KR_ALIGNED' end, v_skr, g.goal, v_pos, p_actor) returning id into v_goal;
        v_pos := v_pos + 1; v_goals := v_goals + 1; v_tpos := 0;
        for t in select * from jsonb_array_elements(g.tasks) loop
          insert into tasks (smart_goal_id, business_unit_id, description, status, position) values (v_goal, m.bu_id, btrim(t->>'d'), t->>'s', v_tpos) returning id into v_task;
          insert into task_status_history (task_id, from_status, to_status, change_source, changed_by, occurred_at)
            select v_task, 'UNDEFINED', t->>'s', 'HISTORICAL_IMPORT', p_actor, rw.content_lock_at from reporting_weeks rw where rw.id = v_week;
          v_tpos := v_tpos + 1; v_tasks := v_tasks + 1; if t->>'s' = 'DONE' then v_done := v_done + 1; end if;
        end loop;
      end loop;
    end loop;
  end loop;

  -- optionally the rest of each touched quarter: every other week is scored as "no report" for every unit that existed
  if p_fill_gaps then
    for q in select id from quarters where id = any(v_touched) loop
      perform ensure_quarter_weeks(q.id);
    end loop;
  end if;
  for w in select rw.id, rw.week_start_at from reporting_weeks rw
            where rw.status <> 'FINAL_LOCKED' and rw.quarter_id = any(v_touched)
              and (p_fill_gaps or (rw.week_start_at at time zone 'Africa/Lagos')::date in (select distinct monday from historical_import_rows where batch_id = p_batch))
            order by rw.week_start_at loop
    v_fin := finalize_reporting_week(w.id);                 -- the ordinary scoring and compliance rules; nothing here is a copied score
    if not exists (select 1 from historical_import_rows h where h.batch_id = p_batch and h.monday = (w.week_start_at at time zone 'Africa/Lagos')::date) then v_gap_weeks := v_gap_weeks + 1; end if;
  end loop;
  for q in select id from quarters where id = any(v_touched) loop
    perform snapshot_quarterly_scores(q.id);                -- once per quarter, from the finished weeks
  end loop;

  select coalesce(jsonb_agg(x order by x->>'year', x->>'quarter', x->>'unit'), '[]'::jsonb) into v_scores from (
    select jsonb_build_object('year', qq.year, 'quarter', qq.quarter_number, 'unit', b.code, 'unit_name', b.name, 'score', s.score, 'status', s.calculation_status,
                              'weeks_counted', s.denominator_count, 'weeks_without_report', s.missing_report_zero_count) as x
      from quarters qq join lateral (select distinct on (business_unit_id) * from quarterly_score_snapshots where quarter_id = qq.id order by business_unit_id, version_number desc) s on true
      join business_units b on b.id = s.business_unit_id where qq.id = any(v_touched)) y;
  select coalesce(jsonb_agg(jsonb_build_object('year', qq.year, 'quarter', qq.quarter_number, 'weeks', (select count(*) from reporting_weeks rw where rw.quarter_id = qq.id and rw.status = 'FINAL_LOCKED'),
         'reports', (select count(*) from weekly_reports wr join reporting_weeks rw on rw.id = wr.reporting_week_id where rw.quarter_id = qq.id)) order by qq.year, qq.quarter_number), '[]'::jsonb)
    into v_per_quarter from quarters qq where qq.id = any(v_touched);

  return jsonb_build_object('quarters_created', v_new_quarters, 'placeholders', jsonb_build_object('objectives', v_obj_n, 'key_results', v_kr_n, 'sub_key_results', v_sk_n),
    'weeks_with_rows', v_weeks, 'weeks_without_rows_scored', v_gap_weeks, 'reports', v_reports, 'goals', v_goals, 'tasks', v_tasks, 'tasks_done', v_done,
    'units_backdated', v_backdated, 'per_quarter', v_per_quarter, 'quarterly_scores', v_scores, 'fill_gaps', p_fill_gaps);
end $$;

-- Rehearsal: the real run, inside a transaction that is always undone. The Super Admin sees the recomputed scores before anything exists.
create or replace function history_rehearse(p_actor uuid, p_batch uuid, p_fill_gaps boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb; v_detail text; b historical_import_batches;
begin
  perform require_permission(p_actor, 'history.import');
  select * into b from historical_import_batches where id = p_batch;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'STAGED' then raise exception 'HISTORY_BATCH_STATE' using detail = case when b.status = 'COMMITTED' then 'this file has already been imported' else 'the file is still being read' end; end if;
  begin
    v := history_apply(p_batch, p_actor, p_fill_gaps);
    raise exception 'HISTORY_REHEARSAL' using detail = v::text;
  exception when others then
    if sqlerrm <> 'HISTORY_REHEARSAL' then raise; end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb || jsonb_build_object('rehearsal', true);
  end;
end $$;

create or replace function history_commit(p_actor uuid, p_batch uuid, p_fill_gaps boolean, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb; b historical_import_batches;
begin
  perform require_permission(p_actor, 'history.import');
  if p_confirm is distinct from 'IMPORT HISTORY' then raise exception 'VALIDATION_ERROR' using detail = 'type IMPORT HISTORY to confirm'; end if;
  select * into b from historical_import_batches where id = p_batch for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if b.status = 'COMMITTED' then return b.result || jsonb_build_object('already_committed', true); end if;
  if b.status <> 'STAGED' then raise exception 'HISTORY_BATCH_STATE' using detail = 'the file is still being read'; end if;
  v := history_apply(p_batch, p_actor, p_fill_gaps);
  update historical_import_batches set status = 'COMMITTED', committed_at = app_now(), result = v where id = p_batch;
  perform write_audit(p_actor, 'HISTORICAL_IMPORT_COMMITTED', 'historical_import', p_batch::text, null,
    jsonb_build_object('file', b.file_name, 'reports', v->'reports', 'goals', v->'goals', 'tasks', v->'tasks', 'quarters_created', v->'quarters_created', 'fill_gaps', p_fill_gaps));
  return v;
end $$;

create or replace function read_history_batches() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (select auth_has_permission('history.import')) then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name, 'rows', b.row_count, 'status', b.status, 'issues', b.issue_count, 'created_at', b.created_at,
          'committed_at', b.committed_at, 'reports', b.result->'reports', 'goals', b.result->'goals', 'tasks', b.result->'tasks') order by b.created_at desc)
     from (select * from historical_import_batches order by created_at desc limit 20) b), '[]'::jsonb);
end $$;

select lock_down_function_grants();

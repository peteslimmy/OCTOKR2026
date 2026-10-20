-- Weekly BU reporting: report, edit lease, SMART goals, tasks, execution, submission, review.

create table weekly_reports (
  id                 uuid primary key default gen_random_uuid(),
  business_unit_id   uuid not null references business_units(id) on delete restrict,
  reporting_week_id  uuid not null references reporting_weeks(id) on delete restrict,
  status             text not null default 'OPEN' check (status in ('OPEN','CONTENT_LOCKED','FINAL_LOCKED')),
  submission_status  text not null default 'NOT_SUBMITTED' check (submission_status in ('NOT_SUBMITTED','SUBMITTED')),
  review_status      text not null default 'NOT_REVIEWED' check (review_status in ('NOT_REVIEWED','REVIEWED')),
  version            int  not null default 1,
  submitted_at       timestamptz,
  submitted_by       uuid references users(id),
  content_locked_at  timestamptz,
  final_locked_at    timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid references users(id),
  skipped_session_summary_comment text,
  created_by         uuid references users(id),
  created_at         timestamptz not null default app_now(),
  updated_at         timestamptz not null default app_now(),
  unique (business_unit_id, reporting_week_id)
);
create index weekly_reports_week_idx on weekly_reports (reporting_week_id);

-- Final-locked reports are immutable at the database layer (except the review stamp).
create or replace function guard_weekly_report() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'weekly reports are never deleted'; end if;
  if old.status = 'FINAL_LOCKED' then
    if new.review_status is distinct from old.review_status or new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by then
      if (new.id, new.business_unit_id, new.reporting_week_id, new.status, new.submission_status, new.version, new.submitted_at,
          new.skipped_session_summary_comment, new.final_locked_at, new.content_locked_at)
         is not distinct from
         (old.id, old.business_unit_id, old.reporting_week_id, old.status, old.submission_status, old.version, old.submitted_at,
          old.skipped_session_summary_comment, old.final_locked_at, old.content_locked_at) then
        return new;
      end if;
    end if;
    raise exception 'REPORT_FINAL_LOCKED';
  end if;
  return new;
end $$;
create trigger weekly_reports_guard before update or delete on weekly_reports for each row execute function guard_weekly_report();

create table report_edit_sessions (
  id               uuid primary key default gen_random_uuid(),
  weekly_report_id uuid not null references weekly_reports(id) on delete cascade,
  user_id          uuid not null references users(id),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE','RELEASED','EXPIRED')),
  lease_expires_at timestamptz not null,
  started_at       timestamptz not null default app_now(),
  ended_at         timestamptz
);
create unique index report_edit_sessions_one_active on report_edit_sessions (weekly_report_id) where status = 'ACTIVE';

create table smart_goals (
  id                 uuid primary key default gen_random_uuid(),
  weekly_report_id   uuid not null references weekly_reports(id) on delete restrict,
  business_unit_id   uuid not null references business_units(id) on delete restrict,
  goal_type          text not null check (goal_type in ('KR_ALIGNED','STRETCH')),
  sub_key_result_id  uuid references sub_key_results(id) on delete restrict,
  title              text not null check (char_length(btrim(title)) between 1 and 500),
  description        text check (description is null or char_length(description) <= 4000),
  position           int  not null default 0,
  deleted_at         timestamptz,
  deleted_by         uuid references users(id),
  created_by         uuid references users(id),
  created_at         timestamptz not null default app_now(),
  updated_at         timestamptz not null default app_now(),
  check ((goal_type = 'KR_ALIGNED' and sub_key_result_id is not null) or (goal_type = 'STRETCH' and sub_key_result_id is null))
);
create index smart_goals_report_idx on smart_goals (weekly_report_id) where deleted_at is null;
create index smart_goals_subkr_idx on smart_goals (sub_key_result_id);

create table smart_evaluations (
  id              uuid primary key default gen_random_uuid(),
  smart_goal_id   uuid not null references smart_goals(id) on delete restrict,
  specific_score  numeric(5,2) not null check (specific_score between 0 and 100),
  measurable_score numeric(5,2) not null check (measurable_score between 0 and 100),
  achievable_score numeric(5,2) not null check (achievable_score between 0 and 100),
  relevant_score  numeric(5,2) not null check (relevant_score between 0 and 100),
  time_bound_score numeric(5,2) not null check (time_bound_score between 0 and 100),
  overall_score   numeric(5,2) not null check (overall_score between 0 and 100),
  warnings        jsonb not null default '[]'::jsonb,
  suggestions     jsonb not null default '[]'::jsonb,
  engine_version  text not null,
  input_title     text not null,
  evaluated_by    uuid references users(id),
  evaluated_at    timestamptz not null default app_now()
);
create index smart_evaluations_goal_idx on smart_evaluations (smart_goal_id, evaluated_at desc);

create table tasks (
  id               uuid primary key default gen_random_uuid(),
  smart_goal_id    uuid not null references smart_goals(id) on delete restrict,
  business_unit_id uuid not null references business_units(id) on delete restrict,
  description      text not null check (char_length(btrim(description)) between 1 and 1000),
  status           text not null default 'UNDEFINED' check (status in ('UNDEFINED','DONE','NOT_DONE')),
  position         int  not null default 0,
  deleted_at       timestamptz,
  deleted_by       uuid references users(id),
  created_at       timestamptz not null default app_now(),
  updated_at       timestamptz not null default app_now()
);
create index tasks_goal_idx on tasks (smart_goal_id) where deleted_at is null;

create table task_status_history (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id) on delete restrict,
  from_status  text not null,
  to_status    text not null,
  change_source text not null check (change_source in ('BU_LEAD_EXECUTION','SYSTEM_FINAL_LOCK','INTEGRITY_CORRECTION')),
  changed_by   uuid references users(id),
  integrity_correction_id uuid,
  occurred_at  timestamptz not null default app_now()
);
create index task_status_history_task_idx on task_status_history (task_id, occurred_at);
create trigger task_status_history_immutable before update or delete on task_status_history for each row execute function forbid_mutation();

-- Database backstop: task status can only move UNDEFINED -> DONE/NOT_DONE unless the
-- governed integrity operation set the session flag (ADR-020 / FR-INT-007).
create or replace function guard_task() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'tasks are soft-deleted'; end if;
  if new.status is distinct from old.status
     and not (old.status = 'UNDEFINED' and new.status in ('DONE','NOT_DONE'))
     and coalesce(current_setting('app.integrity_correction', true), '') <> 'on' then
    raise exception 'INVALID_STATE_TRANSITION' using detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end $$;
create trigger tasks_guard before update or delete on tasks for each row execute function guard_task();

-- ---------------------------------------------------------------- helpers
create or replace function goal_is_done(p_goal_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from tasks t where t.smart_goal_id = p_goal_id and t.deleted_at is null)
     and not exists (select 1 from tasks t where t.smart_goal_id = p_goal_id and t.deleted_at is null and t.status <> 'DONE');
$$;

create or replace function report_goal_counts(p_report_id uuid) returns table (total_goals int, done_goals int)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int, count(*) filter (where goal_is_done(g.id))::int
  from smart_goals g where g.weekly_report_id = p_report_id and g.deleted_at is null;
$$;

-- Load and lock a report for a content edit, enforcing permission, BU scope, lifecycle, lease and version.
create or replace function assert_report_editable(p_actor uuid, p_report_id uuid, p_permission text, p_expected_version int)
returns weekly_reports
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_w reporting_weeks; v_phase text;
begin
  perform require_permission(p_actor, p_permission);
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  select * into v_w from reporting_weeks where id = v_r.reporting_week_id;
  if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  v_phase := report_phase(v_r.reporting_week_id);
  if v_phase = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if v_phase = 'CONTENT_LOCKED' then raise exception 'REPORT_CONTENT_LOCKED'; end if;
  if not exists (select 1 from report_edit_sessions s where s.weekly_report_id = p_report_id and s.user_id = p_actor
                 and s.status = 'ACTIVE' and s.lease_expires_at > app_now()) then
    raise exception 'EDIT_LEASE_REQUIRED';
  end if;
  if p_expected_version is not null and p_expected_version <> v_r.version then raise exception 'CONCURRENT_UPDATE'; end if;
  return v_r;
end $$;

create or replace function bump_report_version(p_report_id uuid) returns int
language sql security definer set search_path = public, pg_temp as $$
  update weekly_reports set version = version + 1, updated_at = app_now() where id = p_report_id returning version;
$$;

create or replace function insert_smart_evaluation(p_goal_id uuid, p_eval jsonb, p_title text, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_eval is null then raise exception 'VALIDATION_ERROR' using detail = 'SMART evaluation is required'; end if;
  insert into smart_evaluations (smart_goal_id, specific_score, measurable_score, achievable_score, relevant_score,
                                 time_bound_score, overall_score, warnings, suggestions, engine_version, input_title, evaluated_by)
  values (p_goal_id, (p_eval->>'specific')::numeric, (p_eval->>'measurable')::numeric, (p_eval->>'achievable')::numeric,
          (p_eval->>'relevant')::numeric, (p_eval->>'timeBound')::numeric, (p_eval->>'overall')::numeric,
          coalesce(p_eval->'warnings', '[]'::jsonb), coalesce(p_eval->'suggestions', '[]'::jsonb),
          p_eval->>'engineVersion', p_title, p_actor);
exception when others then
  raise exception 'SMART_EVAL_PERSIST_FAILED' using detail = sqlerrm;
end $$;

-- A KR-aligned goal must reference a Sub-KR of the report's own, active quarter.
create or replace function assert_subkr_valid_for_report(p_sub_kr_id uuid, p_report_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  if p_sub_kr_id is null then raise exception 'GOAL_SUB_KR_REQUIRED'; end if;
  select exists (
    select 1 from sub_key_results s join key_results k on k.id = s.key_result_id
    join quarterly_objectives o on o.id = k.objective_id
    join reporting_weeks w on w.quarter_id = o.quarter_id
    join weekly_reports r on r.reporting_week_id = w.id
    where s.id = p_sub_kr_id and r.id = p_report_id) into v_ok;
  if not v_ok then raise exception 'GOAL_SUB_KR_INVALID' using detail = 'Sub-KR does not belong to this report''s quarter'; end if;
end $$;

-- ---------------------------------------------------------------- report lifecycle operations
create or replace function get_or_create_weekly_report(p_actor uuid, p_week_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bu uuid; v_id uuid; v_w reporting_weeks; v_q quarters;
begin
  perform require_permission(p_actor, 'weekly_report.view_own_bu');
  v_bu := actor_bu(p_actor);
  if v_bu is null then raise exception 'BU_SCOPE_DENIED'; end if;
  if not (select reports_weekly from business_units where id = v_bu) then raise exception 'REPORTING_NOT_REQUIRED' using detail = 'this Business Unit does not file weekly reports'; end if;
  select id into v_id from weekly_reports where business_unit_id = v_bu and reporting_week_id = p_week_id;
  if v_id is not null then return v_id; end if;
  perform require_permission(p_actor, 'weekly_report.create');
  select * into v_w from reporting_weeks where id = p_week_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  select * into v_q from quarters where id = v_w.quarter_id;
  if v_q.status <> 'ACTIVE' then raise exception 'QUARTER_NOT_ACTIVE'; end if;
  case report_phase(p_week_id)
    when 'NOT_OPEN' then raise exception 'REPORTING_WEEK_NOT_OPEN';
    when 'CONTENT_LOCKED' then raise exception 'REPORT_CONTENT_LOCKED';
    when 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED';
    else null;
  end case;
  insert into weekly_reports (business_unit_id, reporting_week_id, created_by) values (v_bu, p_week_id, p_actor)
    on conflict (business_unit_id, reporting_week_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from weekly_reports where business_unit_id = v_bu and reporting_week_id = p_week_id;
  else
    perform write_audit(p_actor, 'REPORT_CREATED', 'weekly_report', v_id::text, null, jsonb_build_object('week_id', p_week_id), null, v_bu);
  end if;
  return v_id;
end $$;

create or replace function acquire_edit_lease(p_actor uuid, p_report_id uuid, p_ttl_seconds int default 300) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_active report_edit_sessions; v_phase text; v_exp timestamptz;
begin
  perform require_permission(p_actor, 'weekly_report.edit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  v_phase := report_phase(v_r.reporting_week_id);
  if v_phase = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if v_phase = 'CONTENT_LOCKED' then raise exception 'REPORT_CONTENT_LOCKED'; end if;
  update report_edit_sessions set status = 'EXPIRED', ended_at = app_now()
   where weekly_report_id = p_report_id and status = 'ACTIVE' and lease_expires_at <= app_now();
  select * into v_active from report_edit_sessions where weekly_report_id = p_report_id and status = 'ACTIVE';
  v_exp := app_now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 900)));
  if found then
    if v_active.user_id <> p_actor then
      raise exception 'EDIT_LEASE_CONFLICT' using detail = (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = v_active.user_id);
    end if;
    update report_edit_sessions set lease_expires_at = v_exp where id = v_active.id;
    return jsonb_build_object('lease_id', v_active.id, 'expires_at', v_exp, 'version', v_r.version);
  end if;
  insert into report_edit_sessions (weekly_report_id, user_id, lease_expires_at) values (p_report_id, p_actor, v_exp) returning * into v_active;
  return jsonb_build_object('lease_id', v_active.id, 'expires_at', v_exp, 'version', v_r.version);
end $$;

create or replace function release_edit_lease(p_actor uuid, p_report_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update report_edit_sessions set status = 'RELEASED', ended_at = app_now()
   where weekly_report_id = p_report_id and user_id = p_actor and status = 'ACTIVE';
$$;

-- ---------------------------------------------------------------- goals and tasks (content, pre-lock)
create or replace function create_goal(
  p_actor uuid, p_report_id uuid, p_goal_type text, p_sub_kr_id uuid, p_title text, p_description text,
  p_tasks jsonb, p_evaluation jsonb, p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_goal uuid; v_pos int; v_t jsonb; v_i int := 0; v_ver int;
begin
  v_r := assert_report_editable(p_actor, p_report_id, 'goal.create', p_expected_version);
  if p_goal_type = 'KR_ALIGNED' then perform assert_subkr_valid_for_report(p_sub_kr_id, p_report_id);
  elsif p_goal_type = 'STRETCH' then
    if p_sub_kr_id is not null then raise exception 'VALIDATION_ERROR' using detail = 'Stretch goals cannot reference a Sub-KR'; end if;
  else raise exception 'VALIDATION_ERROR' using detail = 'invalid goal type'; end if;
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then raise exception 'GOAL_TASK_REQUIRED'; end if;
  select coalesce(max(position), -1) + 1 into v_pos from smart_goals where weekly_report_id = p_report_id;
  insert into smart_goals (weekly_report_id, business_unit_id, goal_type, sub_key_result_id, title, description, position, created_by)
    values (p_report_id, v_r.business_unit_id, p_goal_type, p_sub_kr_id, btrim(p_title), p_description, v_pos, p_actor) returning id into v_goal;
  for v_t in select * from jsonb_array_elements(p_tasks) loop
    insert into tasks (smart_goal_id, business_unit_id, description, position) values (v_goal, v_r.business_unit_id, btrim(v_t->>'description'), v_i);
    v_i := v_i + 1;
  end loop;
  perform insert_smart_evaluation(v_goal, p_evaluation, btrim(p_title), p_actor);
  v_ver := bump_report_version(p_report_id);
  perform write_audit(p_actor, 'GOAL_CREATED', 'smart_goal', v_goal::text, null,
    jsonb_build_object('title', btrim(p_title), 'goal_type', p_goal_type, 'sub_key_result_id', p_sub_kr_id, 'tasks', v_i), null, v_r.business_unit_id);
  return jsonb_build_object('goal_id', v_goal, 'version', v_ver);
end $$;

create or replace function update_goal(
  p_actor uuid, p_goal_id uuid, p_goal_type text, p_sub_kr_id uuid, p_title text, p_description text,
  p_evaluation jsonb, p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_g smart_goals; v_r weekly_reports; v_ver int;
begin
  select * into v_g from smart_goals where id = p_goal_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_r := assert_report_editable(p_actor, v_g.weekly_report_id, 'goal.edit', p_expected_version);
  if p_goal_type = 'KR_ALIGNED' then perform assert_subkr_valid_for_report(p_sub_kr_id, v_g.weekly_report_id);
  elsif p_goal_type = 'STRETCH' then
    if p_sub_kr_id is not null then raise exception 'VALIDATION_ERROR' using detail = 'Stretch goals cannot reference a Sub-KR'; end if;
  else raise exception 'VALIDATION_ERROR' using detail = 'invalid goal type'; end if;
  update smart_goals set goal_type = p_goal_type, sub_key_result_id = p_sub_kr_id, title = btrim(p_title), description = p_description, updated_at = app_now()
   where id = p_goal_id;
  perform insert_smart_evaluation(p_goal_id, p_evaluation, btrim(p_title), p_actor);
  v_ver := bump_report_version(v_g.weekly_report_id);
  perform write_audit(p_actor, 'GOAL_UPDATED', 'smart_goal', p_goal_id::text,
    jsonb_build_object('title', v_g.title, 'goal_type', v_g.goal_type, 'sub_key_result_id', v_g.sub_key_result_id),
    jsonb_build_object('title', btrim(p_title), 'goal_type', p_goal_type, 'sub_key_result_id', p_sub_kr_id), null, v_r.business_unit_id);
  return jsonb_build_object('goal_id', p_goal_id, 'version', v_ver);
end $$;

create or replace function delete_goal(p_actor uuid, p_goal_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_g smart_goals; v_r weekly_reports; v_ver int;
begin
  select * into v_g from smart_goals where id = p_goal_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_r := assert_report_editable(p_actor, v_g.weekly_report_id, 'goal.delete', p_expected_version);
  update smart_goals set deleted_at = app_now(), deleted_by = p_actor where id = p_goal_id;
  update tasks set deleted_at = app_now(), deleted_by = p_actor where smart_goal_id = p_goal_id and deleted_at is null;
  v_ver := bump_report_version(v_g.weekly_report_id);
  perform write_audit(p_actor, 'GOAL_DELETED', 'smart_goal', p_goal_id::text, jsonb_build_object('title', v_g.title), null, null, v_r.business_unit_id);
  return jsonb_build_object('version', v_ver);
end $$;

create or replace function create_task(p_actor uuid, p_goal_id uuid, p_description text, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_g smart_goals; v_r weekly_reports; v_id uuid; v_ver int; v_pos int;
begin
  select * into v_g from smart_goals where id = p_goal_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_r := assert_report_editable(p_actor, v_g.weekly_report_id, 'task.create', p_expected_version);
  select coalesce(max(position), -1) + 1 into v_pos from tasks where smart_goal_id = p_goal_id;
  insert into tasks (smart_goal_id, business_unit_id, description, position) values (p_goal_id, v_g.business_unit_id, btrim(p_description), v_pos) returning id into v_id;
  v_ver := bump_report_version(v_g.weekly_report_id);
  perform write_audit(p_actor, 'TASK_CREATED', 'task', v_id::text, null, jsonb_build_object('description', btrim(p_description), 'goal_id', p_goal_id), null, v_r.business_unit_id);
  return jsonb_build_object('task_id', v_id, 'version', v_ver);
end $$;

create or replace function update_task(p_actor uuid, p_task_id uuid, p_description text, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks; v_g smart_goals; v_r weekly_reports; v_ver int;
begin
  select * into v_t from tasks where id = p_task_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_g from smart_goals where id = v_t.smart_goal_id;
  v_r := assert_report_editable(p_actor, v_g.weekly_report_id, 'task.edit', p_expected_version);
  update tasks set description = btrim(p_description), updated_at = app_now() where id = p_task_id;
  v_ver := bump_report_version(v_g.weekly_report_id);
  perform write_audit(p_actor, 'TASK_UPDATED', 'task', p_task_id::text, jsonb_build_object('description', v_t.description),
    jsonb_build_object('description', btrim(p_description)), null, v_r.business_unit_id);
  return jsonb_build_object('version', v_ver);
end $$;

create or replace function delete_task(p_actor uuid, p_task_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks; v_g smart_goals; v_r weekly_reports; v_ver int;
begin
  select * into v_t from tasks where id = p_task_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_g from smart_goals where id = v_t.smart_goal_id;
  v_r := assert_report_editable(p_actor, v_g.weekly_report_id, 'task.delete', p_expected_version);
  update tasks set deleted_at = app_now(), deleted_by = p_actor where id = p_task_id;
  v_ver := bump_report_version(v_g.weekly_report_id);
  perform write_audit(p_actor, 'TASK_DELETED', 'task', p_task_id::text, jsonb_build_object('description', v_t.description), null, null, v_r.business_unit_id);
  return jsonb_build_object('version', v_ver);
end $$;

-- ---------------------------------------------------------------- execution (after content lock only)
create or replace function execute_task(p_actor uuid, p_task_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks; v_g smart_goals; v_r weekly_reports; v_phase text;
begin
  perform require_permission(p_actor, 'task.execute');
  if p_status is null or p_status not in ('DONE','NOT_DONE') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'target must be DONE or NOT_DONE'; end if;
  select * into v_t from tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_g from smart_goals where id = v_t.smart_goal_id;
  select * into v_r from weekly_reports where id = v_g.weekly_report_id;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  v_phase := report_phase(v_r.reporting_week_id);
  if v_phase = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if v_phase <> 'CONTENT_LOCKED' then raise exception 'EXECUTION_NOT_OPEN' using detail = 'Task status can be set only after content lock (Tuesday 18:00 WAT)'; end if;
  if (select reporting_state from reporting_weeks where id = v_r.reporting_week_id) = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  if v_t.status <> 'UNDEFINED' then raise exception 'INVALID_STATE_TRANSITION' using detail = v_t.status || ' -> ' || p_status; end if;
  update tasks set status = p_status, updated_at = app_now() where id = p_task_id;
  insert into task_status_history (task_id, from_status, to_status, change_source, changed_by) values (p_task_id, 'UNDEFINED', p_status, 'BU_LEAD_EXECUTION', p_actor);
  perform write_audit(p_actor, 'TASK_STATUS_CHANGED', 'task', p_task_id::text, jsonb_build_object('status', 'UNDEFINED'), jsonb_build_object('status', p_status), null, v_r.business_unit_id);
  return jsonb_build_object('task_id', p_task_id, 'status', p_status, 'goal_done', goal_is_done(v_g.id));
end $$;

-- ---------------------------------------------------------------- submission and review
create or replace function set_skipped_summary(p_actor uuid, p_report_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports;
begin
  perform require_permission(p_actor, 'weekly_report.edit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if report_phase(v_r.reporting_week_id) = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if not exists (select 1 from governance_sessions s where s.reporting_week_id = v_r.reporting_week_id and s.outcome = 'SKIPPED') then
    raise exception 'VALIDATION_ERROR' using detail = 'The physical session was not skipped for this week';
  end if;
  if v_r.submission_status = 'SUBMITTED' and (p_comment is null or btrim(p_comment) = '') then raise exception 'SKIPPED_SUMMARY_REQUIRED'; end if;
  update weekly_reports set skipped_session_summary_comment = nullif(btrim(p_comment), ''), updated_at = app_now() where id = p_report_id;
  perform write_audit(p_actor, 'SKIPPED_SUMMARY_SAVED', 'weekly_report', p_report_id::text, null, jsonb_build_object('length', char_length(coalesce(p_comment, ''))), null, v_r.business_unit_id);
end $$;

create or replace function submit_weekly_report(p_actor uuid, p_report_id uuid, p_summary_comment text, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r weekly_reports; v_blockers jsonb := '[]'::jsonb; v_goals int; v_skipped boolean; v_comment text; r record;
begin
  perform require_permission(p_actor, 'weekly_report.submit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if report_phase(v_r.reporting_week_id) = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if (select reporting_state from reporting_weeks where id = v_r.reporting_week_id) = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  if p_expected_version is not null and p_expected_version <> v_r.version then raise exception 'CONCURRENT_UPDATE'; end if;

  select count(*) into v_goals from smart_goals where weekly_report_id = p_report_id and deleted_at is null;
  if v_goals = 0 then v_blockers := v_blockers || to_jsonb('GOAL_MINIMUM_REQUIRED'::text); end if;
  for r in select g.title from smart_goals g where g.weekly_report_id = p_report_id and g.deleted_at is null
           and not exists (select 1 from tasks t where t.smart_goal_id = g.id and t.deleted_at is null) loop
    v_blockers := v_blockers || to_jsonb('GOAL_TASK_REQUIRED: ' || r.title);
  end loop;
  select exists (select 1 from governance_sessions s where s.reporting_week_id = v_r.reporting_week_id and s.outcome = 'SKIPPED') into v_skipped;
  v_comment := coalesce(nullif(btrim(p_summary_comment), ''), v_r.skipped_session_summary_comment);
  if v_skipped and v_comment is null then v_blockers := v_blockers || to_jsonb('SKIPPED_SUMMARY_REQUIRED'::text); end if;
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'SUBMISSION_BLOCKED' using detail = v_blockers::text;
  end if;

  if v_r.submission_status = 'SUBMITTED' then
    if v_skipped and v_comment is distinct from v_r.skipped_session_summary_comment then
      update weekly_reports set skipped_session_summary_comment = v_comment, updated_at = app_now() where id = p_report_id;
    end if;
    return jsonb_build_object('already_submitted', true, 'submitted_at', v_r.submitted_at, 'version', v_r.version);
  end if;
  update weekly_reports set submission_status = 'SUBMITTED', submitted_at = app_now(), submitted_by = p_actor,
         skipped_session_summary_comment = case when v_skipped then v_comment else skipped_session_summary_comment end,
         version = version + 1, updated_at = app_now()
   where id = p_report_id;
  perform write_audit(p_actor, 'REPORT_SUBMITTED', 'weekly_report', p_report_id::text, jsonb_build_object('submission_status', 'NOT_SUBMITTED'),
    jsonb_build_object('submission_status', 'SUBMITTED', 'goals', v_goals), null, v_r.business_unit_id);
  return jsonb_build_object('already_submitted', false, 'submitted_at', app_now(), 'version', v_r.version + 1);
end $$;

create or replace function review_weekly_report(p_actor uuid, p_report_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports;
begin
  perform require_permission(p_actor, 'weekly_report.review');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if report_phase(v_r.reporting_week_id) <> 'FINAL_LOCKED' then raise exception 'REPORT_NOT_FINALISED' using detail = 'Reports are reviewed after final lock'; end if;
  if v_r.submission_status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only submitted reports are reviewed'; end if;
  if v_r.review_status = 'REVIEWED' then return; end if;
  update weekly_reports set review_status = 'REVIEWED', reviewed_at = app_now(), reviewed_by = p_actor where id = p_report_id;
  perform write_audit(p_actor, 'REPORT_REVIEWED', 'weekly_report', p_report_id::text, jsonb_build_object('review_status', 'NOT_REVIEWED'),
    jsonb_build_object('review_status', 'REVIEWED'), null, v_r.business_unit_id);
end $$;

select lock_down_function_grants();

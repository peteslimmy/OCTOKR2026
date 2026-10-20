-- Milestone 3a: controlled late-report score amendment (ADR-032, 07-SCORING-ENGINE §10, AC-SC-014).
-- A BU that missed a weekly report may be authorised, by an explicit permission, to file it late. The late report is
-- submitted, reviewed through the normal review, and only then applied: the weekly zero is superseded by a NEW weekly
-- snapshot version and a NEW quarterly snapshot version. Nothing historical is mutated and the quarter is not reopened.

-- ---------------------------------------------------------------- schema
alter table weekly_score_snapshots drop constraint weekly_score_snapshots_reason_check;
alter table weekly_score_snapshots add constraint weekly_score_snapshots_reason_check
  check (reason in ('FINAL_LOCK','INTEGRITY_CORRECTION','LATE_REPORT_AMENDMENT'));

create table late_report_exceptions (
  id                 uuid primary key default gen_random_uuid(),
  business_unit_id   uuid not null references business_units(id) on delete restrict,
  reporting_week_id  uuid not null references reporting_weeks(id) on delete restrict,
  status             text not null default 'AUTHORISED' check (status in ('AUTHORISED','SUBMITTED','APPLIED','REVOKED')),
  reason             text not null check (btrim(reason) <> ''),
  authorised_by      uuid not null references users(id),
  authorised_at      timestamptz not null default app_now(),
  weekly_report_id   uuid references weekly_reports(id) on delete restrict,
  submitted_at       timestamptz,
  applied_by         uuid references users(id),
  applied_at         timestamptz,
  apply_reason       text,
  revoked_by         uuid references users(id),
  revoked_at         timestamptz,
  revoke_reason      text,
  idempotency_key    text not null unique,
  apply_idempotency_key text unique,
  created_at         timestamptz not null default app_now(),
  check (status <> 'APPLIED' or (applied_by is not null and apply_reason is not null)),
  check (status <> 'REVOKED' or (revoked_by is not null and revoke_reason is not null))
);
-- one live exception per BU and week; a week that was amended cannot be amended a second time
create unique index late_report_exceptions_one_live on late_report_exceptions (business_unit_id, reporting_week_id)
  where status in ('AUTHORISED','SUBMITTED','APPLIED');
create index late_report_exceptions_status_idx on late_report_exceptions (status);

create or replace function guard_late_report_exception() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'late-report exceptions are never deleted'; end if;
  if old.status in ('APPLIED','REVOKED') then raise exception 'IMMUTABLE_RECORD' using detail = 'a decided exception is immutable'; end if;
  if new.business_unit_id <> old.business_unit_id or new.reporting_week_id <> old.reporting_week_id
     or new.reason <> old.reason or new.authorised_by <> old.authorised_by or new.authorised_at <> old.authorised_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'authorisation facts cannot be changed';
  end if;
  if new.status <> old.status and not ((old.status = 'AUTHORISED' and new.status in ('SUBMITTED','REVOKED'))
                                    or (old.status = 'SUBMITTED' and new.status in ('APPLIED','REVOKED'))) then
    raise exception 'INVALID_STATE_TRANSITION' using detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end $$;
create trigger late_report_exceptions_guard before update or delete on late_report_exceptions for each row execute function guard_late_report_exception();

create table late_report_exception_events (
  id            uuid primary key default gen_random_uuid(),
  exception_id  uuid not null references late_report_exceptions(id) on delete restrict,
  event_type    text not null check (event_type in ('AUTHORISED','REPORT_STARTED','SUBMITTED','REVIEWED','APPLIED','REVOKED')),
  actor_user_id uuid references users(id),
  reason        text,
  details       jsonb,
  created_at    timestamptz not null default app_now()
);
create index late_report_exception_events_idx on late_report_exception_events (exception_id, created_at);
create trigger late_report_exception_events_immutable before update or delete on late_report_exception_events for each row execute function forbid_mutation();

alter table weekly_reports add column late_exception_id uuid references late_report_exceptions(id) on delete restrict;
create unique index weekly_reports_late_exception_uq on weekly_reports (late_exception_id) where late_exception_id is not null;

create table quarterly_score_amendments (
  id                           uuid primary key default gen_random_uuid(),
  exception_id                 uuid not null unique references late_report_exceptions(id) on delete restrict,
  quarter_id                   uuid not null references quarters(id) on delete restrict,
  business_unit_id             uuid not null references business_units(id) on delete restrict,
  reporting_week_id            uuid not null references reporting_weeks(id) on delete restrict,
  weekly_report_id             uuid not null references weekly_reports(id) on delete restrict,
  original_weekly_snapshot_id  uuid not null references weekly_score_snapshots(id) on delete restrict,
  new_weekly_snapshot_id       uuid not null references weekly_score_snapshots(id) on delete restrict,
  prior_quarterly_snapshot_id  uuid references quarterly_score_snapshots(id) on delete restrict,
  new_quarterly_snapshot_id    uuid not null references quarterly_score_snapshots(id) on delete restrict,
  old_weekly_score             numeric(5,2) not null,
  new_weekly_score             numeric(5,2) not null,
  old_quarterly_score          numeric(5,2),
  new_quarterly_score          numeric(5,2),
  reason                       text not null check (btrim(reason) <> ''),
  authorised_by                uuid not null references users(id),
  reviewed_by                  uuid not null references users(id),
  applied_by                   uuid not null references users(id),
  quarter_locked_at_apply      boolean not null,
  audit_id                     uuid,
  created_at                   timestamptz not null default app_now()
);
create trigger quarterly_score_amendments_immutable before update or delete on quarterly_score_amendments for each row execute function forbid_mutation();
alter table quarterly_score_snapshots add constraint quarterly_score_snapshots_amendment_fk
  foreign key (amendment_id) references quarterly_score_amendments(id) on delete restrict deferrable initially deferred;

-- ---------------------------------------------------------------- report guard: the only reopening is the authorised late path
create or replace function guard_weekly_report() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'weekly reports are never deleted'; end if;
  if old.status = 'FINAL_LOCKED' then
    if new.status = 'OPEN' and coalesce(current_setting('app.late_exception', true), '') = 'on'
       and old.submission_status = 'NOT_SUBMITTED' and new.submission_status = 'NOT_SUBMITTED' and new.late_exception_id is not null then
      return new;
    end if;
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
  if new.late_exception_id is distinct from old.late_exception_id then
    raise exception 'IMMUTABLE_RECORD' using detail = 'late_exception_id is set once, by the authorised path';
  end if;
  return new;
end $$;

-- Effective phase of a concrete report. A report under an AUTHORISED late-report exception is editable AND executable.
create or replace function report_phase_of(r weekly_reports) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when r.late_exception_id is not null and r.submission_status = 'NOT_SUBMITTED'
         and exists (select 1 from late_report_exceptions e where e.id = r.late_exception_id and e.status = 'AUTHORISED')
      then 'LATE_OPEN'
    else report_phase(r.reporting_week_id) end;
$$;

-- ---------------------------------------------------------------- authorise
create or replace function authorise_late_report_exception(
  p_actor uuid, p_business_unit_id uuid, p_week_id uuid, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_w reporting_weeks; v_bu business_units; v_e late_report_exceptions; v_snap weekly_score_snapshots; v_rep weekly_reports; v_audit uuid;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_e from late_report_exceptions where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('replayed', true, 'exception_id', v_e.id, 'status', v_e.status); end if;

  select * into v_w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_bu from business_units where id = p_business_unit_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  if app_now() >= v_w.final_lock_at and v_w.status <> 'FINAL_LOCKED' then raise exception 'FINAL_LOCK_PENDING' using detail = 'the week is still being finalised'; end if;
  if v_w.status <> 'FINAL_LOCKED' then raise exception 'LATE_EXCEPTION_NOT_APPLICABLE' using detail = 'the ordinary reporting window is still open'; end if;
  if not v_bu.reports_weekly or v_bu.status <> 'ACTIVE' or v_bu.created_at >= v_w.week_end_at then
    raise exception 'LATE_EXCEPTION_NOT_APPLICABLE' using detail = 'this Business Unit was not expected to report for that week';
  end if;
  select * into v_snap from weekly_score_snapshots where business_unit_id = p_business_unit_id and reporting_week_id = p_week_id order by version_number desc limit 1;
  if not found or v_snap.score_state <> 'NOT_SUBMITTED' then
    raise exception 'LATE_EXCEPTION_NOT_APPLICABLE' using detail = 'only a missing report can be filed late';
  end if;
  if exists (select 1 from late_report_exceptions where business_unit_id = p_business_unit_id and reporting_week_id = p_week_id
             and status in ('AUTHORISED','SUBMITTED','APPLIED')) then
    raise exception 'LATE_EXCEPTION_ALREADY_EXISTS';
  end if;

  insert into late_report_exceptions (business_unit_id, reporting_week_id, reason, authorised_by, idempotency_key)
    values (p_business_unit_id, p_week_id, btrim(p_reason), p_actor, p_idempotency_key) returning * into v_e;

  -- an unsubmitted draft that was frozen at final lock is reopened for this exception only
  select * into v_rep from weekly_reports where business_unit_id = p_business_unit_id and reporting_week_id = p_week_id for update;
  if found then
    perform set_config('app.late_exception', 'on', true);
    update weekly_reports set status = 'OPEN', late_exception_id = v_e.id, updated_at = app_now() where id = v_rep.id;
    perform set_config('app.late_exception', 'off', true);
    update late_report_exceptions set weekly_report_id = v_rep.id where id = v_e.id;
  end if;

  insert into late_report_exception_events (exception_id, event_type, actor_user_id, reason, details)
    values (v_e.id, 'AUTHORISED', p_actor, btrim(p_reason), jsonb_build_object('original_weekly_snapshot_id', v_snap.id, 'reopened_draft', v_rep.id is not null));
  v_audit := write_audit(p_actor, 'LATE_REPORT_AUTHORISED', 'late_report_exception', v_e.id::text, null,
    jsonb_build_object('business_unit_id', p_business_unit_id, 'reporting_week_id', p_week_id, 'original_weekly_score', v_snap.final_score),
    btrim(p_reason), p_business_unit_id);
  perform notify_users(bu_lead_ids(p_business_unit_id), 'LATE_REPORT_AUTHORISED', 'late_report_exception', v_e.id::text,
    'Late weekly report authorised', 'You may file the missing weekly report for this week. It will be reviewed before the score is amended. Reason: ' || btrim(p_reason),
    'lre:' || v_e.id);
  return jsonb_build_object('replayed', false, 'exception_id', v_e.id, 'status', 'AUTHORISED', 'audit_id', v_audit);
end $$;

-- BU Lead starts (or resumes) the late report. Everything after this uses the ordinary report operations.
create or replace function get_or_create_weekly_report(p_actor uuid, p_week_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bu uuid; v_id uuid; v_w reporting_weeks; v_q quarters; v_e late_report_exceptions;
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

  select * into v_e from late_report_exceptions where business_unit_id = v_bu and reporting_week_id = p_week_id and status = 'AUTHORISED';
  if found then
    insert into weekly_reports (business_unit_id, reporting_week_id, created_by, late_exception_id) values (v_bu, p_week_id, p_actor, v_e.id) returning id into v_id;
    update late_report_exceptions set weekly_report_id = v_id where id = v_e.id;
    insert into late_report_exception_events (exception_id, event_type, actor_user_id) values (v_e.id, 'REPORT_STARTED', p_actor);
    perform write_audit(p_actor, 'LATE_REPORT_STARTED', 'weekly_report', v_id::text, null, jsonb_build_object('week_id', p_week_id, 'exception_id', v_e.id), null, v_bu);
    return v_id;
  end if;

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

-- ---------------------------------------------------------------- ordinary report operations, now late-aware
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
  v_phase := report_phase_of(v_r);
  if v_phase = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if v_phase = 'CONTENT_LOCKED' then raise exception 'REPORT_CONTENT_LOCKED'; end if;
  if not exists (select 1 from report_edit_sessions s where s.weekly_report_id = p_report_id and s.user_id = p_actor
                 and s.status = 'ACTIVE' and s.lease_expires_at > app_now()) then
    raise exception 'EDIT_LEASE_REQUIRED';
  end if;
  if p_expected_version is not null and p_expected_version <> v_r.version then raise exception 'CONCURRENT_UPDATE'; end if;
  return v_r;
end $$;

create or replace function acquire_edit_lease(p_actor uuid, p_report_id uuid, p_ttl_seconds int default 300) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports; v_active report_edit_sessions; v_phase text; v_exp timestamptz;
begin
  perform require_permission(p_actor, 'weekly_report.edit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  v_phase := report_phase_of(v_r);
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
  v_phase := report_phase_of(v_r);
  if v_phase = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if v_phase not in ('CONTENT_LOCKED','LATE_OPEN') then raise exception 'EXECUTION_NOT_OPEN' using detail = 'Task status can be set only after content lock (Tuesday 18:00 WAT)'; end if;
  if (select reporting_state from reporting_weeks where id = v_r.reporting_week_id) = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  if v_t.status <> 'UNDEFINED' then raise exception 'INVALID_STATE_TRANSITION' using detail = v_t.status || ' -> ' || p_status; end if;
  update tasks set status = p_status, updated_at = app_now() where id = p_task_id;
  insert into task_status_history (task_id, from_status, to_status, change_source, changed_by) values (p_task_id, 'UNDEFINED', p_status, 'BU_LEAD_EXECUTION', p_actor);
  perform write_audit(p_actor, 'TASK_STATUS_CHANGED', 'task', p_task_id::text, jsonb_build_object('status', 'UNDEFINED'), jsonb_build_object('status', p_status), null, v_r.business_unit_id);
  return jsonb_build_object('task_id', p_task_id, 'status', p_status, 'goal_done', goal_is_done(v_g.id));
end $$;

create or replace function set_skipped_summary(p_actor uuid, p_report_id uuid, p_comment text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r weekly_reports;
begin
  perform require_permission(p_actor, 'weekly_report.edit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if report_phase_of(v_r) = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
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
  v_r weekly_reports; v_blockers jsonb := '[]'::jsonb; v_goals int; v_skipped boolean; v_comment text; r record; v_late boolean;
begin
  perform require_permission(p_actor, 'weekly_report.submit');
  select * into v_r from weekly_reports where id = p_report_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from v_r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if report_phase_of(v_r) = 'FINAL_LOCKED' then raise exception 'REPORT_FINAL_LOCKED'; end if;
  if (select reporting_state from reporting_weeks where id = v_r.reporting_week_id) = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  if p_expected_version is not null and p_expected_version <> v_r.version then raise exception 'CONCURRENT_UPDATE'; end if;

  v_late := report_phase_of(v_r) = 'LATE_OPEN';
  select count(*) into v_goals from smart_goals where weekly_report_id = p_report_id and deleted_at is null;
  if v_goals = 0 then v_blockers := v_blockers || to_jsonb('GOAL_MINIMUM_REQUIRED'::text); end if;
  for r in select g.title from smart_goals g where g.weekly_report_id = p_report_id and g.deleted_at is null
           and not exists (select 1 from tasks t where t.smart_goal_id = g.id and t.deleted_at is null) loop
    v_blockers := v_blockers || to_jsonb('GOAL_TASK_REQUIRED: ' || r.title);
  end loop;
  -- a late report is scored on submission with no further execution window, so every task must already be DONE or NOT_DONE
  if v_late and exists (select 1 from tasks t join smart_goals g on g.id = t.smart_goal_id
                        where g.weekly_report_id = p_report_id and g.deleted_at is null and t.deleted_at is null and t.status = 'UNDEFINED') then
    v_blockers := v_blockers || to_jsonb('TASK_STATUS_REQUIRED'::text);
  end if;
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
  if v_late then
    update late_report_exceptions set status = 'SUBMITTED', submitted_at = app_now() where id = v_r.late_exception_id;
    insert into late_report_exception_events (exception_id, event_type, actor_user_id) values (v_r.late_exception_id, 'SUBMITTED', p_actor);
    perform notify_users(users_with_permission('weekly_report.review'), 'LATE_REPORT_SUBMITTED', 'weekly_report', p_report_id::text,
      'Late weekly report submitted', 'A late report is awaiting review before its score can be amended.', 'lre-sub:' || v_r.late_exception_id);
  end if;
  return jsonb_build_object('already_submitted', false, 'submitted_at', app_now(), 'version', v_r.version + 1);
end $$;

-- ---------------------------------------------------------------- review (records the late-report review event)
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
  if v_r.late_exception_id is not null then
    insert into late_report_exception_events (exception_id, event_type, actor_user_id) values (v_r.late_exception_id, 'REVIEWED', p_actor);
  end if;
end $$;

-- ---------------------------------------------------------------- quarterly amendment snapshot
create or replace function snapshot_quarterly_score_amendment(p_quarter_id uuid, p_bu uuid, p_amendment_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c jsonb; last quarterly_score_snapshots; v_id uuid;
begin
  c := calculate_quarterly_score(p_quarter_id, p_bu);
  select * into last from quarterly_score_snapshots where quarter_id = p_quarter_id and business_unit_id = p_bu order by version_number desc limit 1;
  insert into quarterly_score_snapshots (quarter_id, business_unit_id, version_number, calculation_status, score, score_reason, denominator_count,
      numerator, missing_report_zero_count, excluded_holiday_count, week_contributions, rule_version, prior_snapshot_id, source, amendment_id)
  values (p_quarter_id, p_bu, coalesce(last.version_number, 0) + 1, c->>'calculation_status', (c->>'score')::numeric, c->>'score_reason',
      (c->>'denominator_count')::int, (c->>'numerator')::numeric, (c->>'missing_report_zero_count')::int, (c->>'excluded_holiday_count')::int,
      c->'contributions', 'quarterly-rules-1.0.0', last.id, 'AMENDMENT', p_amendment_id)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- apply
create or replace function apply_late_report_amendment(p_actor uuid, p_exception_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_e late_report_exceptions; v_r weekly_reports; v_w reporting_weeks; v_orig weekly_score_snapshots; v_new_id uuid; v_new weekly_score_snapshots;
  v_prior quarterly_score_snapshots; v_qnew quarterly_score_snapshots; v_am uuid := gen_random_uuid(); v_qid uuid; v_audit uuid; v_locked boolean;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_e from late_report_exceptions where id = p_exception_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_e.status = 'APPLIED' then
    if v_e.apply_idempotency_key = p_idempotency_key then
      return jsonb_build_object('replayed', true, 'amendment_id', (select id from quarterly_score_amendments where exception_id = v_e.id));
    end if;
    raise exception 'INVALID_STATE_TRANSITION' using detail = 'already applied';
  end if;
  if v_e.status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'exception is ' || v_e.status || '; the late report must be submitted first'; end if;
  select * into v_r from weekly_reports where id = v_e.weekly_report_id for update;
  if v_r.review_status <> 'REVIEWED' then raise exception 'LATE_REPORT_NOT_REVIEWED'; end if;
  if v_r.reviewed_by = p_actor then raise exception 'LATE_AMENDMENT_SEGREGATION' using detail = 'the reviewer cannot also apply the amendment'; end if;
  select * into v_w from reporting_weeks where id = v_e.reporting_week_id;

  select * into v_orig from weekly_score_snapshots where business_unit_id = v_e.business_unit_id and reporting_week_id = v_e.reporting_week_id
    order by version_number asc limit 1;                       -- the original final-lock zero stays the reference
  v_new_id := create_weekly_snapshot(v_e.business_unit_id, v_e.reporting_week_id, v_r.id, 'LATE_REPORT_AMENDMENT');
  select * into v_new from weekly_score_snapshots where id = v_new_id;
  if v_new.score_state <> 'SCORED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'late report is not scored'; end if;

  -- relock the report: it is final again and never reopened
  update weekly_reports set status = 'FINAL_LOCKED', content_locked_at = coalesce(content_locked_at, v_w.content_lock_at),
         final_locked_at = app_now(), updated_at = app_now() where id = v_r.id;
  update report_edit_sessions set status = 'EXPIRED', ended_at = app_now() where weekly_report_id = v_r.id and status = 'ACTIVE';

  select * into v_prior from quarterly_score_snapshots where quarter_id = v_w.quarter_id and business_unit_id = v_e.business_unit_id order by version_number desc limit 1;
  v_qid := snapshot_quarterly_score_amendment(v_w.quarter_id, v_e.business_unit_id, v_am);
  select * into v_qnew from quarterly_score_snapshots where id = v_qid;
  v_locked := quarter_is_locked(v_w.quarter_id);

  update late_report_exceptions set status = 'APPLIED', applied_by = p_actor, applied_at = app_now(), apply_reason = btrim(p_reason),
         apply_idempotency_key = p_idempotency_key where id = v_e.id;
  v_audit := write_audit(p_actor, 'QUARTER_SCORE_AMENDED', 'quarterly_score_amendment', v_am::text,
    jsonb_build_object('weekly_score', v_orig.final_score, 'quarterly_score', v_prior.score, 'quarterly_version', v_prior.version_number),
    jsonb_build_object('weekly_score', v_new.final_score, 'quarterly_score', v_qnew.score, 'quarterly_version', v_qnew.version_number,
                       'quarter_locked', v_locked, 'exception_id', v_e.id),
    btrim(p_reason), v_e.business_unit_id);
  insert into quarterly_score_amendments (id, exception_id, quarter_id, business_unit_id, reporting_week_id, weekly_report_id,
      original_weekly_snapshot_id, new_weekly_snapshot_id, prior_quarterly_snapshot_id, new_quarterly_snapshot_id,
      old_weekly_score, new_weekly_score, old_quarterly_score, new_quarterly_score, reason, authorised_by, reviewed_by, applied_by,
      quarter_locked_at_apply, audit_id)
  values (v_am, v_e.id, v_w.quarter_id, v_e.business_unit_id, v_e.reporting_week_id, v_r.id, v_orig.id, v_new_id, v_prior.id, v_qid,
      v_orig.final_score, v_new.final_score, v_prior.score, v_qnew.score, btrim(p_reason), v_e.authorised_by, v_r.reviewed_by, p_actor, v_locked, v_audit);
  insert into late_report_exception_events (exception_id, event_type, actor_user_id, reason, details)
    values (v_e.id, 'APPLIED', p_actor, btrim(p_reason), jsonb_build_object('amendment_id', v_am, 'old_quarterly_score', v_prior.score,
            'new_quarterly_score', v_qnew.score, 'new_quarterly_version', v_qnew.version_number));
  perform notify_users(bu_lead_ids(v_e.business_unit_id), 'QUARTER_SCORE_AMENDED', 'quarterly_score_amendment', v_am::text,
    'Quarterly score amended', 'The late weekly report was accepted. Your quarterly score changed from ' || coalesce(v_prior.score::text, 'N/A') || ' to ' || coalesce(v_qnew.score::text, 'N/A') || '.',
    'qsa:' || v_am);
  return jsonb_build_object('replayed', false, 'amendment_id', v_am, 'old_weekly_score', v_orig.final_score, 'new_weekly_score', v_new.final_score,
    'old_quarterly_score', v_prior.score, 'new_quarterly_score', v_qnew.score, 'new_quarterly_version', v_qnew.version_number);
end $$;

-- ---------------------------------------------------------------- revoke / reject
create or replace function revoke_late_report_exception(p_actor uuid, p_exception_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e late_report_exceptions; v_r weekly_reports; v_prev text;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into v_e from late_report_exceptions where id = p_exception_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_e.status = 'REVOKED' then return jsonb_build_object('replayed', true); end if;
  if v_e.status not in ('AUTHORISED','SUBMITTED') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'exception is ' || v_e.status; end if;
  v_prev := v_e.status;
  if v_e.weekly_report_id is not null then
    select * into v_r from weekly_reports where id = v_e.weekly_report_id for update;
    update weekly_reports set status = 'FINAL_LOCKED', final_locked_at = coalesce(final_locked_at, app_now()), updated_at = app_now() where id = v_r.id;
    update report_edit_sessions set status = 'EXPIRED', ended_at = app_now() where weekly_report_id = v_r.id and status = 'ACTIVE';
  end if;
  update late_report_exceptions set status = 'REVOKED', revoked_by = p_actor, revoked_at = app_now(), revoke_reason = btrim(p_reason) where id = v_e.id;
  insert into late_report_exception_events (exception_id, event_type, actor_user_id, reason, details)
    values (v_e.id, 'REVOKED', p_actor, btrim(p_reason), jsonb_build_object('from_status', v_prev));
  perform write_audit(p_actor, 'LATE_REPORT_REVOKED', 'late_report_exception', v_e.id::text, jsonb_build_object('status', v_prev),
    jsonb_build_object('status', 'REVOKED'), btrim(p_reason), v_e.business_unit_id);
  perform notify_users(bu_lead_ids(v_e.business_unit_id), 'LATE_REPORT_REVOKED', 'late_report_exception', v_e.id::text,
    'Late report exception withdrawn', 'The late-report authorisation was withdrawn. Reason: ' || btrim(p_reason), 'lre-rev:' || v_e.id);
  return jsonb_build_object('replayed', false, 'status', 'REVOKED');
end $$;

-- ---------------------------------------------------------------- read models (security invoker: caller's RLS applies)
create or replace function read_late_report_exceptions() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'status', e.status, 'reason', e.reason, 'authorised_at', e.authorised_at, 'authorised_by', coalesce(ea.first_name || ' ' || ea.last_name, 'Administrator'),
    'business_unit_id', e.business_unit_id, 'business_unit', b.name, 'reporting_week_id', e.reporting_week_id,
    'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at, 'weekly_report_id', e.weekly_report_id,
    'submitted_at', e.submitted_at, 'review_status', r.review_status, 'reviewed_by_id', r.reviewed_by,
    'applied_at', e.applied_at, 'apply_reason', e.apply_reason, 'revoked_at', e.revoked_at, 'revoke_reason', e.revoke_reason,
    'amendment', (select jsonb_build_object('old_weekly_score', a.old_weekly_score, 'new_weekly_score', a.new_weekly_score,
                    'old_quarterly_score', a.old_quarterly_score, 'new_quarterly_score', a.new_quarterly_score,
                    'quarter_locked', a.quarter_locked_at_apply) from quarterly_score_amendments a where a.exception_id = e.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('type', ev.event_type, 'at', ev.created_at, 'reason', ev.reason,
                'actor', (select x.first_name || ' ' || x.last_name from users u2 join employees x on x.id = u2.employee_id where u2.id = ev.actor_user_id))
                order by ev.created_at, ev.id) from late_report_exception_events ev where ev.exception_id = e.id), '[]'::jsonb)
  ) order by e.authorised_at desc), '[]'::jsonb)
  from late_report_exceptions e
  join business_units b on b.id = e.business_unit_id
  join reporting_weeks w on w.id = e.reporting_week_id
  left join users ua on ua.id = e.authorised_by left join employees ea on ea.id = ua.employee_id   -- names may be hidden by RLS for BU Leads
  left join weekly_reports r on r.id = e.weekly_report_id;
$$;

-- Missing reports an authorised user could still accept late (final-locked, zero-scored, no live exception).
create or replace function read_late_report_candidates() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('business_unit_id', b.id, 'business_unit', b.name, 'reporting_week_id', w.id,
      'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at,
      'quarter_locked', quarter_is_locked(w.quarter_id)) order by w.week_start_at desc, b.name), '[]'::jsonb)
  from reporting_weeks w
  join business_units b on b.status = 'ACTIVE' and b.reports_weekly and b.created_at < w.week_end_at
  where w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
    and auth_has_permission('quarter.score.amend')
    and (select s.score_state from weekly_score_snapshots s where s.business_unit_id = b.id and s.reporting_week_id = w.id order by s.version_number desc limit 1) = 'NOT_SUBMITTED'
    and not exists (select 1 from late_report_exceptions e where e.business_unit_id = b.id and e.reporting_week_id = w.id and e.status in ('AUTHORISED','SUBMITTED','APPLIED'));
$$;

-- ---------------------------------------------------------------- RLS
alter table late_report_exceptions enable row level security;
alter table late_report_exception_events enable row level security;
alter table quarterly_score_amendments enable row level security;
grant select on late_report_exceptions, late_report_exception_events, quarterly_score_amendments to authenticated;
create policy read_scoped on late_report_exceptions for select to authenticated using (
  auth_has_any(array['quarter.score.amend','weekly_report.review','weekly_report.view_all']) or business_unit_id = auth_bu());
create policy read_scoped on late_report_exception_events for select to authenticated using (
  exists (select 1 from late_report_exceptions e where e.id = exception_id));
create policy read_scoped on quarterly_score_amendments for select to authenticated using (
  auth_has_any(array['quarter.score.amend','weekly_report.view_all']) or business_unit_id = auth_bu());

-- the read model (security invoker) calls report_phase_of, so the grant whitelist must include it
create or replace function lock_down_function_grants() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'lock_down_function_grants' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.proname in ('auth_has_permission','auth_bu','app_now','report_phase','quarter_is_locked','auth_can_view_bu',
                     'goal_is_done','report_goal_counts','calc_base_score','calc_final_score','active_penalty_rate',
                     'auth_has_any','attendance_effective_status','fund_balance','fund_committed','report_phase_of')
       or r.proname like 'read\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- report view: late phase + exception context
create or replace function read_report_view(p_report_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  r weekly_reports; w reporting_weeks; v_phase text; v_goals jsonb; v_total int; v_done int; v_base numeric;
  v_rates numeric; v_snap weekly_score_snapshots; v_comp weekly_compliance; v_outcome text; v_bu business_units;
begin
  select * into r from weekly_reports where id = p_report_id;
  if not found then return null; end if;
  select * into w from reporting_weeks where id = r.reporting_week_id;
  select * into v_bu from business_units where id = r.business_unit_id;
  v_phase := report_phase_of(r);
  select outcome into v_outcome from governance_sessions where reporting_week_id = w.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'title', g.title, 'description', g.description, 'goal_type', g.goal_type, 'position', g.position,
      'status', case when goal_is_done(g.id) then 'DONE' else 'NOT_DONE' end,
      'has_undefined_tasks', exists (select 1 from tasks t where t.smart_goal_id = g.id and t.deleted_at is null and t.status = 'UNDEFINED'),
      'sub_key_result', case when s.id is null then null else jsonb_build_object('id', s.id, 'code', s.code, 'title', s.title, 'kr_code', k.code, 'kr_title', k.title) end,
      'evaluation', (select to_jsonb(e) - 'smart_goal_id' - 'evaluated_by' from smart_evaluations e where e.smart_goal_id = g.id order by e.evaluated_at desc, e.id desc limit 1),
      'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'status', t.status, 'position', t.position) order by t.position)
                         from tasks t where t.smart_goal_id = g.id and t.deleted_at is null), '[]'::jsonb)
    ) order by g.position), '[]'::jsonb)
  into v_goals
  from smart_goals g
  left join sub_key_results s on s.id = g.sub_key_result_id
  left join key_results k on k.id = s.key_result_id
  where g.weekly_report_id = r.id and g.deleted_at is null;

  select total_goals, done_goals into v_total, v_done from report_goal_counts(r.id);
  v_base := calc_base_score(v_done, v_total);
  select coalesce(sum(penalty_rate), 0) into v_rates from integrity_corrections where weekly_report_id = r.id and penalty_decision = 'APPLY';
  select * into v_snap from weekly_score_snapshots where business_unit_id = r.business_unit_id and reporting_week_id = w.id order by version_number desc limit 1;
  select * into v_comp from weekly_compliance where business_unit_id = r.business_unit_id and reporting_week_id = w.id;

  return jsonb_build_object(
    'report', jsonb_build_object('id', r.id, 'status', r.status, 'submission_status', r.submission_status, 'review_status', r.review_status,
      'version', r.version, 'submitted_at', r.submitted_at, 'skipped_session_summary_comment', r.skipped_session_summary_comment,
      'reviewed_at', r.reviewed_at, 'final_locked_at', r.final_locked_at),
    'business_unit', jsonb_build_object('id', v_bu.id, 'code', v_bu.code, 'name', v_bu.name),
    'week', jsonb_build_object('id', w.id, 'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at,
      'content_lock_at', w.content_lock_at, 'final_lock_at', w.final_lock_at, 'reporting_state', w.reporting_state),
    'phase', v_phase,
    'session_outcome', coalesce(v_outcome, 'SCHEDULED'),
    'summary_required', v_outcome = 'SKIPPED',
    'goals', v_goals,
    'score_preview', jsonb_build_object('total_goals', v_total, 'done_goals', v_done, 'base_score', round(v_base, 2),
      'applied_penalty_rate', v_rates, 'final_score', calc_final_score(v_base, v_rates)),
    'snapshot', case when v_snap.id is null then null else jsonb_build_object('version', v_snap.version_number, 'state', v_snap.score_state,
      'base_score', round(v_snap.base_score, 2), 'combined_penalty_rate', v_snap.combined_penalty_rate, 'final_score', v_snap.final_score,
      'applied_penalty_rates', v_snap.applied_penalty_rates, 'reason', v_snap.reason) end,
    'compliance', case when v_comp.id is null then null else jsonb_build_object('status', v_comp.status, 'reason', v_comp.reason) end,
    'late_exception', (select jsonb_build_object('id', e.id, 'status', e.status, 'reason', e.reason, 'authorised_at', e.authorised_at)
                       from late_report_exceptions e where e.id = r.late_exception_id)
  );
end $$;

select lock_down_function_grants();

-- Session-outcome correction (owner decision 3, 14 October 2026; ADR-063; docs/08 "a finalised or skipped outcome is not silently reversible").
-- A HELD or SKIPPED governance session recorded by mistake is REOPENED to SCHEDULED so HR can hold or skip it properly. The wrong roster is
-- never edited or lost: every row is copied to an immutable archive first. Normal path: request, a different person approves, someone other
-- than the requester executes. Emergency path: a Super Admin does all three in one step, alerted and audited.

-- attendance.session.outcome.correct already exists (foundation) and is used here as the right to EXECUTE an approved correction
insert into permissions (code, description) values
  ('attendance.session.outcome.request',   'Request correction of a wrongly recorded session outcome'),
  ('attendance.session.outcome.approve',   'Approve or reject a session-outcome correction'),
  ('attendance.session.outcome.emergency', 'Emergency session-outcome correction in one step (audited and alerted)');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('HR','attendance.session.outcome.request'),('ADMIN','attendance.session.outcome.request'),('SUPER_ADMIN','attendance.session.outcome.request'),
  ('ADMIN','attendance.session.outcome.approve'),('SUPER_ADMIN','attendance.session.outcome.approve'),
  ('ADMIN','attendance.session.outcome.correct'),('SUPER_ADMIN','attendance.session.outcome.correct'),
  ('SUPER_ADMIN','attendance.session.outcome.emergency')
) as g(role_code, perm) join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

alter table governance_sessions add column correction_count int not null default 0;

-- ---------------------------------------------------------------- archive of the roster that was replaced
create table attendance_record_archive (
  id                    uuid primary key,                    -- the original record id
  correction_id         uuid not null,
  governance_session_id uuid not null,
  employee_id           uuid not null,
  business_unit_id      uuid not null,
  status                text not null,
  notes                 text,
  source                text not null,
  created_at            timestamptz not null,
  archived_at           timestamptz not null default app_now(),
  prior_outcome         text not null
);
create index attendance_record_archive_session_idx on attendance_record_archive (governance_session_id);
create trigger attendance_record_archive_immutable before update or delete on attendance_record_archive for each row execute function forbid_mutation();
alter table attendance_record_archive enable row level security;
grant select on attendance_record_archive to authenticated;
create policy read_scoped on attendance_record_archive for select to authenticated using (auth_has_any(array['attendance.session.manage','attendance.session.outcome.request','attendance.session.outcome.approve']));

create table session_outcome_corrections (
  id               uuid primary key default gen_random_uuid(),
  governance_session_id uuid not null references governance_sessions(id) on delete restrict,
  from_outcome     text not null check (from_outcome in ('HELD','SKIPPED')),
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXECUTED')),
  emergency        boolean not null default false,
  requested_by     uuid not null references users(id),
  idempotency_key  text not null unique,
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_comment text,
  decision_key     text unique,
  executed_by      uuid references users(id),
  executed_at      timestamptz,
  execute_key      text unique,
  archived_rows    int,
  created_at       timestamptz not null default app_now(),
  check (emergency or decided_by is null or decided_by <> requested_by),
  check (emergency or executed_by is null or executed_by <> requested_by),
  check (status <> 'REJECTED' or (decision_comment is not null and btrim(decision_comment) <> '')),
  check ((status = 'EXECUTED') = (executed_by is not null)),
  check ((status = 'PENDING') = (decided_by is null))
);
create unique index session_correction_open_one on session_outcome_corrections (governance_session_id) where status in ('PENDING','APPROVED');
create index session_correction_time_idx on session_outcome_corrections (created_at desc);

create or replace function session_correction_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'correction requests are never deleted'; end if;
  if new.governance_session_id <> old.governance_session_id or new.reason <> old.reason or new.requested_by <> old.requested_by
     or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at or new.emergency <> old.emergency or new.from_outcome <> old.from_outcome then
    raise exception 'IMMUTABLE_RECORD' using detail = 'the request itself cannot change';
  end if;
  if not ((old.status = 'PENDING' and new.status in ('APPROVED','REJECTED')) or (old.status = 'APPROVED' and new.status = 'EXECUTED')) then
    raise exception 'IMMUTABLE_RECORD' using detail = old.status || ' cannot become ' || new.status;
  end if;
  return new;
end $$;
create trigger session_outcome_corrections_guard before update or delete on session_outcome_corrections for each row execute function session_correction_guard();

-- ---------------------------------------------------------------- the roster guard gets the one narrow exception
create or replace function guard_attendance_record() returns trigger
language plpgsql as $$
declare s governance_sessions;
begin
  -- the audited session-outcome correction archives the rows first and is the only thing allowed to remove a finalised roster (ADR-063)
  if tg_op = 'DELETE' and coalesce(current_setting('app.session_correction', true), '') = 'on' then return old; end if;
  select * into s from governance_sessions where id = old.governance_session_id;
  if s.roster_status = 'FINALIZED' or s.outcome = 'SKIPPED' then
    if coalesce(current_setting('app.attendance_skip', true), '') = 'on' and tg_op = 'DELETE' and s.roster_status <> 'FINALIZED' then
      return old;
    end if;
    raise exception 'IMMUTABLE_RECORD' using detail = 'finalised attendance cannot be edited or deleted; request an amendment';
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.attendance_skip', true), '') <> 'on' then raise exception 'IMMUTABLE_RECORD' using detail = 'roster rows are not deleted'; end if;
    return old;
  end if;
  if new.governance_session_id <> old.governance_session_id or new.employee_id <> old.employee_id or new.business_unit_id <> old.business_unit_id then
    raise exception 'IMMUTABLE_RECORD';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- applying a correction (internal)
create or replace function apply_session_correction(p_actor uuid, p_session_id uuid, p_correction_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare s governance_sessions; n int; v_amend int;
begin
  select * into s from governance_sessions where id = p_session_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.outcome not in ('HELD','SKIPPED') then raise exception 'SESSION_NOT_CORRECTABLE' using detail = 'the session is ' || s.outcome || ': there is nothing to correct'; end if;
  select count(*) into v_amend from attendance_amendment_requests r join attendance_records a on a.id = r.attendance_record_id where a.governance_session_id = p_session_id;
  if v_amend > 0 then
    raise exception 'SESSION_CORRECTION_BLOCKED' using detail = v_amend || ' attendance amendment(s) refer to this roster; their history cannot be detached from it';
  end if;
  insert into attendance_record_archive (id, correction_id, governance_session_id, employee_id, business_unit_id, status, notes, source, created_at, prior_outcome)
    select id, p_correction_id, governance_session_id, employee_id, business_unit_id, status, notes, source, created_at, s.outcome from attendance_records where governance_session_id = p_session_id;
  get diagnostics n = row_count;
  perform set_config('app.session_correction', 'on', true);
  delete from attendance_records where governance_session_id = p_session_id;
  perform set_config('app.session_correction', 'off', true);
  update governance_sessions set outcome = 'SCHEDULED', outcome_at = null, outcome_by = null, skip_operation_ref = null, staff_tagged_count = null, skip_idempotency_key = null,
         roster_status = 'NONE', roster_created_at = null, roster_created_by = null, roster_staff_count = null, roster_finalised_at = null, roster_finalised_by = null,
         correction_count = correction_count + 1, updated_at = app_now()
   where id = p_session_id;
  perform notify_users(users_with_permission('attendance.session.manage'), 'SESSION_OUTCOME_CORRECTED', 'governance_session', p_session_id::text,
    'A session outcome was corrected', 'The session is open again (it was recorded as ' || s.outcome || '). Create the roster and finalise it, or skip it, as it should have been. The earlier roster is archived.', 'sess-corr:' || p_correction_id);
  if s.outcome = 'SKIPPED' then
    perform notify_users(users_with_role('BU_LEAD'), 'SESSION_OUTCOME_CORRECTED', 'reporting_week', s.reporting_week_id::text,
      'The OKR session skip was withdrawn', 'The skip recorded for this week was a mistake. Weekly reporting stays mandatory either way.', 'sess-corr-bu:' || p_correction_id);
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- 1. request
create or replace function request_session_correction(p_actor uuid, p_session_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ex session_outcome_corrections; s governance_sessions; v_id uuid;
begin
  perform require_permission(p_actor, 'attendance.session.outcome.request');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from session_outcome_corrections where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.governance_session_id <> p_session_id or v_ex.requested_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  select * into s from governance_sessions where id = p_session_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.outcome not in ('HELD','SKIPPED') then raise exception 'SESSION_NOT_CORRECTABLE' using detail = 'the session is ' || s.outcome; end if;
  if exists (select 1 from session_outcome_corrections where governance_session_id = p_session_id and status in ('PENDING','APPROVED')) then raise exception 'SESSION_CORRECTION_PENDING'; end if;
  insert into session_outcome_corrections (governance_session_id, from_outcome, reason, requested_by, idempotency_key) values (p_session_id, s.outcome, btrim(p_reason), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'SESSION_CORRECTION_REQUESTED', 'session_outcome_correction', v_id::text, jsonb_build_object('outcome', s.outcome), jsonb_build_object('proposed', 'SCHEDULED', 'session_id', p_session_id), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('attendance.session.outcome.approve'), p_actor), 'SESSION_CORRECTION_REQUESTED', 'session_outcome_correction', v_id::text,
    'A session-outcome correction needs your decision', 'Someone asked to reopen a session recorded as ' || s.outcome || '. Reason given: ' || btrim(p_reason), 'sess-req:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'PENDING');
end $$;

-- ---------------------------------------------------------------- 2. independent decision
create or replace function decide_session_correction(p_actor uuid, p_request_id uuid, p_decision text, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r session_outcome_corrections; v_prev session_outcome_corrections;
begin
  perform require_permission(p_actor, 'attendance.session.outcome.approve');
  if p_decision is null or p_decision not in ('APPROVE','REJECT') then raise exception 'VALIDATION_ERROR' using detail = 'decision must be APPROVE or REJECT'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from session_outcome_corrections where decision_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.decided_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'status', v_prev.status);
  end if;
  select * into r from session_outcome_corrections where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'SESSION_CORRECTION_NOT_PENDING'; end if;
  if r.requested_by = p_actor then raise exception 'SESSION_CORRECTION_SELF_APPROVAL'; end if;
  if p_decision = 'REJECT' and (p_comment is null or btrim(p_comment) = '') then raise exception 'REASON_REQUIRED'; end if;
  update session_outcome_corrections set status = case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end, decided_by = p_actor, decided_at = app_now(),
    decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decision_key = p_idempotency_key where id = r.id;
  perform write_audit(p_actor, case p_decision when 'APPROVE' then 'SESSION_CORRECTION_APPROVED' else 'SESSION_CORRECTION_REJECTED' end, 'session_outcome_correction', r.id::text,
    jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end), nullif(btrim(coalesce(p_comment, '')), ''));
  perform notify_users(array[r.requested_by], 'SESSION_CORRECTION_DECIDED', 'session_outcome_correction', r.id::text,
    case p_decision when 'APPROVE' then 'Your session correction was approved' else 'Your session correction was rejected' end,
    case p_decision when 'APPROVE' then 'It now waits to be executed by someone other than you.' else 'Reason: ' || btrim(p_comment) end, 'sess-dec:' || r.id);
  if p_decision = 'APPROVE' then
    perform notify_users(array_remove(users_with_permission('attendance.session.outcome.correct'), r.requested_by), 'SESSION_CORRECTION_APPROVED', 'session_outcome_correction', r.id::text,
      'A session correction is ready to execute', 'An approved correction is waiting.', 'sess-ready:' || r.id);
  end if;
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end);
end $$;

-- ---------------------------------------------------------------- 3. separate execution
create or replace function execute_session_correction(p_actor uuid, p_request_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r session_outcome_corrections; v_prev session_outcome_corrections; n int;
begin
  perform require_permission(p_actor, 'attendance.session.outcome.correct');
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from session_outcome_corrections where execute_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.executed_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'archived_rows', v_prev.archived_rows);
  end if;
  select * into r from session_outcome_corrections where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'APPROVED' then raise exception 'SESSION_CORRECTION_NOT_APPROVED'; end if;
  if r.requested_by = p_actor then raise exception 'SESSION_CORRECTION_SELF_APPROVAL'; end if;
  n := apply_session_correction(p_actor, r.governance_session_id, r.id);
  update session_outcome_corrections set status = 'EXECUTED', executed_by = p_actor, executed_at = app_now(), execute_key = p_idempotency_key, archived_rows = n where id = r.id;
  perform write_audit(p_actor, 'SESSION_CORRECTION_EXECUTED', 'session_outcome_correction', r.id::text, jsonb_build_object('outcome', r.from_outcome),
    jsonb_build_object('outcome', 'SCHEDULED', 'archived_rows', n, 'requested_by', r.requested_by, 'approved_by', r.decided_by, 'session_id', r.governance_session_id));
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'archived_rows', n);
end $$;

-- ---------------------------------------------------------------- emergency
create or replace function emergency_session_correction(p_actor uuid, p_session_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ex session_outcome_corrections; s governance_sessions; v_id uuid := gen_random_uuid(); n int;
begin
  perform require_permission(p_actor, 'attendance.session.outcome.emergency');
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'REASON_REQUIRED' using detail = 'an emergency correction needs a full reason (at least 10 characters)'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from session_outcome_corrections where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.governance_session_id <> p_session_id or v_ex.requested_by <> p_actor or not v_ex.emergency then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'archived_rows', v_ex.archived_rows);
  end if;
  select * into s from governance_sessions where id = p_session_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from session_outcome_corrections where governance_session_id = p_session_id and status in ('PENDING','APPROVED')) then raise exception 'SESSION_CORRECTION_PENDING' using detail = 'finish or reject the open request first'; end if;
  n := apply_session_correction(p_actor, p_session_id, v_id);
  insert into session_outcome_corrections (id, governance_session_id, from_outcome, reason, status, emergency, requested_by, idempotency_key, decided_by, decided_at, decision_comment, decision_key,
                                           executed_by, executed_at, execute_key, archived_rows)
    values (v_id, p_session_id, s.outcome, btrim(p_reason), 'EXECUTED', true, p_actor, p_idempotency_key, p_actor, app_now(), 'Emergency override', 'em-d:' || v_id, p_actor, app_now(), 'em-x:' || v_id, n);
  perform write_audit(p_actor, 'SESSION_CORRECTION_EMERGENCY', 'session_outcome_correction', v_id::text, jsonb_build_object('outcome', s.outcome),
    jsonb_build_object('outcome', 'SCHEDULED', 'archived_rows', n, 'emergency', true, 'session_id', p_session_id), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('attendance.session.manage') || users_with_permission('attendance.session.outcome.approve'), p_actor), 'SESSION_CORRECTION_EMERGENCY', 'session_outcome_correction', v_id::text,
    'EMERGENCY session-outcome correction', 'A Super Admin reopened a session recorded as ' || s.outcome || ' without the usual second person. Reason: ' || btrim(p_reason), 'sess-em:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'archived_rows', n, 'emergency', true);
end $$;

-- ---------------------------------------------------------------- read model + RLS
create or replace function read_session_corrections() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not auth_has_any(array['attendance.session.manage','attendance.session.outcome.request','attendance.session.outcome.approve']) then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'status', c.status, 'emergency', c.emergency, 'reason', c.reason, 'from_outcome', c.from_outcome, 'created_at', c.created_at, 'decided_at', c.decided_at, 'executed_at', c.executed_at,
    'decision_comment', c.decision_comment, 'archived_rows', c.archived_rows, 'requested_by_id', c.requested_by, 'session_id', c.governance_session_id,
    'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at,
    'requested_by', (select em.first_name || ' ' || em.last_name from users u join employees em on em.id = u.employee_id where u.id = c.requested_by),
    'decided_by', (select em.first_name || ' ' || em.last_name from users u join employees em on em.id = u.employee_id where u.id = c.decided_by),
    'executed_by', (select em.first_name || ' ' || em.last_name from users u join employees em on em.id = u.employee_id where u.id = c.executed_by)
  ) order by c.created_at desc) from session_outcome_corrections c join governance_sessions gs on gs.id = c.governance_session_id join reporting_weeks w on w.id = gs.reporting_week_id), '[]'::jsonb);
end $$;

alter table session_outcome_corrections enable row level security;
grant select on session_outcome_corrections to authenticated;
create policy read_scoped on session_outcome_corrections for select to authenticated using (auth_has_any(array['attendance.session.manage','attendance.session.outcome.request','attendance.session.outcome.approve']));

select lock_down_function_grants();

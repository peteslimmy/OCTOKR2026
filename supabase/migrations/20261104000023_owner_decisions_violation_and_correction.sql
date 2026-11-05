-- Owner decisions of 4 November 2026 (ADR-086).
--  1. A violation is never reopened, even when its payment is reversed in the ledger. Supersedes ADR-065 / migration 20261019000010.
--  2. Correcting a skipped (or held) session CANCELS the attendance amendments that refer to its roster instead of refusing the correction.
--     Supersedes the SESSION_CORRECTION_BLOCKED rule of ADR-063.
-- Nothing is deleted from either history: reversed payments, cancelled amendments and their events all stay on record.

-- ================================================================== 1. payment reversal no longer reopens the violation
create or replace function post_ledger_reversal(p_actor uuid, p_entry_id uuid, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare e financial_ledger_entries; v_new uuid; vio violations;
begin
  select * into e from financial_ledger_entries where id = p_entry_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from violation_funds where id = e.fund_id for update;
  if e.source_type = 'REVERSAL' then raise exception 'LEDGER_ENTRY_NOT_REVERSIBLE' using detail = 'a reversal entry cannot itself be reversed'; end if;
  if exists (select 1 from financial_ledger_entries where reverses_entry_id = e.id) then raise exception 'LEDGER_ENTRY_ALREADY_REVERSED'; end if;
  -- cancelling money that came in must not take back money already promised to approved disbursements
  if e.entry_type = 'CREDIT' and fund_balance(e.fund_id) - e.amount < fund_committed(e.fund_id) then
    raise exception 'INSUFFICIENT_FUNDS' using detail = 'approved disbursements are committed against this money';
  end if;
  insert into financial_ledger_entries (fund_id, entry_type, amount, source_type, source_id, reference, created_by, reverses_entry_id)
    values (e.fund_id, case e.entry_type when 'CREDIT' then 'DEBIT' else 'CREDIT' end, e.amount, 'REVERSAL', p_request_id, 'RV-' || p_request_id, p_actor, e.id)
    returning id into v_new;     -- the ledger itself still refuses a DEBIT that would make the fund negative
  -- The violation stays settled (owner decision, ADR-086). The audit trail records that its money was taken back,.
  if e.source_type = 'VIOLATION_PAYMENT' then
    select v.* into vio from violations v join violation_payments p on p.violation_id = v.id where p.id = e.source_id;
    if found then
      perform write_audit(p_actor, 'VIOLATION_PAYMENT_REVERSED', 'violation', vio.id::text, jsonb_build_object('status', vio.status),
        jsonb_build_object('status', vio.status, 'reversal_entry_id', v_new, 'reversed_entry_id', e.id), null, vio.business_unit_id);
    end if;
  end if;
  return v_new;
end $$;

-- HR still sees the payment (marked reversed) on the violation, because the violation stays settled.
do $$
declare v_def text; v_old text := 'and not read_payment_is_reversed(p.id) order by';
begin
  v_def := pg_get_functiondef('read_violations()'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'read_violations no longer contains the expected payment filter'; end if;
  v_def := replace(v_def, v_old, 'order by');
  if position('''paid_at'', p.paid_at)' in v_def) = 0 then raise exception 'read_violations no longer contains the expected payment object'; end if;
  v_def := replace(v_def, '''paid_at'', p.paid_at)', '''paid_at'', p.paid_at, ''reversed'', read_payment_is_reversed(p.id))');
  execute v_def;
end $$;

-- ================================================================== 2. session correction cancels amendments
-- The amendment is kept as history. Its record is archived (same id) by the correction and removed from the live roster, so the foreign key goes.
alter table attendance_amendment_requests drop constraint if exists attendance_amendment_requests_attendance_record_id_fkey;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'attendance_amendment_requests'::regclass and contype = 'c'
            and (pg_get_constraintdef(oid) like '%APPROVED%' or pg_get_constraintdef(oid) like '%decided_at IS NOT NULL%') loop
    execute format('alter table attendance_amendment_requests drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'attendance_amendment_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%STALE_REJECTED%' loop
    execute format('alter table attendance_amendment_events drop constraint %I', c.conname);
  end loop;
end $$;
alter table attendance_amendment_requests add constraint attendance_amendment_requests_status_check check (status in ('PENDING','APPROVED','REJECTED','CANCELLED'));
alter table attendance_amendment_requests add constraint attendance_amendment_requests_decided_check
  check (status in ('PENDING','CANCELLED') or (decided_by is not null and decided_at is not null));
alter table attendance_amendment_events add constraint attendance_amendment_events_type_check
  check (event_type in ('SUBMITTED','APPROVED','REJECTED','STALE_REJECTED','CANCELLED'));

-- Every amendment cancelled by a correction, whatever state it was in (a decided one keeps its decision; this row says it no longer applies).
create table attendance_amendment_cancellations (
  request_id    uuid primary key references attendance_amendment_requests(id) on delete restrict,
  correction_id uuid not null,
  prior_status  text not null check (prior_status in ('PENDING','APPROVED','REJECTED')),
  cancelled_by  uuid not null references users(id),
  cancelled_at  timestamptz not null default app_now()
);
create index attendance_amendment_cancellations_correction_idx on attendance_amendment_cancellations (correction_id);
create trigger attendance_amendment_cancellations_immutable before update or delete on attendance_amendment_cancellations for each row execute function forbid_mutation();
alter table attendance_amendment_cancellations enable row level security;
grant select on attendance_amendment_cancellations to authenticated;
create policy read_scoped on attendance_amendment_cancellations for select to authenticated
  using ((select auth_has_any(array['attendance.session.manage','attendance.session.outcome.request','attendance.session.outcome.approve'])));

create or replace function apply_session_correction(p_actor uuid, p_session_id uuid, p_correction_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare s governance_sessions; n int; v_amend int;
begin
  select * into s from governance_sessions where id = p_session_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.outcome not in ('HELD','SKIPPED') then raise exception 'SESSION_NOT_CORRECTABLE' using detail = 'the session is ' || s.outcome || ': there is nothing to correct'; end if;

  -- Amendments to the roster being replaced no longer apply to anything: cancel them (owner decision, ADR-086), history kept.
  insert into attendance_amendment_cancellations (request_id, correction_id, prior_status, cancelled_by)
    select r.id, p_correction_id, r.status, p_actor
      from attendance_amendment_requests r join attendance_records a on a.id = r.attendance_record_id
     where a.governance_session_id = p_session_id and r.status in ('PENDING','APPROVED','REJECTED');
  get diagnostics v_amend = row_count;
  if v_amend > 0 then
    insert into attendance_amendment_events (request_id, event_type, actor_user_id, source_status, effective_status, proposed_status, reason)
      select r.id, 'CANCELLED', p_actor, r.source_status_snapshot, r.effective_status_snapshot, r.proposed_status, 'the session outcome was corrected and its roster archived'
        from attendance_amendment_requests r join attendance_amendment_cancellations c on c.request_id = r.id where c.correction_id = p_correction_id;
    update attendance_amendment_requests r set status = 'CANCELLED'
     where r.status = 'PENDING' and r.id in (select request_id from attendance_amendment_cancellations where correction_id = p_correction_id);
    perform write_audit(p_actor, 'ATTENDANCE_AMENDMENTS_CANCELLED_BY_CORRECTION', 'governance_session', p_session_id::text, null,
      jsonb_build_object('cancelled', v_amend, 'correction_id', p_correction_id), null, null);
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
    'A session outcome was corrected', 'The session is open again (it was recorded as ' || s.outcome || '). Create the roster and finalise it, or skip it, as it should have been. The earlier roster is archived'
      || case when v_amend > 0 then ' and ' || v_amend || ' attendance amendment(s) that referred to it were cancelled.' else '.' end, 'sess-corr:' || p_correction_id);
  if s.outcome = 'SKIPPED' then
    perform notify_users(users_with_role('BU_LEAD'), 'SESSION_OUTCOME_CORRECTED', 'reporting_week', s.reporting_week_id::text,
      'The OKR session skip was withdrawn', 'The skip recorded for this week was a mistake. Weekly reporting stays mandatory either way.', 'sess-corr-bu:' || p_correction_id);
  end if;
  return n;
end $$;

select lock_down_function_grants();

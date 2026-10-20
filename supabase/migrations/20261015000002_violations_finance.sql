-- Milestone 2b: violations, payments, violation fund, append-only ledger, disbursement workflow.
-- Money: numeric(19,2) only. The ledger is authoritative; balance = sum(credits) - sum(debits). NGN only.

create table violation_types (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  criticality  text not null check (criticality in ('LOW','MEDIUM','HIGH','CRITICAL')),
  default_fine numeric(19,2) not null check (default_fine > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default app_now(),
  updated_at   timestamptz not null default app_now()
);

create table violations (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references employees(id) on delete restrict,
  business_unit_id      uuid not null references business_units(id) on delete restrict,   -- BU at the time
  governance_session_id uuid references governance_sessions(id) on delete restrict,
  violation_type_id     uuid not null references violation_types(id) on delete restrict,
  criticality           text not null,                                     -- snapshot (DEC-012 recommendation)
  fine_amount           numeric(19,2) not null check (fine_amount > 0),    -- snapshot
  fine_override_reason  text,
  notes                 text check (notes is null or char_length(notes) <= 2000),
  status                text not null default 'OPEN' check (status in ('OPEN','PAID','DEDUCTION_RECORDED')),
  created_by            uuid not null references users(id),
  idempotency_key       text not null unique,
  created_at            timestamptz not null default app_now(),
  updated_at            timestamptz not null default app_now()
);
create index violations_employee_idx on violations (employee_id);
create index violations_status_idx on violations (status);

create table violation_funds (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references organisations(id) on delete restrict,
  currency_code   char(3) not null default 'NGN' check (currency_code = 'NGN'),
  name            text not null default 'Violation Fund',
  created_at      timestamptz not null default app_now()
);

create table financial_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,        -- authoritative posting order (timestamps can tie)
  fund_id         uuid not null references violation_funds(id) on delete restrict,
  entry_type      text not null check (entry_type in ('CREDIT','DEBIT')),
  amount          numeric(19,2) not null check (amount > 0),
  source_type     text not null check (source_type in ('VIOLATION_PAYMENT','DISBURSEMENT','REVERSAL')),
  source_id       uuid not null,
  reference       text not null unique,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default app_now()
);
create index ledger_fund_idx on financial_ledger_entries (fund_id, seq);
create unique index ledger_source_idx on financial_ledger_entries (source_type, source_id, entry_type);
create trigger ledger_immutable before update or delete on financial_ledger_entries for each row execute function forbid_mutation();
create trigger ledger_no_truncate before truncate on financial_ledger_entries for each statement execute function forbid_mutation();

create table violation_payments (
  id              uuid primary key default gen_random_uuid(),
  violation_id    uuid not null unique references violations(id) on delete restrict,     -- at most one payment per violation
  method          text not null check (method in ('PAYMENT','SALARY_DEDUCTION')),
  amount          numeric(19,2) not null check (amount > 0),
  reference       text not null unique,
  paid_at         date not null,
  recorded_by     uuid not null references users(id),
  idempotency_key text not null unique,
  created_at      timestamptz not null default app_now()
);
create trigger violation_payments_immutable before update or delete on violation_payments for each row execute function forbid_mutation();

create table disbursement_requests (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references violation_funds(id) on delete restrict,
  amount          numeric(19,2) not null check (amount > 0),
  purpose         text not null check (btrim(purpose) <> ''),
  justification   text not null check (btrim(justification) <> ''),
  status          text not null default 'SUBMITTED' check (status in ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','DISBURSED')),
  requested_by    uuid not null references users(id),
  idempotency_key text not null unique,
  created_at      timestamptz not null default app_now(),
  updated_at      timestamptz not null default app_now()
);
create index disbursement_status_idx on disbursement_requests (status);

create table disbursement_decisions (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references disbursement_requests(id) on delete restrict,
  decision        text not null check (decision in ('APPROVED','REJECTED')),
  reason          text,
  decided_by      uuid not null references users(id),
  idempotency_key text not null unique,
  created_at      timestamptz not null default app_now(),
  unique (request_id),
  check (decision <> 'REJECTED' or (reason is not null and btrim(reason) <> ''))
);
create trigger disbursement_decisions_immutable before update or delete on disbursement_decisions for each row execute function forbid_mutation();

create table disbursements (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null unique references disbursement_requests(id) on delete restrict,
  amount          numeric(19,2) not null check (amount > 0),
  reference       text not null unique,
  disbursed_by    uuid not null references users(id),
  idempotency_key text not null unique,
  created_at      timestamptz not null default app_now()
);
create trigger disbursements_immutable before update or delete on disbursements for each row execute function forbid_mutation();

-- Request status may only advance along the lifecycle; terminal states never change.
create or replace function guard_disbursement_request() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD'; end if;
  if new.amount <> old.amount or new.fund_id <> old.fund_id or new.requested_by <> old.requested_by or new.purpose <> old.purpose or new.justification <> old.justification then
    raise exception 'IMMUTABLE_RECORD';
  end if;
  if new.status <> old.status and not (
       (old.status = 'SUBMITTED'    and new.status in ('UNDER_REVIEW','APPROVED','REJECTED'))
    or (old.status = 'UNDER_REVIEW' and new.status in ('APPROVED','REJECTED'))
    or (old.status = 'APPROVED'     and new.status = 'DISBURSED')) then
    raise exception 'INVALID_STATE_TRANSITION' using detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end $$;
create trigger disbursement_requests_guard before update or delete on disbursement_requests for each row execute function guard_disbursement_request();

-- ---------------------------------------------------------------- money helpers
create or replace function ensure_violation_fund() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from violation_funds limit 1;
  if v_id is null then
    insert into violation_funds (organisation_id) select id from organisations limit 1 on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from violation_funds limit 1; end if;
  end if;
  if v_id is null then raise exception 'ORGANISATION_NOT_CONFIGURED'; end if;
  return v_id;
end $$;

create or replace function fund_balance(p_fund uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case entry_type when 'CREDIT' then amount else -amount end), 0)::numeric(19,2) from financial_ledger_entries where fund_id = p_fund;
$$;

-- Approved-but-not-yet-disbursed requests are committed against the fund so approvals cannot over-promise.
create or replace function fund_committed(p_fund uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::numeric(19,2) from disbursement_requests where fund_id = p_fund and status = 'APPROVED';
$$;

-- Defence in depth: the ledger itself refuses a DEBIT that would make the fund negative.
create or replace function ledger_guard_balance() returns trigger
language plpgsql as $$
begin
  perform 1 from violation_funds where id = new.fund_id for update;
  if new.entry_type = 'DEBIT' and fund_balance(new.fund_id) - new.amount < 0 then
    raise exception 'INSUFFICIENT_FUNDS' using detail = 'the fund balance can never go negative';
  end if;
  return new;
end $$;
create trigger ledger_balance_guard before insert on financial_ledger_entries for each row execute function ledger_guard_balance();

-- ---------------------------------------------------------------- violation types
create or replace function create_violation_type(p_actor uuid, p_code text, p_name text, p_criticality text, p_default_fine numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require_permission(p_actor, 'violation.edit');
  begin
    insert into violation_types (code, name, criticality, default_fine) values (upper(btrim(p_code)), btrim(p_name), p_criticality, p_default_fine) returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'code already exists';
            when check_violation then raise exception 'VALIDATION_ERROR' using detail = 'invalid criticality or fine'; end;
  perform write_audit(p_actor, 'VIOLATION_TYPE_CREATED', 'violation_type', v_id::text, null, jsonb_build_object('code', upper(btrim(p_code)), 'criticality', p_criticality, 'default_fine', p_default_fine));
  return v_id;
end $$;

create or replace function update_violation_type(p_actor uuid, p_id uuid, p_name text, p_criticality text, p_default_fine numeric, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old violation_types;
begin
  perform require_permission(p_actor, 'violation.edit');
  select * into v_old from violation_types where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  begin
    update violation_types set name = btrim(p_name), criticality = p_criticality, default_fine = p_default_fine, active = p_active, updated_at = app_now() where id = p_id;
  exception when check_violation then raise exception 'VALIDATION_ERROR' using detail = 'invalid criticality or fine'; end;
  -- existing violations keep their snapshotted fine/criticality; changes affect future records only
  perform write_audit(p_actor, 'VIOLATION_TYPE_UPDATED', 'violation_type', p_id::text,
    jsonb_build_object('criticality', v_old.criticality, 'default_fine', v_old.default_fine, 'active', v_old.active),
    jsonb_build_object('criticality', p_criticality, 'default_fine', p_default_fine, 'active', p_active));
end $$;

-- ---------------------------------------------------------------- violations
create or replace function create_violation(
  p_actor uuid, p_employee uuid, p_session uuid, p_type uuid, p_fine_override numeric, p_override_reason text, p_notes text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare vt violation_types; emp employees; s governance_sessions; v_id uuid; v_fine numeric(19,2); v_existing violations;
begin
  perform require_permission(p_actor, 'violation.create');
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_existing from violations where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('violation_id', v_existing.id, 'replayed', true); end if;
  select * into vt from violation_types where id = p_type and active;
  if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown or inactive violation type'; end if;
  select * into emp from employees where id = p_employee;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_session is not null then
    select * into s from governance_sessions where id = p_session;
    if not found then raise exception 'NOT_FOUND'; end if;
    -- a skipped session is not an absence: no attendance-based violation may be raised against it
    if s.outcome = 'SKIPPED' then raise exception 'VIOLATION_NOT_ALLOWED_SKIPPED_SESSION'; end if;
  end if;
  if p_fine_override is not null then
    if p_override_reason is null or btrim(p_override_reason) = '' then raise exception 'REASON_REQUIRED' using detail = 'a fine override needs a reason'; end if;
    if p_fine_override <= 0 then raise exception 'VALIDATION_ERROR' using detail = 'fine must be positive'; end if;
    v_fine := p_fine_override;
  else
    v_fine := vt.default_fine;
  end if;
  insert into violations (employee_id, business_unit_id, governance_session_id, violation_type_id, criticality, fine_amount, fine_override_reason, notes, created_by, idempotency_key)
    values (p_employee, emp.business_unit_id, p_session, p_type, vt.criticality, v_fine, nullif(btrim(p_override_reason), ''), nullif(btrim(p_notes), ''), p_actor, p_idempotency_key)
    returning id into v_id;
  perform write_audit(p_actor, 'VIOLATION_CREATED', 'violation', v_id::text, null,
    jsonb_build_object('employee_id', p_employee, 'type', vt.code, 'fine', v_fine, 'criticality', vt.criticality, 'overridden', p_fine_override is not null), nullif(btrim(p_override_reason), ''), emp.business_unit_id);
  return jsonb_build_object('violation_id', v_id, 'replayed', false, 'fine_amount', v_fine);
end $$;

create or replace function update_violation(p_actor uuid, p_id uuid, p_fine numeric, p_reason text, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v violations;
begin
  perform require_permission(p_actor, 'violation.edit');
  select * into v from violations where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'OPEN' then raise exception 'VIOLATION_ALREADY_SETTLED'; end if;
  if p_fine is not null and p_fine <> v.fine_amount then
    if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
    if p_fine <= 0 then raise exception 'VALIDATION_ERROR' using detail = 'fine must be positive'; end if;
  end if;
  update violations set fine_amount = coalesce(p_fine, fine_amount), fine_override_reason = case when p_fine is not null and p_fine <> v.fine_amount then btrim(p_reason) else fine_override_reason end,
         notes = coalesce(nullif(btrim(p_notes), ''), notes), updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'VIOLATION_UPDATED', 'violation', p_id::text, jsonb_build_object('fine', v.fine_amount), jsonb_build_object('fine', coalesce(p_fine, v.fine_amount)), nullif(btrim(p_reason), ''), v.business_unit_id);
end $$;

-- Payment + violation state + ledger CREDIT in ONE transaction (AC-FIN-007).
create or replace function record_violation_payment(p_actor uuid, p_violation uuid, p_method text, p_reference text, p_paid_at date, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v violations; v_fund uuid; v_pay violation_payments; v_pid uuid; v_lid uuid;
begin
  perform require_permission(p_actor, 'violation.payment.record');
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_reference is null or btrim(p_reference) = '' then raise exception 'VALIDATION_ERROR' using detail = 'payment reference required'; end if;
  if p_method not in ('PAYMENT','SALARY_DEDUCTION') then raise exception 'VALIDATION_ERROR' using detail = 'invalid method'; end if;
  select * into v_pay from violation_payments where idempotency_key = p_idempotency_key;
  if found then
    if v_pay.violation_id <> p_violation then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('payment_id', v_pay.id, 'replayed', true);
  end if;
  v_fund := ensure_violation_fund();
  perform 1 from violation_funds where id = v_fund for update;          -- serialise money movement
  select * into v from violations where id = p_violation for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'OPEN' then raise exception 'VIOLATION_ALREADY_SETTLED'; end if;
  begin
    insert into violation_payments (violation_id, method, amount, reference, paid_at, recorded_by, idempotency_key)
      values (p_violation, p_method, v.fine_amount, btrim(p_reference), p_paid_at, p_actor, p_idempotency_key) returning id into v_pid;
  exception when unique_violation then raise exception 'DUPLICATE_PAYMENT' using detail = 'payment reference already used'; end;
  insert into financial_ledger_entries (fund_id, entry_type, amount, source_type, source_id, reference, created_by)
    values (v_fund, 'CREDIT', v.fine_amount, 'VIOLATION_PAYMENT', v_pid, 'VP-' || v_pid, p_actor) returning id into v_lid;
  update violations set status = case p_method when 'PAYMENT' then 'PAID' else 'DEDUCTION_RECORDED' end, updated_at = app_now() where id = p_violation;
  perform write_audit(p_actor, 'VIOLATION_PAYMENT_RECORDED', 'violation', p_violation::text, jsonb_build_object('status', 'OPEN'),
    jsonb_build_object('status', case p_method when 'PAYMENT' then 'PAID' else 'DEDUCTION_RECORDED' end, 'amount', v.fine_amount, 'ledger_entry_id', v_lid, 'reference', btrim(p_reference)), null, v.business_unit_id);
  return jsonb_build_object('payment_id', v_pid, 'ledger_entry_id', v_lid, 'amount', v.fine_amount, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- disbursement workflow
create or replace function create_disbursement_request(p_actor uuid, p_amount numeric, p_purpose text, p_justification text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_fund uuid; v_id uuid; v_existing disbursement_requests; v_avail numeric;
begin
  perform require_permission(p_actor, 'disbursement.create');
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_existing from disbursement_requests where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('request_id', v_existing.id, 'replayed', true); end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'VALIDATION_ERROR' using detail = 'amount must be a positive NGN value with at most 2 decimals'; end if;
  if p_purpose is null or btrim(p_purpose) = '' or p_justification is null or btrim(p_justification) = '' then raise exception 'VALIDATION_ERROR' using detail = 'purpose and justification are required'; end if;
  v_fund := ensure_violation_fund();
  v_avail := fund_balance(v_fund) - fund_committed(v_fund);
  if p_amount > v_avail then raise exception 'INSUFFICIENT_FUNDS' using detail = 'available: ' || v_avail; end if;
  insert into disbursement_requests (fund_id, amount, purpose, justification, requested_by, idempotency_key) values (v_fund, p_amount, btrim(p_purpose), btrim(p_justification), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'DISBURSEMENT_REQUESTED', 'disbursement_request', v_id::text, null, jsonb_build_object('amount', p_amount, 'purpose', btrim(p_purpose)), btrim(p_justification));
  perform notify_users(array(select u from unnest(users_with_permission('disbursement.approve')) u where u <> p_actor), 'DISBURSEMENT_REQUESTED', 'disbursement_request', v_id::text,
    'Disbursement request needs a decision', 'A violation-fund disbursement request is waiting in your approval queue.', 'dr-new:' || v_id);
  return jsonb_build_object('request_id', v_id, 'replayed', false);
end $$;

create or replace function start_disbursement_review(p_actor uuid, p_request_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r disbursement_requests;
begin
  perform require_permission(p_actor, 'disbursement.approve');
  select * into r from disbursement_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requested_by = p_actor then raise exception 'DISBURSEMENT_SELF_APPROVAL'; end if;
  if r.status = 'UNDER_REVIEW' then return; end if;
  if r.status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = r.status; end if;
  update disbursement_requests set status = 'UNDER_REVIEW', updated_at = app_now() where id = p_request_id;
  perform write_audit(p_actor, 'DISBURSEMENT_REVIEW_STARTED', 'disbursement_request', p_request_id::text, jsonb_build_object('status', 'SUBMITTED'), jsonb_build_object('status', 'UNDER_REVIEW'));
end $$;

create or replace function decide_disbursement_request(p_actor uuid, p_request_id uuid, p_approve boolean, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r disbursement_requests; d disbursement_decisions; v_avail numeric; v_fund violation_funds;
begin
  perform require_permission(p_actor, case when p_approve then 'disbursement.approve' else 'disbursement.reject' end);
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into d from disbursement_decisions where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('request_id', d.request_id, 'decision', d.decision, 'replayed', true); end if;
  select * into r from disbursement_requests where id = p_request_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_fund from violation_funds where id = r.fund_id for update;        -- serialise concurrent approvals
  select * into r from disbursement_requests where id = p_request_id for update;
  if r.requested_by = p_actor then raise exception 'DISBURSEMENT_SELF_APPROVAL'; end if;   -- segregation of duties, enforced here not in the UI
  if r.status not in ('SUBMITTED','UNDER_REVIEW') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;
  if not p_approve and (p_reason is null or btrim(p_reason) = '') then raise exception 'DISBURSEMENT_REJECTION_REASON_REQUIRED'; end if;
  if p_approve then
    v_avail := fund_balance(r.fund_id) - fund_committed(r.fund_id);
    if r.amount > v_avail then raise exception 'INSUFFICIENT_FUNDS' using detail = 'available: ' || v_avail; end if;
  end if;
  insert into disbursement_decisions (request_id, decision, reason, decided_by, idempotency_key)
    values (p_request_id, case when p_approve then 'APPROVED' else 'REJECTED' end, nullif(btrim(p_reason), ''), p_actor, p_idempotency_key);
  update disbursement_requests set status = case when p_approve then 'APPROVED' else 'REJECTED' end, updated_at = app_now() where id = p_request_id;
  perform write_audit(p_actor, case when p_approve then 'DISBURSEMENT_APPROVED' else 'DISBURSEMENT_REJECTED' end, 'disbursement_request', p_request_id::text,
    jsonb_build_object('status', r.status), jsonb_build_object('status', case when p_approve then 'APPROVED' else 'REJECTED' end, 'amount', r.amount), nullif(btrim(p_reason), ''));
  perform notify_users(array[r.requested_by], case when p_approve then 'DISBURSEMENT_APPROVED' else 'DISBURSEMENT_REJECTED' end, 'disbursement_request', p_request_id::text,
    case when p_approve then 'Disbursement approved' else 'Disbursement rejected' end,
    case when p_approve then 'Finance approved your request. It will be disbursed as a separate step.' else 'Finance rejected your request. Reason: ' || btrim(p_reason) end,
    'dr-dec:' || p_request_id);
  return jsonb_build_object('request_id', p_request_id, 'decision', case when p_approve then 'APPROVED' else 'REJECTED' end, 'replayed', false);
end $$;

-- Actual cash release: separate state, DEBIT posted atomically (AC-FIN-008, BR-FIN-007).
create or replace function record_disbursement(p_actor uuid, p_request_id uuid, p_reference text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r disbursement_requests; d disbursements; v_did uuid; v_lid uuid;
begin
  perform require_permission(p_actor, 'disbursement.disburse');
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_reference is null or btrim(p_reference) = '' then raise exception 'VALIDATION_ERROR' using detail = 'disbursement reference required'; end if;
  select * into d from disbursements where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('disbursement_id', d.id, 'replayed', true); end if;
  select * into r from disbursement_requests where id = p_request_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from violation_funds where id = r.fund_id for update;
  select * into r from disbursement_requests where id = p_request_id for update;
  if r.requested_by = p_actor then raise exception 'DISBURSEMENT_SELF_APPROVAL' using detail = 'the requester cannot release their own request'; end if;
  if r.status <> 'APPROVED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;
  begin
    insert into disbursements (request_id, amount, reference, disbursed_by, idempotency_key) values (p_request_id, r.amount, btrim(p_reference), p_actor, p_idempotency_key) returning id into v_did;
  exception when unique_violation then raise exception 'DUPLICATE_PAYMENT' using detail = 'disbursement reference already used'; end;
  insert into financial_ledger_entries (fund_id, entry_type, amount, source_type, source_id, reference, created_by)
    values (r.fund_id, 'DEBIT', r.amount, 'DISBURSEMENT', v_did, 'DB-' || v_did, p_actor) returning id into v_lid;   -- raises INSUFFICIENT_FUNDS rather than going negative
  update disbursement_requests set status = 'DISBURSED', updated_at = app_now() where id = p_request_id;
  perform write_audit(p_actor, 'DISBURSEMENT_RECORDED', 'disbursement_request', p_request_id::text, jsonb_build_object('status', 'APPROVED'),
    jsonb_build_object('status', 'DISBURSED', 'amount', r.amount, 'ledger_entry_id', v_lid, 'reference', btrim(p_reference)));
  perform notify_users(array[r.requested_by], 'DISBURSEMENT_COMPLETED', 'disbursement_request', p_request_id::text, 'Disbursement completed', 'The approved funds have been released.', 'dr-done:' || p_request_id);
  return jsonb_build_object('disbursement_id', v_did, 'ledger_entry_id', v_lid, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- read models
create or replace function read_fund_summary() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_fund uuid; v_bal numeric; v_in numeric; v_out numeric; v_pay numeric; v_dis numeric;
begin
  if not auth_has_permission('finance.fund.view') then raise exception 'PERMISSION_DENIED'; end if;
  select id into v_fund from violation_funds limit 1;
  if v_fund is null then
    return jsonb_build_object('configured', false, 'balance', 0, 'committed', 0, 'available', 0, 'inflow', 0, 'outflow', 0, 'pending_requests', 0, 'reconciled', true);
  end if;
  select coalesce(sum(amount) filter (where entry_type = 'CREDIT'), 0), coalesce(sum(amount) filter (where entry_type = 'DEBIT'), 0)
    into v_in, v_out from financial_ledger_entries where fund_id = v_fund;
  v_bal := v_in - v_out;
  select coalesce(sum(amount), 0) into v_pay from violation_payments;
  select coalesce(sum(amount), 0) into v_dis from disbursements;
  return jsonb_build_object('configured', true, 'currency', 'NGN', 'balance', v_bal, 'committed', fund_committed(v_fund), 'available', v_bal - fund_committed(v_fund),
    'inflow', v_in, 'outflow', v_out,
    'pending_requests', (select count(*) from disbursement_requests where status in ('SUBMITTED','UNDER_REVIEW')),
    'approved_awaiting_disbursement', (select count(*) from disbursement_requests where status = 'APPROVED'),
    'reconciled', (v_in = v_pay and v_out = v_dis and v_bal >= 0),
    'reconciliation', jsonb_build_object('ledger_credits', v_in, 'recorded_payments', v_pay, 'ledger_debits', v_out, 'recorded_disbursements', v_dis));
end $$;

create or replace function read_ledger(p_limit int default 100) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not auth_has_permission('finance.ledger.view') then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'seq')::bigint desc) from (
    select jsonb_build_object('id', l.id, 'entry_type', l.entry_type, 'amount', l.amount, 'source_type', l.source_type, 'reference', l.reference, 'created_at', l.created_at,
      'running_balance', sum(case l.entry_type when 'CREDIT' then l.amount else -l.amount end) over (order by l.seq), 'seq', l.seq) x
    from financial_ledger_entries l order by l.seq desc limit greatest(1, least(p_limit, 500))) t), '[]'::jsonb);
end $$;

create or replace function read_disbursement_requests() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'amount', r.amount, 'purpose', r.purpose, 'justification', r.justification, 'status', r.status, 'created_at', r.created_at,
    'requested_by', r.requested_by,
    'requester_name', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.requested_by),
    'decision', (select jsonb_build_object('decision', d.decision, 'reason', d.reason, 'at', d.created_at,
        'by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = d.decided_by)) from disbursement_decisions d where d.request_id = r.id),
    'disbursement', (select jsonb_build_object('reference', x.reference, 'at', x.created_at) from disbursements x where x.request_id = r.id)
  ) order by r.created_at desc), '[]'::jsonb)
  from disbursement_requests r;
$$;

create or replace function read_violations() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'employee_name', e.first_name || ' ' || e.last_name, 'business_unit', b.name, 'type', t.name, 'type_code', t.code, 'criticality', v.criticality,
    'fine_amount', v.fine_amount, 'status', v.status, 'created_at', v.created_at, 'session_date', s.session_date, 'notes', v.notes,
    'override_reason', v.fine_override_reason,
    'payment', (select jsonb_build_object('method', p.method, 'reference', p.reference, 'paid_at', p.paid_at) from violation_payments p where p.violation_id = v.id)
  ) order by v.created_at desc), '[]'::jsonb)
  from violations v join employees e on e.id = v.employee_id join business_units b on b.id = v.business_unit_id
  join violation_types t on t.id = v.violation_type_id left join governance_sessions s on s.id = v.governance_session_id;
$$;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['violation_types','violations','violation_funds','financial_ledger_entries','violation_payments','disbursement_requests','disbursement_decisions','disbursements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;
create policy read_all on violation_types for select to authenticated using (auth_has_any(array['violation.create','violation.edit','violation.payment.record']));
create policy read_scoped on violations for select to authenticated using (auth_has_any(array['violation.create','violation.edit','violation.payment.record']));
create policy read_scoped on violation_payments for select to authenticated using (auth_has_any(array['violation.create','violation.edit','violation.payment.record','finance.ledger.view']));
create policy read_scoped on violation_funds for select to authenticated using (auth_has_any(array['finance.fund.view','finance.ledger.view']));
create policy read_scoped on financial_ledger_entries for select to authenticated using (auth_has_permission('finance.ledger.view'));
create policy read_scoped on disbursement_requests for select to authenticated using (requested_by = auth.uid() or auth_has_any(array['finance.fund.view','finance.ledger.view','disbursement.approve']));
create policy read_scoped on disbursement_decisions for select to authenticated using (auth_has_any(array['finance.fund.view','finance.ledger.view','disbursement.approve'])
  or exists (select 1 from disbursement_requests r where r.id = request_id and r.requested_by = auth.uid()));
create policy read_scoped on disbursements for select to authenticated using (auth_has_any(array['finance.fund.view','finance.ledger.view','disbursement.approve'])
  or exists (select 1 from disbursement_requests r where r.id = request_id and r.requested_by = auth.uid()));

select lock_down_function_grants();

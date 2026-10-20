-- Ledger reversal (owner decision 3, 14 October 2026; ADR-059; docs/16 "corrections use compensating transactions").
-- A wrong ledger entry is never edited or deleted. It is cancelled by a NEW entry of the opposite type that references the original.
-- Normal path: one person REQUESTS, a different person APPROVES, then someone other than the requester EXECUTES (three recorded steps).
-- Emergency path: a Super Admin can do all three in one step, with a mandatory reason, a fresh authenticator check at the API,
-- a distinct audit action and an alert to every finance and admin user.

insert into permissions (code, description) values
  ('ledger.reversal.request',   'Request a compensating reversal of a ledger entry'),
  ('ledger.reversal.approve',   'Approve or reject a ledger reversal request'),
  ('ledger.reversal.execute',   'Post an approved ledger reversal'),
  ('ledger.reversal.emergency', 'Emergency ledger reversal in one step (audited and alerted)');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('FINANCE','ledger.reversal.request'),('ADMIN','ledger.reversal.request'),('SUPER_ADMIN','ledger.reversal.request'),
  ('FINANCE','ledger.reversal.approve'),('SUPER_ADMIN','ledger.reversal.approve'),
  ('FINANCE','ledger.reversal.execute'),('SUPER_ADMIN','ledger.reversal.execute'),
  ('SUPER_ADMIN','ledger.reversal.emergency')
) as g(role_code, perm) join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

-- ---------------------------------------------------------------- the reversal entry references the original
alter table financial_ledger_entries add column reverses_entry_id uuid references financial_ledger_entries(id) on delete restrict;
create unique index ledger_reversal_once on financial_ledger_entries (reverses_entry_id) where reverses_entry_id is not null;
alter table financial_ledger_entries add constraint ledger_reversal_ref_chk check ((source_type = 'REVERSAL') = (reverses_entry_id is not null));

create table ledger_reversal_requests (
  id               uuid primary key default gen_random_uuid(),
  ledger_entry_id  uuid not null references financial_ledger_entries(id) on delete restrict,
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
  reversal_entry_id uuid references financial_ledger_entries(id) on delete restrict,
  created_at       timestamptz not null default app_now(),
  check (emergency or decided_by is null or decided_by <> requested_by),
  check (emergency or executed_by is null or executed_by <> requested_by),
  check (status <> 'REJECTED' or (decision_comment is not null and btrim(decision_comment) <> '')),
  check ((status = 'EXECUTED') = (reversal_entry_id is not null)),
  check ((status = 'PENDING') = (decided_by is null))
);
create unique index ledger_reversal_open_one on ledger_reversal_requests (ledger_entry_id) where status in ('PENDING','APPROVED');
create index ledger_reversal_time_idx on ledger_reversal_requests (created_at desc);

-- Only the forward steps are possible: PENDING -> APPROVED | REJECTED, APPROVED -> EXECUTED. Nothing is deleted, nothing is edited.
create or replace function ledger_reversal_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'reversal requests are never deleted'; end if;
  if new.ledger_entry_id <> old.ledger_entry_id or new.reason <> old.reason or new.requested_by <> old.requested_by
     or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at or new.emergency <> old.emergency then
    raise exception 'IMMUTABLE_RECORD' using detail = 'the request itself cannot change';
  end if;
  if not ((old.status = 'PENDING' and new.status in ('APPROVED','REJECTED')) or (old.status = 'APPROVED' and new.status = 'EXECUTED')) then
    raise exception 'IMMUTABLE_RECORD' using detail = old.status || ' cannot become ' || new.status;
  end if;
  return new;
end $$;
create trigger ledger_reversal_requests_guard before update or delete on ledger_reversal_requests for each row execute function ledger_reversal_guard();

-- ---------------------------------------------------------------- posting the compensating entry (internal)
create or replace function post_ledger_reversal(p_actor uuid, p_entry_id uuid, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare e financial_ledger_entries; v_new uuid;
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
  return v_new;
end $$;

-- ---------------------------------------------------------------- 1. request
create or replace function request_ledger_reversal(p_actor uuid, p_entry_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ex ledger_reversal_requests; e financial_ledger_entries; v_id uuid;
begin
  perform require_permission(p_actor, 'ledger.reversal.request');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from ledger_reversal_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.ledger_entry_id <> p_entry_id or v_ex.requested_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  select * into e from financial_ledger_entries where id = p_entry_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from violation_funds where id = e.fund_id for update;
  if e.source_type = 'REVERSAL' then raise exception 'LEDGER_ENTRY_NOT_REVERSIBLE' using detail = 'a reversal entry cannot itself be reversed'; end if;
  if exists (select 1 from financial_ledger_entries where reverses_entry_id = e.id) then raise exception 'LEDGER_ENTRY_ALREADY_REVERSED'; end if;
  if exists (select 1 from ledger_reversal_requests where ledger_entry_id = e.id and status in ('PENDING','APPROVED')) then raise exception 'LEDGER_REVERSAL_PENDING'; end if;
  insert into ledger_reversal_requests (ledger_entry_id, reason, requested_by, idempotency_key) values (e.id, btrim(p_reason), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'LEDGER_REVERSAL_REQUESTED', 'ledger_reversal_request', v_id::text, null,
    jsonb_build_object('ledger_entry_id', e.id, 'reference', e.reference, 'entry_type', e.entry_type, 'amount', e.amount), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('ledger.reversal.approve'), p_actor), 'LEDGER_REVERSAL_REQUESTED', 'ledger_reversal_request', v_id::text,
    'A ledger reversal needs your decision', 'Reversal of ' || e.reference || ' was requested. Reason given: ' || btrim(p_reason), 'lrv-req:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'PENDING');
end $$;

-- ---------------------------------------------------------------- 2. independent decision
create or replace function decide_ledger_reversal(p_actor uuid, p_request_id uuid, p_decision text, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r ledger_reversal_requests; v_prev ledger_reversal_requests;
begin
  perform require_permission(p_actor, 'ledger.reversal.approve');
  if p_decision is null or p_decision not in ('APPROVE','REJECT') then raise exception 'VALIDATION_ERROR' using detail = 'decision must be APPROVE or REJECT'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from ledger_reversal_requests where decision_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.decided_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'status', v_prev.status);
  end if;
  select * into r from ledger_reversal_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'PENDING' then raise exception 'LEDGER_REVERSAL_NOT_PENDING'; end if;
  if r.requested_by = p_actor then raise exception 'LEDGER_REVERSAL_SELF_APPROVAL'; end if;
  if p_decision = 'REJECT' and (p_comment is null or btrim(p_comment) = '') then raise exception 'REASON_REQUIRED'; end if;
  update ledger_reversal_requests set status = case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end, decided_by = p_actor, decided_at = app_now(),
    decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decision_key = p_idempotency_key where id = r.id;
  perform write_audit(p_actor, case p_decision when 'APPROVE' then 'LEDGER_REVERSAL_APPROVED' else 'LEDGER_REVERSAL_REJECTED' end, 'ledger_reversal_request', r.id::text,
    jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end), nullif(btrim(coalesce(p_comment, '')), ''));
  perform notify_users(array[r.requested_by], 'LEDGER_REVERSAL_DECIDED', 'ledger_reversal_request', r.id::text,
    case p_decision when 'APPROVE' then 'Your ledger reversal was approved' else 'Your ledger reversal was rejected' end,
    case p_decision when 'APPROVE' then 'It now waits to be posted by someone with execute rights.' else 'Reason: ' || btrim(p_comment) end, 'lrv-dec:' || r.id);
  if p_decision = 'APPROVE' then
    perform notify_users(array_remove(users_with_permission('ledger.reversal.execute'), r.requested_by), 'LEDGER_REVERSAL_APPROVED', 'ledger_reversal_request', r.id::text,
      'A ledger reversal is ready to post', 'An approved reversal is waiting to be executed.', 'lrv-ready:' || r.id);
  end if;
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', case p_decision when 'APPROVE' then 'APPROVED' else 'REJECTED' end);
end $$;

-- ---------------------------------------------------------------- 3. separate execution
create or replace function execute_ledger_reversal(p_actor uuid, p_request_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r ledger_reversal_requests; v_prev ledger_reversal_requests; v_entry uuid;
begin
  perform require_permission(p_actor, 'ledger.reversal.execute');
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from ledger_reversal_requests where execute_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.executed_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'reversal_entry_id', v_prev.reversal_entry_id);
  end if;
  select * into r from ledger_reversal_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'APPROVED' then raise exception 'LEDGER_REVERSAL_NOT_APPROVED'; end if;
  if r.requested_by = p_actor then raise exception 'LEDGER_REVERSAL_SELF_APPROVAL'; end if;
  v_entry := post_ledger_reversal(p_actor, r.ledger_entry_id, r.id);
  update ledger_reversal_requests set status = 'EXECUTED', executed_by = p_actor, executed_at = app_now(), execute_key = p_idempotency_key, reversal_entry_id = v_entry where id = r.id;
  perform write_audit(p_actor, 'LEDGER_REVERSAL_EXECUTED', 'ledger_reversal_request', r.id::text, jsonb_build_object('status', 'APPROVED'),
    jsonb_build_object('status', 'EXECUTED', 'reversal_entry_id', v_entry, 'reverses', r.ledger_entry_id, 'requested_by', r.requested_by, 'approved_by', r.decided_by));
  perform notify_users(array[r.requested_by, r.decided_by], 'LEDGER_REVERSAL_EXECUTED', 'ledger_reversal_request', r.id::text,
    'A ledger reversal was posted', 'The compensating entry is now in the ledger.', 'lrv-done:' || r.id);
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'reversal_entry_id', v_entry);
end $$;

-- ---------------------------------------------------------------- emergency (Super Admin, one step, loudly)
create or replace function emergency_ledger_reversal(p_actor uuid, p_entry_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ex ledger_reversal_requests; e financial_ledger_entries; v_id uuid := gen_random_uuid(); v_entry uuid;
begin
  perform require_permission(p_actor, 'ledger.reversal.emergency');
  if p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'REASON_REQUIRED' using detail = 'an emergency reversal needs a full reason (at least 10 characters)'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_ex from ledger_reversal_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.ledger_entry_id <> p_entry_id or v_ex.requested_by <> p_actor or not v_ex.emergency then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'reversal_entry_id', v_ex.reversal_entry_id);
  end if;
  select * into e from financial_ledger_entries where id = p_entry_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from ledger_reversal_requests where ledger_entry_id = e.id and status in ('PENDING','APPROVED')) then raise exception 'LEDGER_REVERSAL_PENDING' using detail = 'finish or reject the open request first'; end if;
  v_entry := post_ledger_reversal(p_actor, e.id, v_id);
  insert into ledger_reversal_requests (id, ledger_entry_id, reason, status, emergency, requested_by, idempotency_key, decided_by, decided_at, decision_comment, decision_key,
                                        executed_by, executed_at, execute_key, reversal_entry_id)
    values (v_id, e.id, btrim(p_reason), 'EXECUTED', true, p_actor, p_idempotency_key, p_actor, app_now(), 'Emergency override', 'em-d:' || v_id,
            p_actor, app_now(), 'em-x:' || v_id, v_entry);
  perform write_audit(p_actor, 'LEDGER_REVERSAL_EMERGENCY', 'ledger_reversal_request', v_id::text, null,
    jsonb_build_object('ledger_entry_id', e.id, 'reference', e.reference, 'amount', e.amount, 'reversal_entry_id', v_entry, 'emergency', true), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('finance.ledger.view'), p_actor), 'LEDGER_REVERSAL_EMERGENCY', 'ledger_reversal_request', v_id::text,
    'EMERGENCY ledger reversal posted', 'A Super Admin reversed ledger entry ' || e.reference || ' without the usual two-person approval. Reason: ' || btrim(p_reason), 'lrv-em:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'reversal_entry_id', v_entry, 'emergency', true);
end $$;

-- ---------------------------------------------------------------- read models
create or replace function read_ledger_reversals() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not auth_has_permission('finance.ledger.view') then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'status', r.status, 'emergency', r.emergency, 'reason', r.reason, 'created_at', r.created_at, 'decided_at', r.decided_at, 'executed_at', r.executed_at,
    'decision_comment', r.decision_comment, 'requested_by_id', r.requested_by, 'decided_by_id', r.decided_by,
    'entry_id', e.id, 'entry_reference', e.reference, 'entry_type', e.entry_type, 'amount', e.amount, 'source_type', e.source_type,
    'reversal_reference', (select x.reference from financial_ledger_entries x where x.id = r.reversal_entry_id),
    'requested_by', (select em.first_name || ' ' || em.last_name from users u join employees em on em.id = u.employee_id where u.id = r.requested_by),
    'decided_by', (select em.first_name || ' ' || em.last_name from users u join employees em on em.id = u.employee_id where u.id = r.decided_by),
    'executed_by', (select em.first_name || ' ' || em.last_name from users u join employees em on em.id = u.employee_id where u.id = r.executed_by)
  ) order by r.created_at desc) from ledger_reversal_requests r join financial_ledger_entries e on e.id = r.ledger_entry_id), '[]'::jsonb);
end $$;

create or replace function read_ledger(p_limit int default 100) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not auth_has_permission('finance.ledger.view') then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'seq')::bigint desc) from (
    select jsonb_build_object('id', l.id, 'entry_type', l.entry_type, 'amount', l.amount, 'source_type', l.source_type, 'reference', l.reference, 'created_at', l.created_at,
      'running_balance', sum(case l.entry_type when 'CREDIT' then l.amount else -l.amount end) over (order by l.seq), 'seq', l.seq,
      'reverses_entry_id', l.reverses_entry_id,
      'reversed', exists (select 1 from financial_ledger_entries z where z.reverses_entry_id = l.id),
      'reversal_open', exists (select 1 from ledger_reversal_requests q where q.ledger_entry_id = l.id and q.status in ('PENDING','APPROVED'))) x
    from financial_ledger_entries l order by l.seq desc limit greatest(1, least(p_limit, 500))) t), '[]'::jsonb);
end $$;

-- reconciliation: reversal entries are compensating postings, so they are counted against the ledger side, not the payment/disbursement side
create or replace function read_fund_summary() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_fund uuid; v_bal numeric; v_in numeric; v_out numeric; v_pay numeric; v_dis numeric; v_rcr numeric; v_rdb numeric;
begin
  if not auth_has_permission('finance.fund.view') then raise exception 'PERMISSION_DENIED'; end if;
  select id into v_fund from violation_funds limit 1;
  if v_fund is null then
    return jsonb_build_object('configured', false, 'balance', 0, 'committed', 0, 'available', 0, 'inflow', 0, 'outflow', 0, 'pending_requests', 0, 'reconciled', true);
  end if;
  select coalesce(sum(amount) filter (where entry_type = 'CREDIT'), 0), coalesce(sum(amount) filter (where entry_type = 'DEBIT'), 0),
         coalesce(sum(amount) filter (where entry_type = 'CREDIT' and source_type = 'REVERSAL'), 0), coalesce(sum(amount) filter (where entry_type = 'DEBIT' and source_type = 'REVERSAL'), 0)
    into v_in, v_out, v_rcr, v_rdb from financial_ledger_entries where fund_id = v_fund;
  v_bal := v_in - v_out;
  select coalesce(sum(amount), 0) into v_pay from violation_payments;
  select coalesce(sum(amount), 0) into v_dis from disbursements;
  return jsonb_build_object('configured', true, 'currency', 'NGN', 'balance', v_bal, 'committed', fund_committed(v_fund), 'available', v_bal - fund_committed(v_fund),
    'inflow', v_in, 'outflow', v_out,
    'pending_requests', (select count(*) from disbursement_requests where status in ('SUBMITTED','UNDER_REVIEW')),
    'approved_awaiting_disbursement', (select count(*) from disbursement_requests where status = 'APPROVED'),
    'pending_reversals', (select count(*) from ledger_reversal_requests where status in ('PENDING','APPROVED')),
    'reconciled', ((v_in - v_rcr) = v_pay and (v_out - v_rdb) = v_dis and v_bal >= 0),
    'reconciliation', jsonb_build_object('ledger_credits', v_in, 'recorded_payments', v_pay, 'ledger_debits', v_out, 'recorded_disbursements', v_dis,
                                         'reversal_credits', v_rcr, 'reversal_debits', v_rdb));
end $$;

alter table ledger_reversal_requests enable row level security;
grant select on ledger_reversal_requests to authenticated;
create policy read_scoped on ledger_reversal_requests for select to authenticated using (auth_has_permission('finance.ledger.view'));

select lock_down_function_grants();

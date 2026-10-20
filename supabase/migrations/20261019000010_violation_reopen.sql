-- A reversed violation payment reopens the violation (ADR-065; closes the gap noted in ADR-059).
-- Before: one payment per violation, forever, so cancelling a payment in the ledger left the violation settled with nothing behind it.
-- Now: a violation can have more than one payment over its life, but only ever one that has not been reversed. The reversal of a payment's
-- ledger entry sets the violation back to OPEN; it can then be settled again with a new payment and a new reference. Nothing is deleted:
-- the first payment, its ledger entry and its reversal all stay on record.

alter table violation_payments drop constraint violation_payments_violation_id_key;
create index violation_payments_violation_idx on violation_payments (violation_id);

-- Whether a payment's ledger entry has been cancelled. Definer, because HR may see payments but not the ledger.
create or replace function read_payment_is_reversed(p_payment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from financial_ledger_entries l join financial_ledger_entries r on r.reverses_entry_id = l.id
                  where l.source_type = 'VIOLATION_PAYMENT' and l.source_id = p_payment);
$$;
grant execute on function read_payment_is_reversed(uuid) to authenticated;

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
  -- Cancelling the money a violation was settled with means the violation is unpaid again: reopen it so it can be settled properly (ADR-065).
  if e.source_type = 'VIOLATION_PAYMENT' then
    select v.* into vio from violations v join violation_payments p on p.violation_id = v.id where p.id = e.source_id for update of v;
    if found and vio.status <> 'OPEN' then
      update violations set status = 'OPEN', updated_at = app_now() where id = vio.id;
      perform write_audit(p_actor, 'VIOLATION_REOPENED_BY_REVERSAL', 'violation', vio.id::text, jsonb_build_object('status', vio.status), jsonb_build_object('status', 'OPEN', 'reversal_entry_id', v_new, 'reversed_entry_id', e.id), null, vio.business_unit_id);
      perform notify_users(users_with_permission('violation.create'), 'VIOLATION_REOPENED', 'violation', vio.id::text, 'A violation payment was reversed',
        'The payment recorded for a violation was cancelled in the ledger, so the violation is open again and the fine is unpaid.', 'vio-reopen:' || vio.id || ':' || v_new);
    end if;
  end if;
  return v_new;
end $$;

create or replace function read_violations() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'employee_name', e.first_name || ' ' || e.last_name, 'business_unit', b.name, 'type', t.name, 'type_code', t.code, 'criticality', v.criticality,
    'fine_amount', v.fine_amount, 'status', v.status, 'created_at', v.created_at, 'session_date', s.session_date, 'notes', v.notes,
    'override_reason', v.fine_override_reason,
    'payment', (select jsonb_build_object('method', p.method, 'reference', p.reference, 'paid_at', p.paid_at) from violation_payments p
                 where p.violation_id = v.id and not read_payment_is_reversed(p.id) order by p.created_at desc limit 1),
    'reversed_payments', (select count(*) from violation_payments p where p.violation_id = v.id and read_payment_is_reversed(p.id))
  ) order by v.created_at desc), '[]'::jsonb)
  from violations v join employees e on e.id = v.employee_id join business_units b on b.id = v.business_unit_id
  join violation_types t on t.id = v.violation_type_id left join governance_sessions s on s.id = v.governance_session_id;
$$;

select lock_down_function_grants();

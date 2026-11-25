-- A payment method that is no longer wanted can be deleted (owner request, 25 November 2026: "payment method should have delete not just edit; Admin should be
-- able to delete where required"). Who: the people who already manage payment methods (violation.edit: Super Admin, Admin, HR).
--
-- A method that has been used cannot be deleted. Payments, their references (for example SAL-2026-000001) and the reports that show them keep the method's code,
-- and a deleted code could later be given to a different method and change what old records mean. Such a method is switched to "not in use" instead (Edit), which
-- removes it from the list offered when recording a payment and keeps everything it was used for. The last method in use cannot be deleted either.
-- Every deletion is audited with what was deleted.

-- how often a method has been used: payments recorded with it (the two old names count for PAY and SAL) plus references issued from its counter
create or replace function payment_method_use_count(p_code text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*) from violation_payments p
           where p.method = p_code or (p_code = 'PAY' and p.method = 'PAYMENT') or (p_code = 'SAL' and p.method = 'SALARY_DEDUCTION'))::int
       + (select count(*) from payment_reference_counters c where c.method_code = p_code and c.last_value > 0)::int;
$$;

create or replace function read_payment_method_usage() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not auth_has_permission('violation.edit') then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'used', payment_method_use_count(m.code)) order by m.code) from payment_methods m), '[]'::jsonb);
end $$;

create or replace function delete_payment_method(p_actor uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m payment_methods; v_used int;
begin
  perform require_permission(p_actor, 'violation.edit');
  select * into m from payment_methods where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_used := payment_method_use_count(m.code);
  if v_used > 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'this payment method has been used, so it cannot be deleted: switch it to not in use instead (Edit)';
  end if;
  if m.active and not exists (select 1 from payment_methods where active and id <> p_id) then
    raise exception 'VALIDATION_ERROR' using detail = 'at least one payment method must stay in use';
  end if;
  delete from payment_methods where id = p_id;
  perform write_audit(p_actor, 'PAYMENT_METHOD_DELETED', 'payment_method', p_id::text,
    jsonb_build_object('code', m.code, 'name', m.name, 'is_deduction', m.is_deduction, 'active', m.active), null, 'Payment method deleted (never used)', null);
end $$;

select lock_down_function_grants();

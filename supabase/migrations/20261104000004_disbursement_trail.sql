-- A fund request now carries who raised it (with their unit), who decided and who released it, with the times, so the screen can show the whole process.
create or replace function read_disbursement_requests() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'amount', r.amount, 'purpose', r.purpose, 'justification', r.justification, 'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at,
    'requested_by', r.requested_by,
    'requester_name', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = r.requested_by),
    'requester_unit', (select b.name from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.id = r.requested_by),
    'decision', (select jsonb_build_object('decision', d.decision, 'reason', d.reason, 'at', d.created_at,
        'by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = d.decided_by)) from disbursement_decisions d where d.request_id = r.id),
    'disbursement', (select jsonb_build_object('reference', x.reference, 'at', x.created_at, 'amount', x.amount,
        'by', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = x.disbursed_by)) from disbursements x where x.request_id = r.id)
  ) order by r.created_at desc), '[]'::jsonb)
  from disbursement_requests r;
$$;
select lock_down_function_grants();

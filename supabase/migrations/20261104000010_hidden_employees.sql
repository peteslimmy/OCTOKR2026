-- The reserve Super Admin account stays out of every list of people for anyone who is not a Super Admin (pickers for speakers, violations and so on).
create or replace function read_hidden_employee_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when is_super_admin(auth.uid()) then '{}'::uuid[]
    else coalesce((select array_agg(u.employee_id) from users u where u.employee_id is not null and is_super_admin(u.id)), '{}'::uuid[]) end;
$$;
select lock_down_function_grants();

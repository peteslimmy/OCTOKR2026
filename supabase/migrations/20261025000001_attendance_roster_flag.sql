-- Gap-closure plan, Phase A (C10): a person can have a sign-in and still be left off the attendance roster (the old app's "login only" category).
-- The default is on the roster, so nobody changes unless an administrator switches them off. The roster and the virtual-present roster of a skipped
-- session both honour the flag; people already on a roster stay on it.
alter table employees add column on_attendance_roster boolean not null default true;

do $$
declare r record; v_new text; n int := 0;
begin
  for r in select p.oid, p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prosrc like '%from employees e where e.employment_status = ''ACTIVE''%' loop
    v_new := replace(r.def, 'from employees e where e.employment_status = ''ACTIVE''', 'from employees e where e.employment_status = ''ACTIVE'' and e.on_attendance_roster');
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 2 then raise exception 'expected to patch 2 roster functions, patched %', n; end if;
end $$;

create or replace function set_employee_roster(p_actor uuid, p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old boolean; v_bu uuid;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_on is null then raise exception 'VALIDATION_ERROR' using detail = 'choose on or off'; end if;
  select on_attendance_roster, business_unit_id into v_old, v_bu from employees where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_old = p_on then return; end if;
  update employees set on_attendance_roster = p_on, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'EMPLOYEE_ROSTER_CHANGED', 'employee', p_id::text, jsonb_build_object('on_attendance_roster', v_old), jsonb_build_object('on_attendance_roster', p_on), null, v_bu);
end $$;

select lock_down_function_grants();

-- Authentication bookkeeping, organisation bootstrap and administration (BUs, employees, users, roles).

-- ---------------------------------------------------------------- login throttling / audit
create or replace function login_lock_status(p_email text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select locked_until is not null and locked_until > app_now() from users where email = p_email::extensions.citext), false);
$$;

create or replace function record_login_failure(p_email text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_locked boolean := false; v_u users;
begin
  select * into v_u from users where email = p_email::extensions.citext for update;
  if found then
    update users set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then app_now() + interval '15 minutes' else locked_until end
     where id = v_u.id returning locked_until is not null and locked_until > app_now() into v_locked;
  end if;
  perform write_audit(v_u.id, case when v_locked then 'AUTH_ACCOUNT_LOCKED' else 'AUTH_LOGIN_FAILED' end, 'user', coalesce(v_u.id::text, 'unknown'),
                      null, jsonb_build_object('email', p_email), null, null, 'DENIED');
  return v_locked;
end $$;

create or replace function record_login_success(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update users set failed_attempts = 0, locked_until = null, last_login_at = app_now() where id = p_user;
  perform write_audit(p_user, 'AUTH_LOGIN', 'user', p_user::text);
end $$;

create or replace function record_logout(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  select write_audit(p_user, 'AUTH_LOGOUT', 'user', p_user::text);
$$;

-- ---------------------------------------------------------------- bootstrap (one-time)
create or replace function bootstrap_organisation(
  p_org_name text, p_org_code text, p_bu_code text, p_bu_name text,
  p_admin_auth_id uuid, p_admin_email text, p_admin_first text, p_admin_last text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_bu uuid; v_emp uuid;
begin
  if exists (select 1 from organisations) then raise exception 'ALREADY_BOOTSTRAPPED'; end if;
  insert into organisations (name, code) values (btrim(p_org_name), upper(btrim(p_org_code))) returning id into v_org;
  insert into business_units (organisation_id, code, name) values (v_org, upper(btrim(p_bu_code)), btrim(p_bu_name)) returning id into v_bu;
  insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values (v_org, p_admin_email, p_admin_first, p_admin_last, v_bu) returning id into v_emp;
  insert into users (id, employee_id, email) values (p_admin_auth_id, v_emp, p_admin_email);
  insert into user_roles (user_id, role_id) select p_admin_auth_id, id from roles where code = 'SUPER_ADMIN';
  perform write_audit(p_admin_auth_id, 'ORGANISATION_BOOTSTRAPPED', 'organisation', v_org::text, null, jsonb_build_object('org', p_org_name, 'bu', p_bu_name));
  return jsonb_build_object('organisation_id', v_org, 'business_unit_id', v_bu);
end $$;

-- ---------------------------------------------------------------- business units / employees
create or replace function create_business_unit(p_actor uuid, p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'business_units.manage');
  select id into v_org from organisations limit 1;
  begin
    insert into business_units (organisation_id, code, name) values (v_org, upper(btrim(p_code)), btrim(p_name)) returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'BU code already exists'; end;
  perform write_audit(p_actor, 'BU_CREATED', 'business_unit', v_id::text, null, jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name)));
  return v_id;
end $$;

create or replace function update_business_unit(p_actor uuid, p_id uuid, p_name text, p_status text, p_reports_weekly boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old business_units;
begin
  perform require_permission(p_actor, 'business_units.manage');
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'VALIDATION_ERROR'; end if;
  select * into v_old from business_units where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update business_units set name = btrim(p_name), status = p_status, reports_weekly = p_reports_weekly, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'BU_UPDATED', 'business_unit', p_id::text,
    jsonb_build_object('name', v_old.name, 'status', v_old.status, 'reports_weekly', v_old.reports_weekly), jsonb_build_object('name', btrim(p_name), 'status', p_status, 'reports_weekly', p_reports_weekly));
end $$;

create or replace function create_employee(p_actor uuid, p_email text, p_first text, p_last text, p_bu uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'users.manage');
  select id into v_org from organisations limit 1;
  begin
    insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values (v_org, btrim(p_email), btrim(p_first), btrim(p_last), p_bu) returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'email already exists';
            when foreign_key_violation then raise exception 'VALIDATION_ERROR' using detail = 'unknown business unit'; end;
  perform write_audit(p_actor, 'EMPLOYEE_CREATED', 'employee', v_id::text, null, jsonb_build_object('email', btrim(p_email), 'business_unit_id', p_bu), null, p_bu);
  return v_id;
end $$;

create or replace function update_employee(p_actor uuid, p_id uuid, p_first text, p_last text, p_bu uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old employees;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'VALIDATION_ERROR'; end if;
  select * into v_old from employees where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update employees set first_name = btrim(p_first), last_name = btrim(p_last), business_unit_id = p_bu, employment_status = p_status, updated_at = app_now() where id = p_id;
  -- historical reports keep the BU recorded on the report itself (22-DATA-MIGRATION: historical ownership)
  perform write_audit(p_actor, 'EMPLOYEE_UPDATED', 'employee', p_id::text,
    jsonb_build_object('business_unit_id', v_old.business_unit_id, 'status', v_old.employment_status),
    jsonb_build_object('business_unit_id', p_bu, 'status', p_status), null, p_bu);
end $$;

-- ---------------------------------------------------------------- users and roles (THREAT-007)
create or replace function assert_can_grant_roles(p_actor uuid, p_roles text[]) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r text;
begin
  perform require_permission(p_actor, 'users.manage');
  foreach r in array p_roles loop
    if not exists (select 1 from roles where code = r) then raise exception 'VALIDATION_ERROR' using detail = 'unknown role ' || r; end if;
    if r in ('ADMIN','SUPER_ADMIN') then perform require_permission(p_actor, 'roles.manage'); end if;
  end loop;
end $$;

create or replace function provision_user(p_actor uuid, p_auth_id uuid, p_email text, p_first text, p_last text, p_bu uuid, p_roles text[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_emp uuid; v_org uuid; r text;
begin
  perform assert_can_grant_roles(p_actor, p_roles);
  select id into v_org from organisations limit 1;
  select id into v_emp from employees where email = p_email::extensions.citext;
  if v_emp is null then
    insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values (v_org, btrim(p_email), btrim(p_first), btrim(p_last), p_bu) returning id into v_emp;
  end if;
  begin
    insert into users (id, employee_id, email) values (p_auth_id, v_emp, btrim(p_email));
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'user already exists'; end;
  foreach r in array p_roles loop
    insert into user_roles (user_id, role_id, granted_by) select p_auth_id, id, p_actor from roles where code = r;
  end loop;
  perform write_audit(p_actor, 'USER_CREATED', 'user', p_auth_id::text, null, jsonb_build_object('email', btrim(p_email), 'roles', p_roles), null, p_bu);
  return p_auth_id;
end $$;

create or replace function set_user_roles(p_actor uuid, p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text[]; r text; v_changed text[];
begin
  perform assert_can_grant_roles(p_actor, p_roles);
  v_old := actor_role_codes(p_user);
  -- removing a privileged role needs the same privilege as granting it
  foreach r in array v_old loop
    if r in ('ADMIN','SUPER_ADMIN') and not (r = any(p_roles)) then perform require_permission(p_actor, 'roles.manage'); end if;
  end loop;
  if p_user = p_actor and ('SUPER_ADMIN' = any(v_old)) and not ('SUPER_ADMIN' = any(p_roles)) then
    raise exception 'VALIDATION_ERROR' using detail = 'You cannot remove your own SUPER_ADMIN role';
  end if;
  delete from user_roles where user_id = p_user;
  foreach r in array p_roles loop
    insert into user_roles (user_id, role_id, granted_by) select p_user, id, p_actor from roles where code = r;
  end loop;
  perform write_audit(p_actor, 'USER_ROLES_CHANGED', 'user', p_user::text, jsonb_build_object('roles', v_old), jsonb_build_object('roles', p_roles));
end $$;

create or replace function set_user_status(p_actor uuid, p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_status not in ('ACTIVE','SUSPENDED') then raise exception 'VALIDATION_ERROR'; end if;
  if p_user = p_actor then raise exception 'VALIDATION_ERROR' using detail = 'You cannot change your own status'; end if;
  select status into v_old from users where id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if 'SUPER_ADMIN' = any(actor_role_codes(p_user)) then perform require_permission(p_actor, 'roles.manage'); end if;
  update users set status = p_status, updated_at = app_now() where id = p_user;
  perform write_audit(p_actor, case when p_status = 'SUSPENDED' then 'USER_SUSPENDED' else 'USER_REACTIVATED' end, 'user', p_user::text,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------- notifications
create or replace function mark_all_notifications_read(p_user uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update notifications set read_at = app_now() where user_id = p_user and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

select lock_down_function_grants();

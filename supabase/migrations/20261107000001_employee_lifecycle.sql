-- People lifecycle: every person's journey (joining, moving to another business unit, being made a BU Lead or given any other role, losing a role, going inactive or suspended)
-- is recorded as it happens, with who did it, when it took effect and why. Nothing here changes how access, scoring or reporting work: a move or a role change takes effect
-- through the same functions as before; this adds the record and one guided action (transfer_or_promote) that does a move and/or a role change in one step.
-- Historical weekly reports keep the unit recorded on the report itself, so a move never rewrites the past.

create table employee_lifecycle_events (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  employee_id    uuid not null,                       -- no foreign keys: the journey outlives a deleted person, unit or user; names are kept as they were
  user_id        uuid,
  employee_name  text,
  employee_email text,
  event_type     text not null check (event_type in ('JOINED','SIGN_IN_CREATED','TRANSFERRED','ROLE_GRANTED','ROLE_REMOVED','DEACTIVATED','REACTIVATED','SUSPENDED','RESTORED')),
  effective_date date not null,
  from_bu_id     uuid,
  from_bu_name   text,
  to_bu_id       uuid,
  to_bu_name     text,
  role_code      text,
  role_name      text,
  reason         text check (reason is null or char_length(reason) <= 2000),
  actor_id       uuid,
  actor_name     text,
  source         text not null default 'SYSTEM' check (source in ('MANUAL','SYSTEM','BACKFILL')),
  occurred_at    timestamptz not null default app_now()
);
create index employee_lifecycle_employee_idx on employee_lifecycle_events (employee_id, seq);
create index employee_lifecycle_recent_idx on employee_lifecycle_events (seq desc);
create trigger employee_lifecycle_immutable before update or delete on employee_lifecycle_events for each row execute function forbid_mutation();

alter table employee_lifecycle_events enable row level security;
grant select on employee_lifecycle_events to authenticated;
-- people managers read every journey; everyone reads their own
create policy read_journeys on employee_lifecycle_events for select to authenticated using (
  (select auth_aal_satisfied()) and ((select auth_has_permission('users.manage')) or user_id = (select auth.uid())));

-- the single writer. The reason, the effective date and the actor come from the guided action (or the existing admin functions) through transaction-local settings;
-- a change made any other way is still recorded, as a system change dated today.
create or replace function lc_log(p_employee uuid, p_user uuid, p_type text, p_from uuid, p_to uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := nullif(current_setting('app.lifecycle_actor', true), '')::uuid; v_reason text := nullif(current_setting('app.lifecycle_reason', true), '');
        v_eff date := coalesce(nullif(current_setting('app.lifecycle_effective', true), '')::date, (app_now() at time zone 'Africa/Lagos')::date); e employees;
begin
  select * into e from employees where id = p_employee;
  insert into employee_lifecycle_events (employee_id, user_id, employee_name, employee_email, event_type, effective_date, from_bu_id, from_bu_name, to_bu_id, to_bu_name, role_code, role_name, reason, actor_id, actor_name, source)
  values (p_employee, p_user, e.first_name || ' ' || e.last_name, e.email::text, p_type, v_eff, p_from, (select name from business_units where id = p_from), p_to, (select name from business_units where id = p_to),
          p_role, (select name from roles where code = p_role), v_reason, v_actor,
          (select x.first_name || ' ' || x.last_name from users u join employees x on x.id = u.employee_id where u.id = v_actor),
          case when v_actor is not null then 'MANUAL' else 'SYSTEM' end);
end $$;

create or replace function employees_lc() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  select id into v_user from users where employee_id = new.id;
  if tg_op = 'INSERT' then
    perform lc_log(new.id, v_user, 'JOINED', null, new.business_unit_id, null);
  else
    if new.business_unit_id is distinct from old.business_unit_id then perform lc_log(new.id, v_user, 'TRANSFERRED', old.business_unit_id, new.business_unit_id, null); end if;
    if new.employment_status is distinct from old.employment_status then
      perform lc_log(new.id, v_user, case when new.employment_status = 'INACTIVE' then 'DEACTIVATED' else 'REACTIVATED' end, null, new.business_unit_id, null);
    end if;
  end if;
  return null;
end $$;
create trigger employees_lifecycle after insert or update of business_unit_id, employment_status on employees for each row execute function employees_lc();

create or replace function users_lc() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform lc_log(new.employee_id, new.id, 'SIGN_IN_CREATED', null, (select business_unit_id from employees where id = new.employee_id), null);
  elsif new.status is distinct from old.status then
    perform lc_log(new.employee_id, new.id, case when new.status = 'SUSPENDED' then 'SUSPENDED' else 'RESTORED' end, null, (select business_unit_id from employees where id = new.employee_id), null);
  end if;
  return null;
end $$;
create trigger users_lifecycle after insert or update of status on users for each row execute function users_lc();

create or replace function user_roles_lc() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := coalesce(new.user_id, old.user_id); v_emp uuid; v_role text := (select code from roles where id = coalesce(new.role_id, old.role_id));
begin
  select employee_id into v_emp from users where id = v_user;
  if v_emp is null then return null; end if;                                  -- the person is being deleted: no journey entry for the cascade
  perform lc_log(v_emp, v_user, case when tg_op = 'INSERT' then 'ROLE_GRANTED' else 'ROLE_REMOVED' end, null, (select business_unit_id from employees where id = v_emp), v_role);
  return null;
end $$;
create trigger user_roles_lifecycle after insert or delete on user_roles for each row execute function user_roles_lc();

-- the existing admin functions, unchanged in what they do, now tell the journey who acted. set_user_roles only touches the roles that really change (it used to delete all and re-insert),
-- so the journey shows exactly the roles gained and lost.
create or replace function update_employee(p_actor uuid, p_id uuid, p_first text, p_last text, p_bu uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old employees;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'VALIDATION_ERROR'; end if;
  select * into v_old from employees where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform set_config('app.lifecycle_actor', p_actor::text, true);
  update employees set first_name = btrim(p_first), last_name = btrim(p_last), business_unit_id = p_bu, employment_status = p_status, updated_at = app_now() where id = p_id;
  -- historical reports keep the BU recorded on the report itself (22-DATA-MIGRATION: historical ownership)
  perform write_audit(p_actor, 'EMPLOYEE_UPDATED', 'employee', p_id::text,
    jsonb_build_object('business_unit_id', v_old.business_unit_id, 'status', v_old.employment_status),
    jsonb_build_object('business_unit_id', p_bu, 'status', p_status), null, p_bu);
end $$;

create or replace function set_user_roles(p_actor uuid, p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text[]; r text;
begin
  perform assert_can_grant_roles(p_actor, p_roles);
  if p_roles is null or cardinality(p_roles) < 1 then raise exception 'VALIDATION_ERROR' using detail = 'a person needs at least one role'; end if;
  v_old := actor_role_codes(p_user);
  -- removing a privileged role needs the same privilege as granting it
  foreach r in array v_old loop
    if role_is_privileged(r) and not (r = any(p_roles)) then perform require_permission(p_actor, 'roles.manage'); end if;
  end loop;
  if p_user = p_actor and roles_hold_permission(v_old, 'roles.manage') and not roles_hold_permission(p_roles, 'roles.manage') then
    raise exception 'VALIDATION_ERROR' using detail = 'You cannot remove your own ability to manage roles';
  end if;
  perform set_config('app.lifecycle_actor', p_actor::text, true);
  delete from user_roles where user_id = p_user and role_id not in (select id from roles where code = any(p_roles));
  insert into user_roles (user_id, role_id, granted_by) select p_user, id, p_actor from roles where code = any(p_roles) on conflict do nothing;
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
  if roles_hold_permission(actor_role_codes(p_user), 'roles.manage') then perform require_permission(p_actor, 'roles.manage'); end if;
  perform set_config('app.lifecycle_actor', p_actor::text, true);
  update users set status = p_status, updated_at = app_now() where id = p_user;
  perform write_audit(p_actor, case when p_status = 'SUSPENDED' then 'USER_SUSPENDED' else 'USER_REACTIVATED' end, 'user', p_user::text,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end $$;

-- The guided action: move a person to another business unit and/or change their roles (for example make them BU Lead of the new unit), in one step, with an effective date and a reason.
-- It uses the existing functions, so every existing rule applies (who may hand out which role, no removing your own role-management, audit). It records no change in any report, goal or score.
create or replace function transfer_or_promote(p_actor uuid, p_employee uuid, p_to_bu uuid, p_roles text[], p_effective date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e employees; u users; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_eff date := coalesce(p_effective, (app_now() at time zone 'Africa/Lagos')::date);
        v_moved boolean := false; v_roles_changed boolean := false; v_old_roles text[]; v_src uuid; v_left_without_lead boolean := false; v_target_has_lead boolean := false;
begin
  perform require_permission(p_actor, 'users.manage');
  if v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why this person is being moved or promoted'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  if v_eff > (app_now() at time zone 'Africa/Lagos')::date then raise exception 'VALIDATION_ERROR' using detail = 'the effective date cannot be in the future; the change takes effect now'; end if;
  select * into e from employees where id = p_employee for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if e.employment_status <> 'ACTIVE' then raise exception 'VALIDATION_ERROR' using detail = 'this person is inactive; reactivate them first'; end if;
  select * into u from users where employee_id = p_employee;
  v_src := e.business_unit_id;
  if p_to_bu is not null and p_to_bu <> e.business_unit_id then
    if not exists (select 1 from business_units where id = p_to_bu and status = 'ACTIVE') then raise exception 'VALIDATION_ERROR' using detail = 'choose an active business unit'; end if;
    v_moved := true;
  end if;
  if p_roles is not null then
    if u.id is null then raise exception 'VALIDATION_ERROR' using detail = 'this person has no sign-in, so there are no roles to change'; end if;
    v_old_roles := actor_role_codes(u.id);
    v_roles_changed := (select array(select unnest(p_roles) order by 1)) is distinct from (select array(select unnest(v_old_roles) order by 1));
  end if;
  if not v_moved and not v_roles_changed then raise exception 'VALIDATION_ERROR' using detail = 'nothing would change: choose another unit or different roles'; end if;
  perform set_config('app.lifecycle_actor', p_actor::text, true);
  perform set_config('app.lifecycle_reason', v_reason, true);
  perform set_config('app.lifecycle_effective', v_eff::text, true);
  if v_roles_changed then perform set_user_roles(p_actor, u.id, p_roles); end if;
  if v_moved then perform update_employee(p_actor, p_employee, e.first_name, e.last_name, p_to_bu, 'ACTIVE'); end if;
  perform write_audit(p_actor, 'EMPLOYEE_LIFECYCLE_CHANGE', 'employee', p_employee::text, jsonb_build_object('business_unit_id', v_src, 'roles', v_old_roles),
    jsonb_build_object('business_unit_id', coalesce(p_to_bu, v_src), 'roles', p_roles, 'effective_date', v_eff), v_reason, coalesce(p_to_bu, v_src));
  if v_moved and u.id is not null then
    v_left_without_lead := 'BU_LEAD' = any(coalesce(v_old_roles, actor_role_codes(u.id))) and not exists (
      select 1 from users x join employees ex on ex.id = x.employee_id join user_roles ur on ur.user_id = x.id join roles r on r.id = ur.role_id
      where ex.business_unit_id = v_src and r.code = 'BU_LEAD' and x.status = 'ACTIVE' and x.id <> u.id);
    v_target_has_lead := exists (select 1 from users x join employees ex on ex.id = x.employee_id join user_roles ur on ur.user_id = x.id join roles r on r.id = ur.role_id
      where ex.business_unit_id = p_to_bu and r.code = 'BU_LEAD' and x.status = 'ACTIVE' and x.id <> u.id);
  end if;
  if u.id is not null then
    perform notify_users(array[u.id], 'LIFECYCLE_CHANGE', 'employee', p_employee::text, 'Your role or unit has changed',
      left(case when v_moved then 'You now belong to ' || (select name from business_units where id = p_to_bu) || '. ' else '' end || case when v_roles_changed then 'Your roles were updated. ' else '' end || 'Reason: ' || v_reason, 1000),
      'lifecycle:' || p_employee || ':' || to_char(app_now(), 'YYYYMMDDHH24MISS'));
  end if;
  return jsonb_build_object('moved', v_moved, 'roles_changed', v_roles_changed, 'source_unit_left_without_lead', v_left_without_lead, 'target_unit_has_lead', v_target_has_lead);
end $$;

insert into email_event_types (event_type, mandatory, description) values ('LIFECYCLE_CHANGE', false, 'Your unit or roles were changed') on conflict do nothing;

-- read models (security invoker: people managers see every journey, everyone their own)
create or replace function read_employee_journey(p_employee uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'employee_id', p_employee,
    'name', (select employee_name from employee_lifecycle_events where employee_id = p_employee order by seq desc limit 1),
    'email', (select employee_email from employee_lifecycle_events where employee_id = p_employee order by seq desc limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'event_type', event_type, 'effective_date', effective_date, 'occurred_at', occurred_at, 'from_bu', from_bu_name, 'to_bu', to_bu_name,
        'role_code', role_code, 'role_name', role_name, 'promotion', event_type = 'ROLE_GRANTED' and role_code in ('BU_LEAD','PRESENTER','DIRECTOR','EXECUTIVE'),
        'reason', reason, 'actor', actor_name, 'source', source) order by seq) from employee_lifecycle_events where employee_id = p_employee), '[]'::jsonb));
$$;

create or replace function read_lifecycle_recent(p_limit int) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'employee_id', employee_id, 'name', employee_name, 'event_type', event_type, 'effective_date', effective_date, 'from_bu', from_bu_name, 'to_bu', to_bu_name,
    'role_name', role_name, 'promotion', event_type = 'ROLE_GRANTED' and role_code in ('BU_LEAD','PRESENTER','DIRECTOR','EXECUTIVE'), 'reason', reason, 'actor', actor_name) order by seq desc), '[]'::jsonb)
  from (select * from employee_lifecycle_events where event_type in ('TRANSFERRED','ROLE_GRANTED','ROLE_REMOVED','DEACTIVATED','REACTIVATED','SUSPENDED','RESTORED') order by seq desc limit least(coalesce(p_limit, 20), 200)) x;
$$;

-- the journeys of people who already exist start with a "joined" entry (dated when their record was created) and the roles they hold now
insert into employee_lifecycle_events (employee_id, user_id, employee_name, employee_email, event_type, effective_date, to_bu_id, to_bu_name, source, occurred_at)
select e.id, u.id, e.first_name || ' ' || e.last_name, e.email::text, 'JOINED', (e.created_at at time zone 'Africa/Lagos')::date, e.business_unit_id, b.name, 'BACKFILL', e.created_at
from employees e join business_units b on b.id = e.business_unit_id left join users u on u.employee_id = e.id;
insert into employee_lifecycle_events (employee_id, user_id, employee_name, employee_email, event_type, effective_date, to_bu_id, to_bu_name, role_code, role_name, source, occurred_at)
select e.id, u.id, e.first_name || ' ' || e.last_name, e.email::text, 'ROLE_GRANTED', (ur.created_at at time zone 'Africa/Lagos')::date, e.business_unit_id, b.name, r.code, r.name, 'BACKFILL', ur.created_at
from user_roles ur join users u on u.id = ur.user_id join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id join roles r on r.id = ur.role_id;

select lock_down_function_grants();

-- people moved or reactivated by an employee import are recorded as such, by the person who ran the import
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('commit_employee_import(uuid,jsonb,text,text,text,text)'::regprocedure);
  if position('app.lifecycle_actor' in v_def) > 0 then return; end if;
  v_def := regexp_replace(v_def, E'\mbegin\M', E'begin perform set_config(''app.lifecycle_actor'', p_actor::text, true); perform set_config(''app.lifecycle_reason'', ''Employee import'', true);', 'i');
  execute v_def;
end $$;

select lock_down_function_grants();

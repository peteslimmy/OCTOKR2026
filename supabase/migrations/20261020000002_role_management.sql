-- Role management (ADR-069, docs/30 E-01). Roles and what they may do are created and changed in the application, as an approved configuration change
-- (ADR-068). Nothing in the database or the web tier depends on the name of a role any more: privilege rules, recipients of notifications and
-- "who must use an authenticator" are all derived from permissions and from data.
--
-- Rules (owner-approved 15 October 2026):
--  1. No escalation: a person can put on a role only permissions they hold themselves.
--  2. Protected permissions (permissions.protected) and the authenticator requirement can be changed only with a Super Admin's approval
--     (config.protected.approve) and a fresh authenticator check at the API.
--  3. Separation of duties: a change may not ADD a combination listed in permission_conflicts to a role (combinations that already exist in the
--     seeded roles are left as they are; the "never the requester" rules are by person and apply to every role).
--  4. Deletion safeguards: people holding a deleted role are moved to a role named in the request; the last holder of a critical permission
--     cannot be removed.
--  5. Every change is audited with the permissions before and after and every holder of roles.manage is alerted.

alter table roles add column description text, add column is_system boolean not null default false;
update roles set is_system = true;                                      -- the eight roles that shipped; informational, they can still be changed or deleted
alter table permissions add column protected boolean not null default false;

insert into permissions (code, description, protected) values
  ('roles.request', 'Ask for a role to be created, changed or deleted (a different person approves)', true)
on conflict (code) do update set protected = true;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('ADMIN','roles.request'), ('SUPER_ADMIN','roles.request')) v(role_code, perm)
join roles r on r.code = v.role_code join permissions p on p.code = v.perm on conflict do nothing;

update permissions set protected = true where code in (
  'roles.manage','users.manage','audit.read','config.approve','config.protected.approve','config.emergency',
  'ledger.reversal.emergency','ledger.reversal.approve','ledger.reversal.execute','attendance.session.outcome.emergency',
  'strategy.annual_theme.change_exception','integrity_penalty.configure','disbursement.approve','disbursement.disburse');

create table permission_conflicts (
  permission_a text not null references permissions(code),
  permission_b text not null references permissions(code),
  reason       text not null,
  primary key (permission_a, permission_b),
  check (permission_a < permission_b)
);
insert into permission_conflicts (permission_a, permission_b, reason) values
  ('disbursement.approve',        'disbursement.create',   'A role must not both ask for money and approve it'),
  ('disbursement.create',         'disbursement.disburse', 'A role must not both ask for money and pay it out'),
  ('attendance.amendment.approve','attendance.amendment.request', 'A role must not both ask for an attendance amendment and approve it');
alter table permission_conflicts enable row level security;
grant select on permission_conflicts to authenticated;
create policy read_all on permission_conflicts for select to authenticated using (true);

-- ------------------------------------------------------------------ helpers that replace role-name checks
create or replace function roles_hold_permission(p_codes text[], p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id
                  where r.code = any(p_codes) and p.code = p_perm);
$$;

-- a role that lets its holder administer people or roles: giving it to someone needs roles.manage (was: the names ADMIN and SUPER_ADMIN)
create or replace function role_is_privileged(p_role text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id
                  where r.code = p_role and p.code in ('users.manage','roles.manage','roles.request','config.protected.approve','config.emergency'));
$$;

create or replace function assert_can_grant_roles(p_actor uuid, p_roles text[]) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r text;
begin
  perform require_permission(p_actor, 'users.manage');
  foreach r in array p_roles loop
    if not exists (select 1 from roles where code = r) then raise exception 'VALIDATION_ERROR' using detail = 'unknown role ' || r; end if;
    if role_is_privileged(r) then perform require_permission(p_actor, 'roles.manage'); end if;
  end loop;
end $$;

create or replace function set_user_roles(p_actor uuid, p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text[]; r text; v_changed text[];
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
  if roles_hold_permission(actor_role_codes(p_user), 'roles.manage') then perform require_permission(p_actor, 'roles.manage'); end if;
  update users set status = p_status, updated_at = app_now() where id = p_user;
  perform write_audit(p_actor, case when p_status = 'SUSPENDED' then 'USER_SUSPENDED' else 'USER_REACTIVATED' end, 'user', p_user::text,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end $$;

create or replace function authorise_mfa_reset(p_actor uuid, p_target uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t users;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_actor = p_target then raise exception 'VALIDATION_ERROR' using detail = 'use the account page to manage your own authenticator'; end if;
  select * into v_t from users where id = p_target;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- only someone who can manage roles may reset someone who can (no sideways privilege path)
  if roles_hold_permission(actor_role_codes(p_target), 'roles.manage') and not actor_has_permission(p_actor, 'roles.manage') then
    raise exception 'PERMISSION_DENIED' using detail = 'only someone who can manage roles can reset an authenticator of someone who can';
  end if;
  perform write_audit(p_actor, 'AUTH_MFA_RESET_BY_ADMIN', 'user', p_target::text, null, jsonb_build_object('target_requires_mfa', user_requires_mfa(p_target)), btrim(p_reason));
  perform notify_users(array[p_target], 'MFA_RESET', 'user', p_target::text, 'Your authenticator was reset',
    'An administrator reset your authenticator app. Set up a new one the next time you sign in.', 'mfa-reset:' || p_target || ':' || extract(epoch from app_now())::bigint);
  return jsonb_build_object('target', p_target, 'requires_mfa', user_requires_mfa(p_target));
end $$;

create or replace function record_break_glass(p_target uuid, p_operator text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_operator is null or btrim(p_operator) = '' or p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from users where id = p_target) then raise exception 'NOT_FOUND'; end if;
  perform revoke_recovery_codes(p_target);
  perform write_audit(null, 'AUTH_BREAK_GLASS_MFA_RESET', 'user', p_target::text, null, jsonb_build_object('operator', btrim(p_operator)), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission('config.emergency'), p_target) || array[p_target], 'BREAK_GLASS', 'user', p_target::text, 'BREAK-GLASS authenticator reset',
    'An authenticator was reset outside the application by an operator with server access. Operator: ' || btrim(p_operator) || '. Reason: ' || btrim(p_reason),
    'break-glass:' || p_target || ':' || extract(epoch from app_now())::bigint);
end $$;

-- the first person is given the role that can manage roles (the shipped SUPER_ADMIN if it still exists), not a name written into code
create or replace function bootstrap_organisation(p_org_name text, p_org_code text, p_bu_code text, p_bu_name text, p_admin_auth_id uuid, p_admin_email text, p_admin_first text, p_admin_last text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_bu uuid; v_emp uuid; v_role uuid;
begin
  if exists (select 1 from organisations) then raise exception 'ALREADY_BOOTSTRAPPED'; end if;
  select r.id into v_role from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id
   where p.code = 'roles.manage' order by (r.code = 'SUPER_ADMIN') desc, r.code limit 1;
  if v_role is null then raise exception 'VALIDATION_ERROR' using detail = 'no role holds roles.manage; the first person cannot be set up'; end if;
  insert into organisations (name, code) values (btrim(p_org_name), upper(btrim(p_org_code))) returning id into v_org;
  insert into business_units (organisation_id, code, name) values (v_org, upper(btrim(p_bu_code)), btrim(p_bu_name)) returning id into v_bu;
  insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values (v_org, p_admin_email, p_admin_first, p_admin_last, v_bu) returning id into v_emp;
  insert into users (id, employee_id, email) values (p_admin_auth_id, v_emp, p_admin_email);
  insert into user_roles (user_id, role_id) values (p_admin_auth_id, v_role);
  perform write_audit(p_admin_auth_id, 'ORGANISATION_BOOTSTRAPPED', 'organisation', v_org::text, null, jsonb_build_object('org', p_org_name, 'bu', p_bu_name));
  return jsonb_build_object('organisation_id', v_org, 'business_unit_id', v_bu);
end $$;

-- "the people who file a Business Unit's report" are those who hold weekly_report.submit in it (was: the role name BU_LEAD)
create or replace function bu_lead_ids(p_bu uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct u.id), '{}') from users u join employees e on e.id = u.employee_id
   where e.business_unit_id = p_bu and u.status = 'ACTIVE' and actor_has_permission(u.id, 'weekly_report.submit');
$$;

-- functions whose long bodies only need one phrase changed are rewritten from their own current definition, and the change is checked
do $$
declare v_def text; v_new text; f record;
begin
  for f in select * from (values
      ('finalize_reporting_week', 'users_with_role(''BU_LEAD'')', 'users_with_permission(''weekly_report.submit'')'),
      ('skip_okr_session',        'users_with_role(''BU_LEAD'')', 'users_with_permission(''weekly_report.submit'')'),
      ('apply_session_correction','users_with_role(''BU_LEAD'')', 'users_with_permission(''weekly_report.submit'')'),
      ('declare_organization_holiday','users_with_role(''BU_LEAD'')', 'users_with_permission(''weekly_report.submit'')'),
      ('amend_organization_holiday', 'users_with_role(''BU_LEAD'')', 'users_with_permission(''weekly_report.submit'')'),
      ('send_report_reminders',   'join user_roles ur on ur.user_id = us.id join roles ro on ro.id = ur.role_id', ''),
      ('send_report_reminders',   'ro.code = ''BU_LEAD''', 'actor_has_permission(us.id, ''weekly_report.submit'')')
    ) t(fn, old_text, new_text) loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.fn;
    if v_def is null then raise exception 'function % not found', f.fn; end if;
    v_new := replace(v_def, f.old_text, f.new_text);
    if v_new = v_def then raise exception 'expected text not found in %: %', f.fn, f.old_text; end if;
    execute v_new;
  end loop;
end $$;

-- ------------------------------------------------------------------ the role change itself
insert into config_change_topics (code, description, request_permission, approve_permission, protected)
values ('ROLE_CHANGE', 'Create, change or delete a role and the permissions it holds', 'roles.request', 'config.approve', false);

create or replace function role_permission_codes(p_role uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(p.code order by p.code), '{}') from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = p_role;
$$;

create or replace function role_change_permissions(p_proposed jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct x order by x), '{}') from jsonb_array_elements_text(coalesce(p_proposed->'permissions', '[]'::jsonb)) x;
$$;

-- does this proposal need a Super Admin? Yes when it adds or removes a protected permission, changes the authenticator requirement, or deletes a role that holds one.
create or replace function role_change_is_protected(p_target text, p_proposed jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role roles; v_cur text[] := '{}'; v_new text[] := role_change_permissions(p_proposed); v_mfa_now boolean := false; v_action text := p_proposed->>'action';
begin
  if v_action <> 'CREATE' and p_target is not null then
    select * into v_role from roles where id::text = p_target;
    if found then v_cur := role_permission_codes(v_role.id); v_mfa_now := exists (select 1 from mfa_required_roles where role_id = v_role.id); end if;
  end if;
  if v_action = 'DELETE' then v_new := '{}'; end if;
  if exists (select 1 from permissions p where p.protected and ((p.code = any(v_cur)) <> (p.code = any(v_new)))) then return true; end if;
  if v_action <> 'DELETE' and coalesce((p_proposed->>'requiresMfa')::boolean, false) <> v_mfa_now then return true; end if;
  return false;
end $$;

create or replace function config_change_is_protected(p_topic text, p_proposed jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce((select protected from config_change_topics where code = p_topic), false);
end $$;
-- (ROLE_CHANGE needs the target as well, so the engine below passes it through this wrapper)
create or replace function config_change_request_is_protected(r config_change_requests) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if r.topic = 'ROLE_CHANGE' then return role_change_is_protected(r.target, r.proposed); end if;
  return config_change_is_protected(r.topic, r.proposed);
end $$;

create or replace function role_lockout_snapshot() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('roles.manage', cardinality(users_with_permission('roles.manage')),
                            'config.protected.approve', cardinality(users_with_permission('config.protected.approve')),
                            'users.manage', cardinality(users_with_permission('users.manage')));
$$;

create or replace function apply_role_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p jsonb := r.proposed; v_action text := p->>'action'; v_actor uuid := r.requested_by;
  v_code text := upper(btrim(coalesce(p->>'code', ''))); v_name text := btrim(coalesce(p->>'name', '')); v_desc text := nullif(btrim(coalesce(p->>'description', '')), '');
  v_perms text[] := role_change_permissions(p); v_mfa boolean := coalesce((p->>'requiresMfa')::boolean, false);
  v_role roles; v_cur text[] := '{}'; v_added text[]; v_removed text[]; v_bad text; v_conf record; v_holders int; v_move roles; v_before jsonb := role_lockout_snapshot(); v_after jsonb; k text; v_id uuid; v_rid text; v_label text; v_move_code text;
begin
  if v_action not in ('CREATE','UPDATE','DELETE') then raise exception 'VALIDATION_ERROR' using detail = 'action must be CREATE, UPDATE or DELETE'; end if;
  if jsonb_typeof(coalesce(p->'permissions', '[]'::jsonb)) <> 'array' then raise exception 'VALIDATION_ERROR' using detail = 'permissions must be a list'; end if;
  if v_action <> 'DELETE' then
    if v_name = '' or length(v_name) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'a role needs a name of up to 100 characters'; end if;
    if v_desc is not null and length(v_desc) > 500 then raise exception 'VALIDATION_ERROR' using detail = 'the description is limited to 500 characters'; end if;
    select string_agg(x, ', ') into v_bad from unnest(v_perms) x where not exists (select 1 from permissions where code = x);
    if v_bad is not null then raise exception 'VALIDATION_ERROR' using detail = 'unknown permission: ' || v_bad; end if;
  end if;

  if v_action = 'CREATE' then
    if v_code !~ '^[A-Z][A-Z0-9_]{1,29}$' then raise exception 'VALIDATION_ERROR' using detail = 'the role code is 2 to 30 capital letters, digits or underscores, starting with a letter'; end if;
    if exists (select 1 from roles where code = v_code) then raise exception 'VALIDATION_ERROR' using detail = 'a role with this code already exists'; end if;
    v_added := v_perms; v_removed := '{}';
  else
    select * into v_role from roles where id::text = r.target for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_cur := role_permission_codes(v_role.id);
    if v_action = 'UPDATE' then v_added := array(select x from unnest(v_perms) x where not (x = any(v_cur))); v_removed := array(select x from unnest(v_cur) x where not (x = any(v_perms)));
    else v_added := '{}'; v_removed := v_cur; end if;
  end if;

  if v_action <> 'DELETE' then
    -- rule 1: no escalation
    select string_agg(x, ', ') into v_bad from unnest(v_added) x where not actor_has_permission(v_actor, x);
    if v_bad is not null then raise exception 'PERMISSION_DENIED' using detail = 'you cannot give a role a permission you do not hold yourself: ' || v_bad; end if;
    -- rule 3: no new conflicting combination
    select c.* into v_conf from permission_conflicts c
     where (c.permission_a = any(v_added) and c.permission_b = any(v_perms)) or (c.permission_b = any(v_added) and c.permission_a = any(v_perms)) limit 1;
    if found then raise exception 'ROLE_CONFLICT' using detail = v_conf.reason || ' (' || v_conf.permission_a || ' with ' || v_conf.permission_b || ')'; end if;
  end if;

  if v_action = 'CREATE' then
    insert into roles (code, name, description, is_system) values (v_code, v_name, v_desc, false) returning id into v_id;
    v_rid := v_id::text; v_label := v_name;
    insert into role_permissions (role_id, permission_id) select v_id, id from permissions where code = any(v_perms);
    if v_mfa then insert into mfa_required_roles (role_id) values (v_id); end if;
    perform write_audit(v_actor, 'ROLE_CREATED', 'role', v_id::text, null, jsonb_build_object('code', v_code, 'name', v_name, 'permissions', v_perms, 'requires_mfa', v_mfa), r.reason);
  elsif v_action = 'UPDATE' then
    v_rid := v_role.id::text; v_label := v_name;
    update roles set name = v_name, description = v_desc where id = v_role.id;
    delete from role_permissions where role_id = v_role.id and permission_id in (select id from permissions where code = any(v_removed));
    insert into role_permissions (role_id, permission_id) select v_role.id, id from permissions where code = any(v_added);
    if v_mfa and not exists (select 1 from mfa_required_roles where role_id = v_role.id) then insert into mfa_required_roles (role_id) values (v_role.id);
    elsif not v_mfa then delete from mfa_required_roles where role_id = v_role.id; end if;
    perform write_audit(v_actor, 'ROLE_UPDATED', 'role', v_role.id::text,
      jsonb_build_object('name', v_role.name, 'permissions', v_cur), jsonb_build_object('name', v_name, 'permissions', v_perms, 'added', v_added, 'removed', v_removed, 'requires_mfa', v_mfa), r.reason);
  else
    v_rid := v_role.id::text; v_label := v_role.name;
    select count(*) into v_holders from user_roles where role_id = v_role.id;
    if v_holders > 0 then
      select * into v_move from roles where code = upper(btrim(coalesce(p->>'moveTo', '')));
      if not found or v_move.id = v_role.id then raise exception 'VALIDATION_ERROR' using detail = v_holders || ' people hold this role: choose another role to move them to'; end if;
      v_move_code := v_move.code;
      insert into user_roles (user_id, role_id, granted_by) select user_id, v_move.id, v_actor from user_roles where role_id = v_role.id on conflict do nothing;
      delete from user_roles where role_id = v_role.id;
    end if;
    delete from mfa_required_roles where role_id = v_role.id;
    delete from role_permissions where role_id = v_role.id;
    delete from roles where id = v_role.id;
    perform write_audit(v_actor, 'ROLE_DELETED', 'role', v_role.id::text, jsonb_build_object('code', v_role.code, 'name', v_role.name, 'permissions', v_cur),
      jsonb_build_object('moved_holders', v_holders, 'moved_to', v_move_code), r.reason);
  end if;

  -- rule 4: never remove the last holder of a critical permission (only checked where someone held it before)
  v_after := role_lockout_snapshot();
  for k in select jsonb_object_keys(v_before) loop
    if (v_before->>k)::int > 0 and (v_after->>k)::int = 0 then
      raise exception 'ROLE_LOCKOUT' using detail = 'this would leave nobody able to use ' || k;
    end if;
  end loop;
  -- rule 5: every holder of roles.manage is told
  perform notify_users(array_remove(users_with_permission('roles.manage'), v_actor), 'ROLE_CHANGED', 'role', v_rid,
    'A role was ' || case v_action when 'CREATE' then 'created' when 'UPDATE' then 'changed' else 'deleted' end,
    v_label || '. Reason given: ' || btrim(r.reason), 'role:' || r.id);
end $$;

-- hook the new topic into the engine (full replacements of the three functions that dispatch by topic)
create or replace function config_current_value(p_topic text, p_target text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_topic
    when 'VIOLATION_TYPE'    then (select to_jsonb(v) from violation_types v where p_target is not null and (v.id::text = p_target or v.code = upper(p_target)))
    when 'PENALTY_RATE'      then (select to_jsonb(c) from integrity_penalty_configurations c where c.effective_to is null order by c.created_at desc limit 1)
    when 'REMINDER_SETTINGS' then (select to_jsonb(s) from notification_settings s where s.id)
    when 'BU_REPORTING'      then (select to_jsonb(b) from business_units b where p_target is not null and b.id = p_target::uuid)
    when 'ROLE_CHANGE'       then (select jsonb_build_object('code', r.code, 'name', r.name, 'description', r.description, 'permissions', role_permission_codes(r.id),
                                     'requiresMfa', exists (select 1 from mfa_required_roles m where m.role_id = r.id), 'holders', (select count(*) from user_roles ur where ur.role_id = r.id))
                                   from roles r where p_target is not null and r.id::text = p_target)
    else null end;
end $$;

create or replace function apply_config_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := r.proposed;
begin
  case r.topic
    when 'VIOLATION_TYPE' then
      if p->>'action' = 'CREATE' then
        perform create_violation_type(r.requested_by, p->>'code', p->>'name', p->>'criticality', (p->>'defaultFine')::numeric);
      elsif p->>'action' = 'UPDATE' and r.target is not null then
        perform update_violation_type(r.requested_by, r.target::uuid, p->>'name', p->>'criticality', (p->>'defaultFine')::numeric, (p->>'active')::boolean);
      else raise exception 'VALIDATION_ERROR' using detail = 'action must be CREATE or UPDATE (with a target)';
      end if;
    when 'PENALTY_RATE' then
      perform set_integrity_penalty_rate(r.requested_by, (p->>'rate')::numeric);
    when 'REMINDER_SETTINGS' then
      perform update_notification_settings(r.requested_by, (p->>'remindersEnabled')::boolean,
        (select array_agg(x::int) from jsonb_array_elements_text(p->'reminderHours') x), (p->>'maxRemindersPerWeek')::int, (p->>'emailEnabled')::boolean);
    when 'BU_REPORTING' then
      if r.target is null then raise exception 'VALIDATION_ERROR' using detail = 'choose the Business Unit'; end if;
      perform update_business_unit(r.requested_by, r.target::uuid, p->>'name', p->>'status', coalesce((p->>'reportsWeekly')::boolean, true));
    when 'ROLE_CHANGE' then
      perform apply_role_change(r);
    else raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic ' || r.topic;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range or null_value_not_allowed or invalid_parameter_value then
  raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are not valid for this setting';
end $$;

-- the protected check in the engine now sees the target too: replace the two call sites by re-creating request/decide with the request record
create or replace function request_config_change(p_actor uuid, p_topic text, p_target text, p_proposed jsonb, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t config_change_topics; v_ex config_change_requests; r config_change_requests; v_id uuid; v_protected boolean;
begin
  select * into t from config_change_topics where code = p_topic;
  if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic'; end if;
  perform require_permission(p_actor, t.request_permission);
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are required'; end if;
  select * into v_ex from config_change_requests where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.requested_by <> p_actor or v_ex.topic <> p_topic or v_ex.target is distinct from p_target then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_ex.id, 'status', v_ex.status);
  end if;
  if exists (select 1 from config_change_requests where topic = p_topic and coalesce(target, '') = coalesce(p_target, '') and status = 'PENDING') then
    raise exception 'CONFIG_CHANGE_PENDING';
  end if;
  r.id := gen_random_uuid(); r.topic := p_topic; r.target := p_target; r.proposed := p_proposed; r.requested_by := p_actor; r.status := 'PENDING'; r.reason := btrim(p_reason);
  perform config_dry_run(r);                                           -- raises the setting's own validation error now, not at approval
  v_protected := config_change_request_is_protected(r);
  insert into config_change_requests (topic, target, proposed, current_value, reason, requested_by, idempotency_key)
    values (p_topic, p_target, p_proposed, config_current_value(p_topic, p_target), btrim(p_reason), p_actor, p_idempotency_key) returning id into v_id;
  perform write_audit(p_actor, 'CONFIG_CHANGE_REQUESTED', 'config_change_request', v_id::text, null, jsonb_build_object('topic', p_topic, 'target', p_target, 'proposed', p_proposed, 'protected', v_protected), btrim(p_reason));
  perform notify_users(array_remove(users_with_permission(case when v_protected then 'config.protected.approve' else t.approve_permission end), p_actor),
    'CONFIG_CHANGE_REQUESTED', 'config_change_request', v_id::text, 'A configuration change needs your decision',
    t.description || '. Reason given: ' || btrim(p_reason), 'cfg-req:' || v_id);
  return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'PENDING', 'protected', v_protected);
end $$;

create or replace function decide_config_change(p_actor uuid, p_request_id uuid, p_decision text, p_comment text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r config_change_requests; t config_change_topics; v_prev config_change_requests;
begin
  if p_decision is null or p_decision not in ('APPROVE','REJECT') then raise exception 'VALIDATION_ERROR' using detail = 'decision must be APPROVE or REJECT'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_prev from config_change_requests where decision_key = p_idempotency_key;
  if found then
    if v_prev.id <> p_request_id or v_prev.decided_by <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'request_id', v_prev.id, 'status', v_prev.status);
  end if;
  if not (actor_has_permission(p_actor, 'config.approve') or actor_has_permission(p_actor, 'config.protected.approve')) then raise exception 'PERMISSION_DENIED'; end if;   -- before looking anything up
  select * into r from config_change_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into t from config_change_topics where code = r.topic;
  perform require_permission(p_actor, t.approve_permission);
  if r.status <> 'PENDING' then raise exception 'CONFIG_CHANGE_NOT_PENDING'; end if;
  if config_change_request_is_protected(r) then perform require_permission(p_actor, 'config.protected.approve'); end if;
  if r.requested_by = p_actor then raise exception 'CONFIG_CHANGE_SELF_APPROVAL'; end if;
  if p_decision = 'REJECT' then
    if p_comment is null or btrim(p_comment) = '' then raise exception 'REASON_REQUIRED'; end if;
    update config_change_requests set status = 'REJECTED', decided_by = p_actor, decided_at = app_now(), decision_comment = btrim(p_comment), decision_key = p_idempotency_key where id = r.id;
    perform write_audit(p_actor, 'CONFIG_CHANGE_REJECTED', 'config_change_request', r.id::text, jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'REJECTED'), btrim(p_comment));
    perform notify_users(array[r.requested_by], 'CONFIG_CHANGE_DECIDED', 'config_change_request', r.id::text, 'Your configuration change was rejected', 'Reason: ' || btrim(p_comment), 'cfg-dec:' || r.id);
    return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', 'REJECTED');
  end if;
  perform apply_config_change(r);                                      -- the setting's own checks run again, now; a failure undoes the approval too
  update config_change_requests set status = 'APPLIED', decided_by = p_actor, decided_at = app_now(), decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decision_key = p_idempotency_key where id = r.id;
  perform write_audit(p_actor, 'CONFIG_CHANGE_APPLIED', 'config_change_request', r.id::text, jsonb_build_object('status', 'PENDING', 'value', r.current_value), jsonb_build_object('status', 'APPLIED', 'topic', r.topic, 'proposed', r.proposed), nullif(btrim(coalesce(p_comment, '')), ''));
  perform notify_users(array[r.requested_by], 'CONFIG_CHANGE_DECIDED', 'config_change_request', r.id::text, 'Your configuration change was approved and applied', t.description, 'cfg-dec:' || r.id);
  return jsonb_build_object('replayed', false, 'request_id', r.id, 'status', 'APPLIED');
end $$;

-- ------------------------------------------------------------------ read models for the roles screen
create or replace function read_roles() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x.name), '[]'::jsonb) from (
    select r.id, r.code, r.name, r.description, r.is_system,
           exists (select 1 from role_permissions rp2 join permissions p2 on p2.id = rp2.permission_id where rp2.role_id = r.id
                    and p2.code in ('users.manage','roles.manage','roles.request','config.protected.approve','config.emergency')) as privileged,
           exists (select 1 from mfa_required_roles m where m.role_id = r.id) as requires_mfa,
           (select count(*) from user_roles ur where ur.role_id = r.id)::int as members,
           coalesce((select jsonb_agg(p.code order by p.code) from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = r.id), '[]'::jsonb) as permissions
      from roles r) x;
$$;
create or replace function read_permissions() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'description', p.description, 'protected', p.protected) order by p.code), '[]'::jsonb) from permissions p;
$$;

select lock_down_function_grants();

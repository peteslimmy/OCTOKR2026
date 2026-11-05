-- Deeper, more granular access control.
--  1. Every permission now has a module (the area of the application it belongs to) and a risk level, so access can be read and reviewed by area and by danger.
--  2. A person can be given any single permission directly, for a reason and (optionally) for a limited time, not only the five fixed "designations".
--     A direct grant that has expired stops counting everywhere (the database checks it on every call). It can never create a conflict of duties,
--     can never give a reserved permission, and a protected one only if the grantor holds it.

alter table permissions add column module text, add column risk text check (risk in ('low', 'medium', 'high', 'critical'));

update permissions set module = case
  when code like 'strategy.%' then 'Strategy & OKRs'
  when code like 'weekly_report.%' or code like 'goal.%' or code like 'task.%' or code like 'bu_goals.%' or code like 'evidence.%' or code like 'quote.%' then 'Weekly reporting'
  when code like 'attendance.%' then 'Sessions & attendance'
  when code like 'violation.%' then 'Violations'
  when code like 'disbursement.%' or code like 'finance.%' or code like 'ledger.%' then 'Finance & fund'
  when code like 'reports.%' or code like 'dashboard.%' or code like 'presentation.%' then 'Reports & dashboards'
  when code like 'reporting.%' or code like 'quarter.%' or code like 'integrity_%' then 'Reporting calendar & integrity'
  else 'Administration & security' end;

update permissions set risk = case
  when protected or reserved then 'critical'
  when code ~ '(approve|disburse|manage|void|delete|configure|import|waive|emergency|amend|file_for_any|suspend|execute_)' then 'high'
  when code ~ '(create|edit|record|request|execute|correct|submit|review|build|export|snapshot|test|view_all)' then 'medium'
  else 'low' end;

alter table permissions alter column module set not null, alter column risk set not null;

create or replace function read_permissions() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'description', p.description, 'protected', p.protected, 'reserved', p.reserved, 'module', p.module, 'risk', p.risk) order by p.module, p.code), '[]'::jsonb) from permissions p;
$$;

alter table user_permission_grants add column reason text, add column expires_at timestamptz;

-- a grant that has expired no longer counts
create or replace function actor_has_permission(p_actor uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from users u where u.id = p_actor and u.status = 'ACTIVE') and (
    exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id
            where ur.user_id = p_actor and p.code = p_code)
    or exists (select 1 from user_permission_grants g join permissions p on p.id = g.permission_id
               where g.user_id = p_actor and p.code = p_code and (g.expires_at is null or g.expires_at > app_now())));
$$;

-- every permission a person holds now, from roles and from unexpired direct grants
create or replace function actor_permission_codes(p_user uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct code), '{}') from (
    select p.code from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id where ur.user_id = p_user
    union
    select p.code from user_permission_grants g join permissions p on p.id = g.permission_id where g.user_id = p_user and (g.expires_at is null or g.expires_at > app_now())) x;
$$;

create or replace function grant_user_permission(p_actor uuid, p_user uuid, p_permission text, p_grant boolean, p_reason text, p_expires_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p permissions; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_after text[]; c record;
begin
  perform require_permission(p_actor, 'roles.manage');
  select * into v_p from permissions where code = p_permission;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  if p_grant is null then raise exception 'VALIDATION_ERROR' using detail = 'say whether to grant or remove'; end if;

  if not p_grant then
    delete from user_permission_grants where user_id = p_user and permission_id = v_p.id;
    perform write_audit(p_actor, 'PERMISSION_GRANT_REMOVED', 'user', p_user::text, jsonb_build_object('permission', p_permission), null, v_reason);
    return;
  end if;

  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  if v_p.reserved then raise exception 'VALIDATION_ERROR' using detail = 'a reserved permission can only be held through a role'; end if;
  if v_p.protected and not actor_has_permission(p_actor, p_permission) then raise exception 'PERMISSION_DENIED' using detail = 'you can only grant a protected permission you hold yourself'; end if;
  if p_expires_at is not null and (p_expires_at <= app_now() or p_expires_at > app_now() + interval '366 days') then
    raise exception 'VALIDATION_ERROR' using detail = 'an expiry must be in the future and within a year'; end if;
  if exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id where ur.user_id = p_user and rp.permission_id = v_p.id) then
    raise exception 'VALIDATION_ERROR' using detail = 'the person already holds this permission through a role'; end if;

  -- a direct grant may not create a conflict of duties (for example asking for money and approving it)
  v_after := array_append(actor_permission_codes(p_user), p_permission);
  select * into c from permission_conflicts where permission_a = any(v_after) and permission_b = any(v_after) limit 1;
  if found then raise exception 'SEPARATION_OF_DUTIES' using detail = c.reason; end if;

  insert into user_permission_grants (user_id, permission_id, granted_by, reason, expires_at) values (p_user, v_p.id, p_actor, v_reason, p_expires_at)
  on conflict (user_id, permission_id) do update set granted_by = excluded.granted_by, reason = excluded.reason, expires_at = excluded.expires_at, created_at = app_now();
  perform write_audit(p_actor, 'PERMISSION_GRANTED', 'user', p_user::text, null, jsonb_build_object('permission', p_permission, 'expires_at', p_expires_at), v_reason);
end $$;

select lock_down_function_grants();

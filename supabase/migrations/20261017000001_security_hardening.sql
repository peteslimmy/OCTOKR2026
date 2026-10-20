-- Milestone 4: authentication hardening (ADR-052): password reset and change auditing, TOTP MFA policy, MFA failure lockout,
-- administrator MFA reset, and database-level enforcement of the second factor for RLS reads.

-- the RLS wrappers call auth_aal_satisfied as the invoking user, so it joins the grant whitelist
create or replace function lock_down_function_grants() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'lock_down_function_grants' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.proname in ('auth_has_permission','auth_bu','app_now','report_phase','quarter_is_locked','auth_can_view_bu',
                     'goal_is_done','report_goal_counts','calc_base_score','calc_final_score','active_penalty_rate',
                     'auth_has_any','attendance_effective_status','fund_balance','fund_committed','report_phase_of','auth_aal_satisfied')
       or r.proname like 'read\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- MFA policy
-- Roles whose holders must use a second factor (ADR-023: SUPER_ADMIN, ADMIN, FINANCE; spec 18: "MFA for elevated users").
create table mfa_required_roles (
  role_id uuid primary key references roles(id) on delete restrict
);
insert into mfa_required_roles (role_id) select id from roles where code in ('SUPER_ADMIN','ADMIN','FINANCE');
alter table mfa_required_roles enable row level security;
create policy read_all on mfa_required_roles for select to authenticated using (true);
grant select on mfa_required_roles to authenticated;

create or replace function user_requires_mfa(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from user_roles ur join mfa_required_roles m on m.role_id = ur.role_id where ur.user_id = p_user);
$$;

create or replace function user_has_verified_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified' and f.factor_type = 'totp');
$$;

-- The caller's own MFA situation, for the application shell.
create or replace function read_my_mfa_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('required', user_requires_mfa(auth.uid()), 'enrolled', user_has_verified_factor(auth.uid()),
                            'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'));
$$;

-- A caller satisfies the second factor when none applies, or the session has been elevated to AAL2.
create or replace function auth_aal_satisfied() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when auth.uid() is null then false
    when user_requires_mfa(auth.uid()) or user_has_verified_factor(auth.uid()) then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    else true end;
$$;

-- RLS-facing wrappers now fail closed for an elevated or enrolled user whose session has not completed MFA, so a password-only
-- token cannot read protected data straight from the REST API (the API layer enforces the same rule for service-role RPCs).
create or replace function auth_has_permission(p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth_aal_satisfied() and actor_has_permission(auth.uid(), p_code);
$$;
create or replace function auth_has_any(p_codes text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth_aal_satisfied() and exists (select 1 from unnest(p_codes) c where actor_has_permission(auth.uid(), c));
$$;
create or replace function auth_bu() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth_aal_satisfied() then actor_bu(auth.uid()) else null end;
$$;

-- ---------------------------------------------------------------- audit helpers (service-only)
create or replace function record_password_reset_requested(p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u uuid;
begin
  select id into v_u from users where email = p_email::extensions.citext and status = 'ACTIVE';
  -- always audited, never revealed to the caller: whether the account exists is not disclosed
  perform write_audit(v_u, 'AUTH_PASSWORD_RESET_REQUESTED', 'user', coalesce(v_u::text, 'unknown'), null,
                      jsonb_build_object('known_account', v_u is not null), null, null, case when v_u is null then 'DENIED' else 'SUCCESS' end);
end $$;

create or replace function record_password_changed(p_user uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_kind not in ('RESET','CHANGE') then raise exception 'VALIDATION_ERROR'; end if;
  update users set failed_attempts = 0, locked_until = null where id = p_user;
  perform write_audit(p_user, case p_kind when 'RESET' then 'AUTH_PASSWORD_RESET' else 'AUTH_PASSWORD_CHANGED' end, 'user', p_user::text);
  perform notify_users(array[p_user], 'PASSWORD_CHANGED', 'user', p_user::text, 'Your password was changed',
    'If this was not you, contact your administrator immediately. All other sessions were signed out.', 'pwd:' || p_user || ':' || extract(epoch from app_now())::bigint);
end $$;

create or replace function record_mfa_event(p_user uuid, p_action text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_action not in ('AUTH_MFA_ENROLLED','AUTH_MFA_VERIFIED','AUTH_MFA_STEP_UP','AUTH_MFA_DISABLED') then raise exception 'VALIDATION_ERROR'; end if;
  if p_action in ('AUTH_MFA_VERIFIED') then
    update users set failed_attempts = 0, locked_until = null, last_login_at = app_now() where id = p_user;
  end if;
  perform write_audit(p_user, p_action, 'user', p_user::text, null, p_details);
end $$;

-- A wrong second factor counts toward the same lockout as a wrong password.
create or replace function record_mfa_failure(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_locked boolean := false;
begin
  update users set failed_attempts = failed_attempts + 1,
         locked_until = case when failed_attempts + 1 >= 5 then app_now() + interval '15 minutes' else locked_until end
   where id = p_user returning locked_until is not null and locked_until > app_now() into v_locked;
  perform write_audit(p_user, case when v_locked then 'AUTH_ACCOUNT_LOCKED' else 'AUTH_MFA_FAILED' end, 'user', p_user::text, null, null, null, null, 'DENIED');
  return coalesce(v_locked, false);
end $$;

create or replace function user_is_locked(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select locked_until is not null and locked_until > app_now() from users where id = p_user), false);
$$;

-- Administrator-assisted recovery for a user who lost their authenticator. The API deletes the factors after this authorises and audits.
create or replace function authorise_mfa_reset(p_actor uuid, p_target uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t users;
begin
  perform require_permission(p_actor, 'users.manage');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_actor = p_target then raise exception 'VALIDATION_ERROR' using detail = 'use the account page to manage your own authenticator'; end if;
  select * into v_t from users where id = p_target;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- only a Super Admin may reset another Super Admin (no sideways privilege path)
  if exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_target and r.code = 'SUPER_ADMIN')
     and not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_actor and r.code = 'SUPER_ADMIN') then
    raise exception 'PERMISSION_DENIED' using detail = 'only a Super Admin can reset a Super Admin';
  end if;
  perform write_audit(p_actor, 'AUTH_MFA_RESET_BY_ADMIN', 'user', p_target::text, null, jsonb_build_object('target_requires_mfa', user_requires_mfa(p_target)), btrim(p_reason));
  perform notify_users(array[p_target], 'MFA_RESET', 'user', p_target::text, 'Your authenticator was reset',
    'An administrator reset your authenticator app. Set up a new one the next time you sign in.', 'mfa-reset:' || p_target || ':' || extract(epoch from app_now())::bigint);
  return jsonb_build_object('target', p_target, 'requires_mfa', user_requires_mfa(p_target));
end $$;

select lock_down_function_grants();

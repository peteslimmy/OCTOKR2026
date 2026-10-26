-- Email one-time passcodes as a second factor alongside the authenticator app (ADR-052).
--
-- Supabase MFA only knows TOTP and phone, and an email OTP is a primary (aal1) sign-in, so the app verifies the
-- mailed code itself and records a short-lived server-side verification for the caller's session. auth_aal_satisfied()
-- accepts either a verified TOTP factor (JWT aal2) or an unexpired email verification for that same session, so every
-- existing RLS wrapper and API gate keeps working unchanged.

create table email_mfa_factors (
  user_id uuid primary key references users(id) on delete cascade,
  enrolled_at timestamptz not null default app_now(),
  last_verified_at timestamptz
);

create table email_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('LOGIN', 'STEP_UP', 'ENROL')),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index email_otp_challenges_open_idx
  on email_otp_challenges (user_id, session_id, purpose, created_at desc)
  where consumed_at is null;

create table mfa_email_verifications (
  session_id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index mfa_email_verifications_user_idx on mfa_email_verifications (user_id, expires_at);

-- These hold secrets. The API reaches them only through the security-definer functions below, which run for the
-- service role, so no client policy is wanted or needed.
alter table email_mfa_factors enable row level security;
alter table email_otp_challenges enable row level security;
alter table mfa_email_verifications enable row level security;
revoke all on email_mfa_factors from anon, authenticated;
revoke all on email_otp_challenges from anon, authenticated;
revoke all on mfa_email_verifications from anon, authenticated;

create or replace function user_has_email_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from email_mfa_factors f where f.user_id = p_user);
$$;

-- Kept separate from the combined check so the recovery-code rules stay authenticator-app specific.
create or replace function user_has_verified_totp(p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified' and f.factor_type = 'totp');
$$;

create or replace function user_has_verified_factor(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select user_has_verified_totp(p_user) or user_has_email_factor(p_user);
$$;

-- The caller's own MFA situation, for the application shell. "enrolled" means any second factor is set up;
-- "aal" is the effective level, so an unexpired email verification counts as the second factor for this session.
create or replace function read_my_mfa_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'required', user_requires_mfa(auth.uid()),
    'totp', user_has_verified_totp(auth.uid()),
    'email', user_has_email_factor(auth.uid()),
    'enrolled', user_has_verified_factor(auth.uid()),
    'aal', case
      when coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then 'aal2'
      when exists (
        select 1 from mfa_email_verifications v
         where v.user_id = auth.uid()
           and v.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
           and v.expires_at > now()
      ) then 'aal2'
      else 'aal1'
    end,
    'emailVerifiedAt', (
      select to_jsonb(v.verified_at) from mfa_email_verifications v
       where v.user_id = auth.uid()
         and v.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
         and v.expires_at > now()
       limit 1
    )
  );
$$;

-- A caller satisfies the second factor when none applies, when the session is AAL2, or when this session has a live
-- email verification. A password-only token still fails closed, exactly as before.
create or replace function auth_aal_satisfied() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when auth.uid() is null then false
    when not (user_requires_mfa(auth.uid()) or user_has_verified_factor(auth.uid())) then true
    when coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then true
    else exists (
      select 1 from mfa_email_verifications v
       where v.user_id = auth.uid()
         and v.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
         and v.expires_at > now()
    )
  end;
$$;

-- Issue a challenge for a signed-in session. One live challenge per purpose and session: a resend replaces the last.
create or replace function mfa_email_begin(p_user uuid, p_session_id uuid, p_purpose text, p_code_hash text, p_ttl_seconds integer)
returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_id uuid; v_ttl integer;
begin
  if p_purpose not in ('LOGIN', 'STEP_UP', 'ENROL') then raise exception 'VALIDATION_ERROR' using detail = 'unknown email code purpose'; end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR' using detail = 'malformed code hash'; end if;
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user) then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 600), 1800));
  delete from email_otp_challenges where user_id = p_user and created_at < now() - interval '1 day';
  update email_otp_challenges set consumed_at = now()
   where user_id = p_user and session_id = p_session_id and purpose = p_purpose and consumed_at is null;
  insert into email_otp_challenges (user_id, purpose, code_hash, session_id, expires_at)
    values (p_user, p_purpose, p_code_hash, p_session_id, now() + make_interval(secs => v_ttl))
    returning id into v_id;
  return v_id;
end $$;

-- Check a mailed code. A wrong code counts toward the ordinary 5-failure / 15-minute lock, and the challenge is burnt
-- once it expires, runs out of attempts, or the account locks. A correct code records the session verification and,
-- for ENROL, turns the email factor on. The API writes the audit event (record_mfa_event) because only it knows whether
-- the pass was a login, a step-up, or an enrolment.
create or replace function mfa_email_consume(p_user uuid, p_session_id uuid, p_purpose text, p_code_hash text, p_max_attempts integer default 5)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c email_otp_challenges; v_locked boolean; v_max integer; v_attempts integer;
begin
  if p_purpose not in ('LOGIN', 'STEP_UP', 'ENROL') then raise exception 'VALIDATION_ERROR' using detail = 'unknown email code purpose'; end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR' using detail = 'malformed code hash'; end if;
  if user_is_locked(p_user) then return jsonb_build_object('status', 'LOCKED'); end if;

  v_max := greatest(1, coalesce(p_max_attempts, 5));
  select * into v_c from email_otp_challenges
   where user_id = p_user and session_id = p_session_id and purpose = p_purpose and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then return jsonb_build_object('status', 'NO_CHALLENGE'); end if;

  if v_c.expires_at <= now() then
    update email_otp_challenges set consumed_at = now() where id = v_c.id;
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  if v_c.attempts >= v_max then
    update email_otp_challenges set consumed_at = now() where id = v_c.id;
    return jsonb_build_object('status', 'TOO_MANY');
  end if;

  if v_c.code_hash <> p_code_hash then
    v_attempts := v_c.attempts + 1;
    update email_otp_challenges set attempts = v_attempts where id = v_c.id;
    v_locked := record_mfa_failure(p_user);
    if v_locked or v_attempts >= v_max then
      update email_otp_challenges set consumed_at = now() where id = v_c.id;
    end if;
    return jsonb_build_object('status', case when v_locked then 'LOCKED' else case when v_attempts >= v_max then 'TOO_MANY' else 'INVALID' end end);
  end if;

  update email_otp_challenges set consumed_at = now() where id = v_c.id;

  insert into mfa_email_verifications (session_id, user_id, verified_at, expires_at)
    values (p_session_id, p_user, now(), now() + interval '12 hours')
    on conflict (session_id) do update
      set user_id = excluded.user_id,
          verified_at = now(),
          expires_at = greatest(mfa_email_verifications.expires_at, now() + interval '12 hours');

  if p_purpose = 'ENROL' then
    insert into email_mfa_factors (user_id) values (p_user)
      on conflict (user_id) do update set last_verified_at = now();
  end if;
  update email_mfa_factors set last_verified_at = now() where user_id = p_user;

  return jsonb_build_object('status', 'OK');
end $$;

-- Lets the API retire a challenge whose mail could not be delivered, so a failed send never leaves a live code.
create or replace function mfa_email_cancel(p_challenge uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update email_otp_challenges set consumed_at = now() where id = p_challenge and consumed_at is null;
$$;

-- Turning email codes off is refused while they are the only second factor of a role that needs one.
create or replace function disable_email_mfa(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not user_has_email_factor(p_user) then raise exception 'MFA_NOT_ENROLLED'; end if;
  if user_requires_mfa(p_user) and not user_has_verified_totp(p_user) then
    raise exception 'MFA_REQUIRED_BY_ROLE' using detail = 'set up an authenticator app before removing email codes';
  end if;
  delete from email_mfa_factors where user_id = p_user;
  delete from mfa_email_verifications where user_id = p_user;
  delete from email_otp_challenges where user_id = p_user;
  perform record_mfa_event(p_user, 'AUTH_MFA_DISABLED', jsonb_build_object('method', 'email'));
end $$;

select lock_down_function_grants();

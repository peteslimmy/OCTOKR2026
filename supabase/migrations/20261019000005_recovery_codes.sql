-- Lost-authenticator recovery (owner decision 7, 14 October 2026; ADR-060).
-- One-time recovery codes are shown to the user once, when they set up an authenticator (and again whenever they ask for a new set).
-- Only a keyed hash is stored. Using a code does NOT grant access by itself: it removes the authenticator, ends every other session and
-- sends the person back to set up a new one, exactly like an administrator reset, but without needing an administrator.
-- A break-glass procedure for a locked-out Super Admin is recorded in the audit log under its own action.

create table mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete restrict,
  batch_id    uuid not null,
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default app_now(),
  used_at     timestamptz,
  revoked_at  timestamptz,
  unique (user_id, code_hash),
  check (used_at is null or revoked_at is null)
);
create index mfa_recovery_codes_user_idx on mfa_recovery_codes (user_id) where used_at is null and revoked_at is null;

-- A code can be used once or revoked once; nothing else about it ever changes and it is never deleted.
create or replace function mfa_recovery_code_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'recovery codes are never deleted'; end if;
  if new.user_id <> old.user_id or new.code_hash <> old.code_hash or new.batch_id <> old.batch_id or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'a recovery code cannot be edited';
  end if;
  if old.used_at is not null or old.revoked_at is not null then raise exception 'IMMUTABLE_RECORD' using detail = 'a used or revoked code cannot change'; end if;
  return new;
end $$;
create trigger mfa_recovery_codes_guard before update or delete on mfa_recovery_codes for each row execute function mfa_recovery_code_guard();

alter table mfa_recovery_codes enable row level security;     -- no policy and no grant: the hashes are never readable by a browser session

-- Replaces the user's unused codes with a new set. The caller (the API) generated the codes and passes only their hashes.
create or replace function issue_recovery_codes(p_user uuid, p_hashes text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch uuid := gen_random_uuid(); h text; v_revoked int;
begin
  if p_hashes is null or cardinality(p_hashes) <> 10 then raise exception 'VALIDATION_ERROR' using detail = 'exactly 10 codes are issued at a time'; end if;
  if exists (select 1 from unnest(p_hashes) x where x is null or x !~ '^[0-9a-f]{64}$') or (select count(distinct x) from unnest(p_hashes) x) <> 10 then
    raise exception 'VALIDATION_ERROR' using detail = 'codes must be ten distinct 64-character hashes';
  end if;
  if not exists (select 1 from users where id = p_user and status = 'ACTIVE') then raise exception 'NOT_FOUND'; end if;
  if not user_has_verified_factor(p_user) then raise exception 'MFA_NOT_ENROLLED' using detail = 'recovery codes belong to an active authenticator'; end if;
  update mfa_recovery_codes set revoked_at = app_now() where user_id = p_user and used_at is null and revoked_at is null;
  get diagnostics v_revoked = row_count;
  foreach h in array p_hashes loop
    insert into mfa_recovery_codes (user_id, batch_id, code_hash) values (p_user, v_batch, h);
  end loop;
  perform write_audit(p_user, 'AUTH_RECOVERY_CODES_ISSUED', 'user', p_user::text, null, jsonb_build_object('count', 10, 'replaced_unused', v_revoked));
  return jsonb_build_object('batch_id', v_batch, 'issued', 10, 'replaced_unused', v_revoked);
end $$;

-- Uses one code. Returns true only if the code was valid and unused; it is spent in the same statement. A wrong code counts toward lockout.
create or replace function consume_recovery_code(p_user uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if user_is_locked(p_user) then return false; end if;
  select id into v_id from mfa_recovery_codes where user_id = p_user and code_hash = p_hash and used_at is null and revoked_at is null for update;
  if not found then
    perform record_mfa_failure(p_user);
    return false;
  end if;
  update mfa_recovery_codes set used_at = app_now() where id = v_id;
  perform write_audit(p_user, 'AUTH_RECOVERY_CODE_USED', 'user', p_user::text, null,
    jsonb_build_object('remaining', (select count(*) from mfa_recovery_codes where user_id = p_user and used_at is null and revoked_at is null)));
  perform notify_users(array[p_user], 'MFA_RECOVERED', 'user', p_user::text, 'A recovery code was used on your account',
    'Your authenticator was removed and your other sessions were signed out. Set up a new authenticator now. If this was not you, contact an administrator immediately.',
    'mfa-recovered:' || p_user || ':' || extract(epoch from app_now())::bigint);
  return true;
end $$;

-- After a recovery or a reset: unused codes belong to a factor that no longer exists.
create or replace function revoke_recovery_codes(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update mfa_recovery_codes set revoked_at = app_now() where user_id = p_user and used_at is null and revoked_at is null;
$$;

-- Ends every session of the user except (optionally) the one making the request.
create or replace function revoke_user_sessions(p_user uuid, p_keep uuid default null) returns int
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user and (p_keep is null or id <> p_keep);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function read_my_recovery_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('remaining', (select count(*) from mfa_recovery_codes where user_id = auth.uid() and used_at is null and revoked_at is null),
                            'last_issued_at', (select max(created_at) from mfa_recovery_codes where user_id = auth.uid()));
$$;
grant execute on function read_my_recovery_status() to authenticated;

-- Used by the break-glass script when no Super Admin can sign in. The operator, host and reason are recorded; there is no user actor.
create or replace function record_break_glass(p_target uuid, p_operator text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_operator is null or btrim(p_operator) = '' or p_reason is null or length(btrim(p_reason)) < 10 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from users where id = p_target) then raise exception 'NOT_FOUND'; end if;
  perform revoke_recovery_codes(p_target);
  perform write_audit(null, 'AUTH_BREAK_GLASS_MFA_RESET', 'user', p_target::text, null, jsonb_build_object('operator', btrim(p_operator)), btrim(p_reason));
  perform notify_users(array_remove(users_with_role('SUPER_ADMIN'), p_target) || array[p_target], 'BREAK_GLASS', 'user', p_target::text, 'BREAK-GLASS authenticator reset',
    'An authenticator was reset outside the application by an operator with server access. Operator: ' || btrim(p_operator) || '. Reason: ' || btrim(p_reason),
    'break-glass:' || p_target || ':' || extract(epoch from app_now())::bigint);
end $$;


-- the two new account-security audit actions go through the same function as the existing ones
create or replace function record_mfa_event(p_user uuid, p_action text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_action not in ('AUTH_MFA_ENROLLED','AUTH_MFA_VERIFIED','AUTH_MFA_STEP_UP','AUTH_MFA_DISABLED','AUTH_MFA_RECOVERED') then raise exception 'VALIDATION_ERROR'; end if;
  if p_action in ('AUTH_MFA_VERIFIED') then
    update users set failed_attempts = 0, locked_until = null, last_login_at = app_now() where id = p_user;
  end if;
  perform write_audit(p_user, p_action, 'user', p_user::text, null, p_details);
end $$;

select lock_down_function_grants();
grant execute on function read_my_recovery_status() to authenticated;

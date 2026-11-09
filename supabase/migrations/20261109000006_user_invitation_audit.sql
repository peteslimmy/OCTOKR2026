-- Invitation emails (ADR-117): every attempt to email a new person their set-up link is recorded in the audit log, with its outcome (never the link).
-- Called only by the server (service role) after it has checked the caller may manage users; the function checks the permission again.

create or replace function record_user_invitation(p_actor uuid, p_user uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'users.manage');
  if p_outcome not in ('SENT', 'NO_PROVIDER', 'FAILED') then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  perform write_audit(p_actor, 'USER_INVITATION_' || p_outcome, 'user', p_user::text, null, jsonb_build_object('outcome', p_outcome));
end $$;

select lock_down_function_grants();

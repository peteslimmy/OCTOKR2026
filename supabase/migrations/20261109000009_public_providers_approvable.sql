-- A Super Admin may approve a public mail provider (gmail.com ...) as a domain when it is needed (ADR-119, amended).
-- Approval stays a Super Admin act, needs a fresh second factor and is audited. Once approved, Admins can add people on that domain like any other approved domain.

create or replace function save_allowed_domain(p_actor uuid, p_domain text, p_add boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d text := lower(btrim(coalesce(p_domain, '')));
begin
  if not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED'; end if;
  if p_add then
    begin insert into allowed_email_domains (domain, created_by) values (d, p_actor);
    exception when check_violation then raise exception 'VALIDATION_ERROR' using detail = 'enter a domain such as example.com';
              when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'that domain is already approved'; end;
    perform write_audit(p_actor, 'EMAIL_DOMAIN_APPROVED', 'email_domain', d);
  else
    if exists (select 1 from users u where u.status = 'ACTIVE' and lower(split_part(u.email::text, '@', 2)) = d and not is_super_admin(u.id)) then
      raise exception 'VALIDATION_ERROR' using detail = 'active people still use this domain: deactivate them first'; end if;
    delete from allowed_email_domains where domain = d;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform write_audit(p_actor, 'EMAIL_DOMAIN_REMOVED', 'email_domain', d);
  end if;
end $$;

-- the refusal an Admin gets for an unapproved domain tells them what to do again
do $$
declare v_def text;
  a text := 'that email domain is not approved: use a company address (public mail providers cannot be approved)';
  b text := 'that email domain is not approved: ask the Super Admin to approve it under Administration > Settings';
begin
  v_def := pg_get_functiondef('provision_user(uuid,uuid,text,text,text,uuid,text[])'::regprocedure);
  if position(a in v_def) = 0 then return; end if;
  execute replace(v_def, a, b);
end $$;

select lock_down_function_grants();

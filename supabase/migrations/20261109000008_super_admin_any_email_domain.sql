-- A Super Admin may add a person on any email address, public mail providers included, without approving the domain (ADR-119).
-- Everyone else still needs an approved company domain, and public providers (gmail.com ...) can never be approved: the message now says so plainly.
-- A Super Admin's use of an unapproved domain is recorded (USER_CREATED_UNAPPROVED_DOMAIN), visible only to Super Admins (ADR-118).

do $$
declare v_def text;
  a text := 'if not email_domain_approved(p_email) then raise exception ''VALIDATION_ERROR'' using detail = ''that email domain is not approved: ask the Super Admin to approve it first''; end if;';
begin
  v_def := pg_get_functiondef('provision_user(uuid,uuid,text,text,text,uuid,text[])'::regprocedure);
  if position('USER_CREATED_UNAPPROVED_DOMAIN' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'provision_user changed'; end if;
  execute replace(v_def, a,
    'if not email_domain_approved(p_email) then '
    || 'if not is_super_admin(p_actor) then raise exception ''VALIDATION_ERROR'' using detail = ''that email domain is not approved: use a company address (public mail providers cannot be approved)''; end if; '
    || 'perform write_audit(p_actor, ''USER_CREATED_UNAPPROVED_DOMAIN'', ''user'', p_auth_id::text, null, jsonb_build_object(''domain'', lower(split_part(btrim(p_email), ''@'', 2)))); '
    || 'end if;');
end $$;

-- the approved list: the refusal of a public provider explains the rule as it now is
create or replace function save_allowed_domain(p_actor uuid, p_domain text, p_add boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d text := lower(btrim(coalesce(p_domain, '')));
begin
  if not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED'; end if;
  if d in ('gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com') then
    raise exception 'VALIDATION_ERROR' using detail = 'public mail providers cannot be approved. As Super Admin you can add a person on any address without approving it'; end if;
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

select lock_down_function_grants();

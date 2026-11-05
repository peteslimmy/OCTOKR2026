-- Only people on an approved email domain can have an account, and only the Super Admin may use another address (such as a personal gmail).
-- The list is kept by the Super Admin. A domain cannot be removed while active people still use it.
create table allowed_email_domains (
  domain     text primary key check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  created_by uuid references users(id),
  created_at timestamptz not null default app_now()
);
alter table allowed_email_domains enable row level security;
grant select on allowed_email_domains to authenticated;
create policy read_admin on allowed_email_domains for select to authenticated using ((select auth_has_permission('users.manage')));

-- the domains already in use stay approved, so nobody is locked out by this change
insert into allowed_email_domains (domain)
select distinct lower(split_part(email::text, '@', 2)) from users
where lower(split_part(email::text, '@', 2)) not in ('gmail.com', 'googlemail.com', 'sim.local')
on conflict do nothing;

create or replace function is_super_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_user and r.code = 'SUPER_ADMIN');
$$;

create or replace function email_domain_approved(p_email text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from allowed_email_domains where domain = lower(split_part(btrim(p_email), '@', 2)));
$$;

-- may this signed-in person use the app: an approved domain, or the Super Admin
create or replace function my_domain_allowed() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_super_admin(u.id) or email_domain_approved(u.email::text) from users u where u.id = auth.uid()), false);
$$;

create or replace function login_domain_allowed(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_super_admin(u.id) or email_domain_approved(u.email::text) from users u where u.id = p_user), false);
$$;

create or replace function save_allowed_domain(p_actor uuid, p_domain text, p_add boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d text := lower(btrim(coalesce(p_domain, '')));
begin
  if not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED'; end if;
  if d in ('gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com') then
    raise exception 'VALIDATION_ERROR' using detail = 'that is a public mail provider: only the Super Admin may use one, and that needs no approval'; end if;
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

-- a new account must be on an approved domain; there is no exception here (the Super Admin account already exists)
do $$
declare v_def text; a text := 'perform assert_can_grant_roles(p_actor, p_roles);';
begin
  v_def := pg_get_functiondef('provision_user(uuid,uuid,text,text,text,uuid,text[])'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'provision_user changed'; end if;
  execute replace(v_def, a, a || ' if not email_domain_approved(p_email) then raise exception ''VALIDATION_ERROR'' using detail = ''that email domain is not approved: ask the Super Admin to approve it first''; end if;');
end $$;

select lock_down_function_grants();

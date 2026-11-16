-- The Super Admin holds every permission that exists (the rule set in 20261101000001). The Executive Oversight migration added 13 permissions and
-- never granted them to the Super Admin. This grants every missing one now, and from now on any permission added later is granted to the
-- Super Admin by a trigger, so the rule no longer depends on each migration remembering it.
-- Segregation of duties still holds: it is enforced inside the functions (a person cannot approve their own request), not by withholding permissions.

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p where r.code = 'SUPER_ADMIN'
on conflict do nothing;

create or replace function grant_new_permission_to_super_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into role_permissions (role_id, permission_id) select r.id, new.id from roles r where r.code = 'SUPER_ADMIN' on conflict do nothing;
  return new;
end $$;

drop trigger if exists permissions_grant_super_admin on permissions;
create trigger permissions_grant_super_admin after insert on permissions for each row execute function grant_new_permission_to_super_admin();

select lock_down_function_grants();

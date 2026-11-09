-- An Admin may change a unit between Business Unit and Department (ADR-122; owner request, supersedes the Super-Admin-only part of ADR-114).
-- Unchanged: a written reason is required, the change is audited (BU_TYPE_CHANGED), the route asks for a fresh authenticator code,
-- and the permission stays protected (who holds it is itself a change that needs a Super Admin's approval).
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p where r.code = 'ADMIN' and p.code = 'business_units.change_type'
on conflict do nothing;
update permissions set description = 'Change a unit between Business Unit and Department (Super Admin and Admin)' where code = 'business_units.change_type';
select lock_down_function_grants();

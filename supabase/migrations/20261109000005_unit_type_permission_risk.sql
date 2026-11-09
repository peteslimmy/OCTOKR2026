-- business_units.change_type is a protected permission, and every protected permission is classed critical (rbac_access test). The migration that
-- added it classed it high; this corrects that. Nothing else about the permission changes.
update permissions set risk = 'critical' where code = 'business_units.change_type' and risk <> 'critical';

select lock_down_function_grants();

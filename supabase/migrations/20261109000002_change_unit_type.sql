-- Super Admin: change a unit between Business Unit and Department, in both directions (ADR-114).
--
-- Audit finding: `unit_type` is a classification label only. Reporting, scoring, rankings, compliance, goals, the quote rota and the
-- reminders all key off `reports_weekly` and `status`, never `unit_type`; access scope keys off the unit id. So changing the type moves a
-- unit between the "Business Units" and "Departments" groups (admin list, performance picker) and changes nothing else. The function
-- therefore never touches reports_weekly, status, parent, people, reports or scores, and says so in its result and audit entry.

insert into permissions (code, description, protected, reserved, module, risk) values
  ('business_units.change_type', 'Change a unit between Business Unit and Department (promote or demote)', true, false, 'Administration', 'high')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'SUPER_ADMIN' and p.code = 'business_units.change_type'
on conflict do nothing;

insert into audit_action_rules (pattern, category, severity, priority) values ('BU_TYPE_CHANGED', 'ORGANISATION', 'MEDIUM', 900)
on conflict (pattern) do nothing;

create or replace function change_business_unit_type(p_actor uuid, p_id uuid, p_new_type text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old business_units; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_children int; v_people int; v_reports int;
begin
  perform require_permission(p_actor, 'business_units.change_type');
  if p_new_type is null or p_new_type not in ('BUSINESS_UNIT','DEPARTMENT') then
    raise exception 'VALIDATION_ERROR' using detail = 'unit type must be BUSINESS_UNIT or DEPARTMENT';
  end if;
  if v_reason is null or char_length(v_reason) > 2000 then
    raise exception 'VALIDATION_ERROR' using detail = 'a reason of up to 2000 characters is required';
  end if;
  select * into v_old from business_units where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_old.unit_type = p_new_type then
    raise exception 'VALIDATION_ERROR' using detail = 'the unit is already of that type';
  end if;

  select count(*)::int into v_children from business_units where parent_unit_id = p_id;
  select count(*)::int into v_people from employees where business_unit_id = p_id;
  select count(*)::int into v_reports from weekly_reports where business_unit_id = p_id;

  update business_units set unit_type = p_new_type, updated_at = app_now() where id = p_id;

  perform write_audit(p_actor, 'BU_TYPE_CHANGED', 'business_unit', p_id::text,
    jsonb_build_object('unit_type', v_old.unit_type),
    jsonb_build_object('unit_type', p_new_type, 'code', v_old.code, 'reports_weekly', v_old.reports_weekly, 'status', v_old.status,
                       'child_units', v_children, 'employees', v_people, 'weekly_reports', v_reports),
    v_reason, p_id);
  return jsonb_build_object('id', p_id, 'code', v_old.code, 'from', v_old.unit_type, 'to', p_new_type, 'reportsWeekly', v_old.reports_weekly,
    'childUnits', v_children, 'employees', v_people, 'weeklyReports', v_reports);
end $$;

-- The general unit update can no longer change the type behind this function's back: a different type needs the Super Admin permission,
-- whether the change comes directly or through an approved BU_REPORTING request. Everything else in the function is unchanged (20261030000004).
create or replace function update_business_unit(
  p_actor uuid, p_id uuid, p_name text, p_status text, p_reports_weekly boolean default true, p_unit_type text default null,
  p_set_hierarchy boolean default false, p_parent_unit_id uuid default null, p_description text default null, p_location text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old business_units;
begin
  perform require_permission(p_actor, 'business_units.manage');
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'VALIDATION_ERROR'; end if;
  if p_unit_type is not null and p_unit_type not in ('BUSINESS_UNIT','DEPARTMENT') then raise exception 'VALIDATION_ERROR' using detail = 'unit type must be BUSINESS_UNIT or DEPARTMENT'; end if;
  select * into v_old from business_units where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_unit_type is not null and p_unit_type <> v_old.unit_type then
    perform require_permission(p_actor, 'business_units.change_type');
  end if;
  if p_set_hierarchy and p_parent_unit_id is not null and not exists (select 1 from business_units where id = p_parent_unit_id) then
    raise exception 'VALIDATION_ERROR' using detail = 'parent unit not found';
  end if;
  update business_units set name = btrim(p_name), status = p_status, reports_weekly = p_reports_weekly,
    unit_type = coalesce(p_unit_type, unit_type),
    parent_unit_id = case when p_set_hierarchy then p_parent_unit_id else parent_unit_id end,
    description    = case when p_set_hierarchy then nullif(btrim(p_description), '') else description end,
    location       = case when p_set_hierarchy then nullif(btrim(p_location), '') else location end,
    updated_at = app_now()
  where id = p_id;
  perform write_audit(p_actor, 'BU_UPDATED', 'business_unit', p_id::text,
    jsonb_build_object('name', v_old.name, 'status', v_old.status, 'reports_weekly', v_old.reports_weekly, 'unit_type', v_old.unit_type,
      'parent_unit_id', v_old.parent_unit_id, 'description', v_old.description, 'location', v_old.location),
    (select jsonb_build_object('name', name, 'status', status, 'reports_weekly', reports_weekly, 'unit_type', unit_type,
      'parent_unit_id', parent_unit_id, 'description', description, 'location', location) from business_units where id = p_id));
end $$;

select lock_down_function_grants();

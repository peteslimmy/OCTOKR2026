-- Phase D: Unit hierarchy - optional parent unit, description and location
alter table business_units add column parent_unit_id uuid references business_units(id) on delete set null;
alter table business_units add column description text;
alter table business_units add column location text;

-- Prevent cycles in the hierarchy (a unit cannot be its own ancestor)
create or replace function check_unit_hierarchy_cycle() returns trigger
language plpgsql as $$
declare v_parent uuid;
begin
  if new.parent_unit_id is not null and new.parent_unit_id = new.id then
    raise exception 'VALIDATION_ERROR' using detail = 'A unit cannot be its own parent';
  end if;

  -- Check for deeper cycles by walking up the parent chain
  v_parent := new.parent_unit_id;
  while v_parent is not null loop
    if v_parent = new.id then
      raise exception 'VALIDATION_ERROR' using detail = 'Cycle detected in unit hierarchy';
    end if;
    select parent_unit_id into v_parent from business_units where id = v_parent;
  end loop;

  return new;
end $$;

create trigger business_units_hierarchy_cycle
  before insert or update on business_units
  for each row execute function check_unit_hierarchy_cycle();

create index business_units_parent_idx on business_units (parent_unit_id);

-- Update the create_business_unit function to accept the new fields
create or replace function create_business_unit(
  p_actor uuid,
  p_code text,
  p_name text,
  p_reports_weekly boolean default true,
  p_unit_type text default null,
  p_parent_unit_id uuid default null,
  p_description text default null,
  p_location text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'business_units.manage');
  if p_unit_type is not null and p_unit_type not in ('BUSINESS_UNIT','DEPARTMENT') then
    raise exception 'VALIDATION_ERROR' using detail = 'unit type must be BUSINESS_UNIT or DEPARTMENT';
  end if;
  if p_parent_unit_id is not null then
    perform 1 from business_units where id = p_parent_unit_id;
    if not found then
      raise exception 'VALIDATION_ERROR' using detail = 'parent unit not found';
    end if;
  end if;
  select id into v_org from organisations limit 1;
  begin
    insert into business_units (organisation_id, code, name, reports_weekly, unit_type, parent_unit_id, description, location)
    values (v_org, upper(btrim(p_code)), btrim(p_name), coalesce(p_reports_weekly, true), p_unit_type, p_parent_unit_id, btrim(p_description), btrim(p_location))
    returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'BU code already exists'; end;
  perform write_audit(p_actor, 'BU_CREATED', 'business_unit', v_id::text, null,
    jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name), 'reportsWeekly', coalesce(p_reports_weekly, true),
      'unitType', (select unit_type from business_units where id = v_id), 'parentUnitId', p_parent_unit_id, 'description', btrim(p_description), 'location', btrim(p_location)));
  return v_id;
end $$;

drop function if exists create_business_unit(uuid, text, text, boolean, text, uuid, text, text);

-- Update update_business_unit function to allow updating hierarchy fields
create or replace function update_business_unit(
  p_actor uuid,
  p_id uuid,
  p_name text default null,
  p_reports_weekly boolean default null,
  p_status text default null,
  p_unit_type text default null,
  p_parent_unit_id uuid default null,
  p_description text default null,
  p_location text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before jsonb; v_after jsonb;
begin
  perform require_permission(p_actor, 'business_units.manage');
  select jsonb_build_object('name', name, 'reports_weekly', reports_weekly, 'status', status, 'unit_type', unit_type, 'parent_unit_id', parent_unit_id, 'description', description, 'location', location)
  into v_before from business_units where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  if p_unit_type is not null and p_unit_type not in ('BUSINESS_UNIT','DEPARTMENT') then
    raise exception 'VALIDATION_ERROR' using detail = 'unit type must be BUSINESS_UNIT or DEPARTMENT';
  end if;
  if p_parent_unit_id is not null then
    if p_parent_unit_id = p_id then raise exception 'VALIDATION_ERROR' using detail = 'A unit cannot be its own parent'; end if;
    perform 1 from business_units where id = p_parent_unit_id;
    if not found then raise exception 'VALIDATION_ERROR' using detail = 'parent unit not found'; end if;
  end if;

  update business_units
  set name = coalesce(btrim(p_name), name),
      reports_weekly = coalesce(p_reports_weekly, reports_weekly),
      status = coalesce(p_status, status),
      unit_type = coalesce(p_unit_type, unit_type),
      parent_unit_id = p_parent_unit_id,
      description = btrim(coalesce(p_description, description)),
      location = btrim(coalesce(p_location, location)),
      updated_at = app_now()
  where id = p_id;

  select jsonb_build_object('name', name, 'reports_weekly', reports_weekly, 'status', status, 'unit_type', unit_type, 'parent_unit_id', parent_unit_id, 'description', description, 'location', location)
  into v_after from business_units where id = p_id;
  perform write_audit(p_actor, 'BU_UPDATED', 'business_unit', p_id::text, v_before, v_after, null, null);
end $$;

drop function if exists update_business_unit(uuid, uuid, text, boolean, text, text, uuid, text, text);

-- Update read_business_units to include hierarchy fields
create or replace function read_business_units() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'code', code, 'name', name, 'status', status, 'reports_weekly', reports_weekly,
    'unit_type', unit_type, 'parent_unit_id', parent_unit_id, 'description', description, 'location', location,
    'created_at', created_at, 'updated_at', updated_at
  ) order by code), '[]'::jsonb)
  from business_units;
$$;

select lock_down_function_grants();
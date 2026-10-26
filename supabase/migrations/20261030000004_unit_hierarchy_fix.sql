-- Repairs 20261030000001_unit_hierarchy.sql, which ended by dropping the new create/update functions it had just created, so the
-- live functions never accepted parent, description or location. The routes already send those fields.

-- creating a unit: parent, description and location are optional (the old five-argument form is replaced; its callers still resolve)
drop function if exists create_business_unit(uuid, text, text, boolean, text);
create or replace function create_business_unit(
  p_actor uuid, p_code text, p_name text, p_reports_weekly boolean default true, p_unit_type text default null,
  p_parent_unit_id uuid default null, p_description text default null, p_location text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'business_units.manage');
  if p_unit_type is not null and p_unit_type not in ('BUSINESS_UNIT','DEPARTMENT') then raise exception 'VALIDATION_ERROR' using detail = 'unit type must be BUSINESS_UNIT or DEPARTMENT'; end if;
  if p_parent_unit_id is not null and not exists (select 1 from business_units where id = p_parent_unit_id) then
    raise exception 'VALIDATION_ERROR' using detail = 'parent unit not found';
  end if;
  select id into v_org from organisations limit 1;
  begin
    insert into business_units (organisation_id, code, name, reports_weekly, unit_type, parent_unit_id, description, location)
    values (v_org, upper(btrim(p_code)), btrim(p_name), coalesce(p_reports_weekly, true), p_unit_type, p_parent_unit_id,
            nullif(btrim(p_description), ''), nullif(btrim(p_location), ''))
    returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'BU code already exists'; end;
  perform write_audit(p_actor, 'BU_CREATED', 'business_unit', v_id::text, null,
    jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name), 'reportsWeekly', coalesce(p_reports_weekly, true),
      'unitType', (select unit_type from business_units where id = v_id), 'parentUnitId', p_parent_unit_id,
      'description', nullif(btrim(p_description), ''), 'location', nullif(btrim(p_location), '')));
  return v_id;
end $$;

-- updating a unit: the hierarchy fields change only when p_set_hierarchy is true (then null clears them), so a caller that does not
-- know about the hierarchy (the unit import, an older approval) never wipes a parent
drop function if exists update_business_unit(uuid, uuid, text, text, boolean);
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

-- an approved BU_REPORTING change now carries the unit type and hierarchy fields it was requested with
do $$
declare v_def text; v_old text := $o$perform update_business_unit(r.requested_by, r.target::uuid, p->>'name', p->>'status', coalesce((p->>'reportsWeekly')::boolean, true));$o$;
        v_new text := $n$perform update_business_unit(r.requested_by, r.target::uuid, p->>'name', p->>'status', coalesce((p->>'reportsWeekly')::boolean, true),
        p->>'unitType', p ? 'parentUnitId', nullif(p->>'parentUnitId', '')::uuid, p->>'description', p->>'location');$n$;
begin
  v_def := pg_get_functiondef('apply_config_change(config_change_requests)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'apply_config_change no longer contains the expected BU_REPORTING call'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

select lock_down_function_grants();

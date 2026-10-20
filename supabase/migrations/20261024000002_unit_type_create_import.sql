-- The unit type (Business Unit or Department) can be chosen when a unit is created, by hand or by the unit import.
create or replace function create_business_unit(p_actor uuid, p_code text, p_name text, p_reports_weekly boolean default true, p_unit_type text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'business_units.manage');
  if p_unit_type is not null and p_unit_type not in ('BUSINESS_UNIT','DEPARTMENT') then raise exception 'VALIDATION_ERROR' using detail = 'unit type must be BUSINESS_UNIT or DEPARTMENT'; end if;
  select id into v_org from organisations limit 1;
  begin
    insert into business_units (organisation_id, code, name, reports_weekly, unit_type) values (v_org, upper(btrim(p_code)), btrim(p_name), coalesce(p_reports_weekly, true), p_unit_type) returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'BU code already exists'; end;
  perform write_audit(p_actor, 'BU_CREATED', 'business_unit', v_id::text, null,
    jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name), 'reportsWeekly', coalesce(p_reports_weekly, true), 'unitType', (select unit_type from business_units where id = v_id)));
  return v_id;
end $$;
drop function if exists create_business_unit(uuid, text, text, boolean);

-- the unit import: an optional "unitType" column (Business Unit / Department; empty means by the reporting flag), applied when a unit is created
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'commit_business_unit_import';
  v_new := replace(v_def, $a$    if v_flag is null then v_errors := v_errors$a$,
$a$    v_type := case when lower(btrim(coalesce(v_row.val->>'unitType', ''))) in ('', 'auto') then null
                   when lower(btrim(v_row.val->>'unitType')) in ('bu', 'business unit', 'businessunit', 'business_unit') then 'BUSINESS_UNIT'
                   when lower(btrim(v_row.val->>'unitType')) in ('department', 'dept') then 'DEPARTMENT' else 'INVALID' end;
    if v_type = 'INVALID' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'unitType', 'code', 'INVALID_TYPE', 'message', 'Use Business Unit or Department (or leave empty).'); end if;
    if v_flag is null then v_errors := v_errors$a$);
  v_new := replace(v_new, $a$'status', v_status, 'flag', v_flag);$a$, $a$'status', v_status, 'flag', v_flag, 'type', v_type);$a$);
  v_new := replace(v_new, $a$v_id := create_business_unit(p_actor, p->>'code', p->>'name');$a$, $a$v_id := create_business_unit(p_actor, p->>'code', p->>'name', coalesce((p->>'flag')::boolean, true), p->>'type');$a$);
  v_new := replace(v_new, $a$declare$a$, $a$declare v_type text;$a$);
  if v_new = v_def or position('v_type' in v_new) = 0 then raise exception 'expected text not found in commit_business_unit_import'; end if;
  execute v_new;
end $$;

select lock_down_function_grants();

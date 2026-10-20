-- Bulk import of Business Units (ADR-056): same guarantees as the employee import (re-validation in the database, one transaction,
-- idempotent per key, recorded and audited), reusing create_business_unit / update_business_unit so every unit gets its own audit entry.

create or replace function commit_business_unit_import(
  p_actor uuid, p_rows jsonb, p_policy text, p_idempotency_key text, p_file_name text, p_file_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ex import_batches; v_row record; v_n int;
  v_errors jsonb := '[]'::jsonb; v_plan jsonb := '[]'::jsonb; v_seen text[] := '{}';
  v_code text; v_name text; v_status text; v_flag_txt text; v_flag boolean;
  v_bu business_units; v_id uuid; v_outcome text; v_detail text;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0; v_skipped int := 0;
  v_lines jsonb := '[]'::jsonb; v_result jsonb; v_batch uuid := gen_random_uuid(); p jsonb;
  v_bad constant text := '^[=+\-@\t\r]';
begin
  perform require_permission(p_actor, 'business_units.manage');
  if p_policy is null or p_policy not in ('ABORT_ON_CONFLICT','SKIP_EXISTING','UPDATE_EXISTING') then raise exception 'VALIDATION_ERROR' using detail = 'unknown conflict policy'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR' using detail = 'file checksum required'; end if;
  if p_file_name is null or length(btrim(p_file_name)) = 0 or length(p_file_name) > 255 then raise exception 'VALIDATION_ERROR' using detail = 'file name required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'VALIDATION_ERROR' using detail = 'rows must be a list'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 or v_n > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'an import holds between 1 and 2000 rows'; end if;

  perform pg_advisory_xact_lock(hashtextextended('business-unit-import:' || p_idempotency_key, 0));
  select * into v_ex from import_batches where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.entity <> 'BUSINESS_UNITS' or v_ex.file_sha256 <> p_file_sha256 or v_ex.actor_user_id <> p_actor or v_ex.policy <> p_policy then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return v_ex.result || jsonb_build_object('replayed', true);
  end if;

  for v_row in select t.value as val, t.ordinality as n from jsonb_array_elements(p_rows) with ordinality as t(value, ordinality) loop
    if jsonb_typeof(v_row.val) <> 'object' then
      v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'row', 'code', 'INVALID_ROW', 'message', 'The row is not a set of fields.');
      continue;
    end if;
    v_code := upper(btrim(coalesce(v_row.val->>'code', '')));
    v_name := btrim(coalesce(v_row.val->>'name', ''));
    v_status := coalesce(nullif(upper(btrim(coalesce(v_row.val->>'status', ''))), ''), 'ACTIVE');
    v_flag_txt := lower(btrim(coalesce(v_row.val->>'reportsWeekly', '')));
    v_flag := case when v_flag_txt in ('', 'yes', 'y', 'true', '1') then true when v_flag_txt in ('no', 'n', 'false', '0') then false else null end;

    if v_code = '' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'code', 'code', 'REQUIRED', 'message', 'Code is required.');
    elsif v_code !~ '^[A-Z0-9][A-Z0-9_-]{1,19}$' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'code', 'code', 'INVALID_CODE', 'message', 'A code is 2 to 20 letters, digits, dashes or underscores.');
    elsif v_code = any(v_seen) then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'code', 'code', 'DUPLICATE_IN_FILE', 'message', 'This code appears more than once in the file.'); end if;
    v_seen := v_seen || v_code;
    if v_name = '' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'name', 'code', 'REQUIRED', 'message', 'Name is required.');
    elsif length(v_name) > 500 or v_name ~ v_bad then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'name', 'code', 'INVALID_TEXT', 'message', 'Name is too long or starts with a formula character (= + - @).'); end if;
    if v_status not in ('ACTIVE','INACTIVE') then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'status', 'code', 'INVALID_STATUS', 'message', 'Status must be Active or Inactive.'); end if;
    if v_flag is null then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'reportsWeekly', 'code', 'INVALID_FLAG', 'message', 'Use Yes or No.'); end if;
    if p_policy = 'ABORT_ON_CONFLICT' and v_code <> '' and exists (select 1 from business_units where upper(code) = v_code) then
      v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'code', 'code', 'CODE_EXISTS', 'message', 'A Business Unit with this code already exists.');
    end if;
    v_plan := v_plan || jsonb_build_object('row', v_row.n, 'code', v_code, 'name', v_name, 'status', v_status, 'flag', v_flag);
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'IMPORT_INVALID' using detail = (select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 50) s)::text;
  end if;

  for p in select value from jsonb_array_elements(v_plan) loop
    select * into v_bu from business_units where upper(code) = p->>'code';
    v_detail := null;
    if not found then
      v_id := create_business_unit(p_actor, p->>'code', p->>'name');
      if p->>'status' = 'INACTIVE' or (p->>'flag')::boolean = false then
        perform update_business_unit(p_actor, v_id, p->>'name', p->>'status', (p->>'flag')::boolean);
      end if;
      v_outcome := 'CREATED'; v_created := v_created + 1;
    elsif p_policy = 'SKIP_EXISTING' then
      v_id := v_bu.id; v_outcome := 'SKIPPED'; v_skipped := v_skipped + 1; v_detail := 'Already exists; left as it was.';
    else
      v_id := v_bu.id;
      if v_bu.name = p->>'name' and v_bu.status = p->>'status' and v_bu.reports_weekly = (p->>'flag')::boolean then
        v_outcome := 'UNCHANGED'; v_unchanged := v_unchanged + 1;
      else
        v_detail := concat_ws(', ',
          case when v_bu.name <> p->>'name' then 'name' end,
          case when v_bu.reports_weekly <> (p->>'flag')::boolean then 'weekly reporting' end,
          case when v_bu.status <> p->>'status' then 'status' end) || ' changed';
        perform update_business_unit(p_actor, v_bu.id, p->>'name', p->>'status', (p->>'flag')::boolean);
        v_outcome := 'UPDATED'; v_updated := v_updated + 1;
      end if;
    end if;
    v_lines := v_lines || jsonb_build_object('row', (p->>'row')::int, 'email', p->>'code', 'outcome', v_outcome, 'businessUnitId', v_id, 'detail', v_detail);
  end loop;

  v_result := jsonb_build_object('batchId', v_batch, 'rowCount', v_n, 'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged,
                                 'skipped', v_skipped, 'policy', p_policy, 'rows', v_lines, 'replayed', false);
  insert into import_batches (id, entity, file_name, file_sha256, idempotency_key, policy, row_count, created_count, updated_count, unchanged_count, skipped_count, result, actor_user_id)
    values (v_batch, 'BUSINESS_UNITS', btrim(p_file_name), p_file_sha256, p_idempotency_key, p_policy, v_n, v_created, v_updated, v_unchanged, v_skipped, v_result, p_actor);
  insert into import_batch_rows (batch_id, row_number, item_key, outcome, business_unit_id, detail)
    select v_batch, (l->>'row')::int, l->>'email', l->>'outcome', nullif(l->>'businessUnitId', '')::uuid, l->>'detail' from jsonb_array_elements(v_lines) l;
  perform write_audit(p_actor, 'BUSINESS_UNIT_IMPORT_COMMITTED', 'import_batch', v_batch::text, null,
    jsonb_build_object('file_name', btrim(p_file_name), 'file_sha256', p_file_sha256, 'policy', p_policy, 'rows', v_n,
                       'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'skipped', v_skipped));
  return v_result;
end $$;

select lock_down_function_grants();

-- history is readable by anyone who may run either import
drop policy read_importers on import_batches;
drop policy read_importers on import_batch_rows;
create policy read_importers on import_batches for select to authenticated using (auth_has_permission('users.manage') or auth_has_permission('business_units.manage'));
create policy read_importers on import_batch_rows for select to authenticated using (auth_has_permission('users.manage') or auth_has_permission('business_units.manage'));

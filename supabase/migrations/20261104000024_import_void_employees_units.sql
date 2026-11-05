-- Import rollback, step 1 (owner decision 4 November 2026, ADR-087): a Super Admin may VOID an employee or Business Unit import inside a rollback window.
-- Nothing is deleted. Rows the import created are deactivated, rows it changed are put back to their before-values, and a permanent void record
-- is written. A void is refused if anything has touched the imported rows since (they are listed), or once the window has closed.
-- Imports made before this migration have no before-values, so a batch that updated rows cannot be voided (a batch that only created rows can).

alter table import_batch_rows add column before jsonb;      -- what an UPDATED row looked like before the import changed it

-- ------------------------------------------------------------------ the commit functions record the before-values
do $$
declare
  v_def text; v_n int; t text;
  v_emp_old constant text := '''employeeId'', v_emp_id, ''detail'', v_detail);';
  v_emp_new constant text := '''employeeId'', v_emp_id, ''detail'', v_detail, ''before'', case when v_outcome = ''UPDATED'' then jsonb_build_object(''first'', v_emp.first_name, ''last'', v_emp.last_name, ''bu'', v_emp.business_unit_id, ''status'', v_emp.employment_status) end);';
  v_bu_old constant text := '''businessUnitId'', v_id, ''detail'', v_detail);';
  v_bu_new constant text := '''businessUnitId'', v_id, ''detail'', v_detail, ''before'', case when v_outcome = ''UPDATED'' then jsonb_build_object(''name'', v_bu.name, ''status'', v_bu.status, ''flag'', v_bu.reports_weekly) end);';
begin
  -- employees
  v_def := pg_get_functiondef('commit_employee_import(uuid,jsonb,text,text,text,text)'::regprocedure);
  foreach t in array array[v_emp_old, 'outcome, employee_id, detail)', 'l->>''detail'' from jsonb_array_elements(v_lines) l;'] loop
    v_n := (length(v_def) - length(replace(v_def, t, ''))) / length(t);
    if v_n <> 1 then raise exception 'commit_employee_import: expected text "%" found % times', t, v_n; end if;
  end loop;
  v_def := replace(v_def, v_emp_old, v_emp_new);
  v_def := replace(v_def, 'outcome, employee_id, detail)', 'outcome, employee_id, detail, before)');
  v_def := replace(v_def, 'l->>''detail'' from jsonb_array_elements(v_lines) l;', 'l->>''detail'', nullif(l->''before'', ''null''::jsonb) from jsonb_array_elements(v_lines) l;');
  execute v_def;
  -- business units
  v_def := pg_get_functiondef('commit_business_unit_import(uuid,jsonb,text,text,text,text)'::regprocedure);
  foreach t in array array[v_bu_old, 'outcome, business_unit_id, detail)', 'l->>''detail'' from jsonb_array_elements(v_lines) l;'] loop
    v_n := (length(v_def) - length(replace(v_def, t, ''))) / length(t);
    if v_n <> 1 then raise exception 'commit_business_unit_import: expected text "%" found % times', t, v_n; end if;
  end loop;
  v_def := replace(v_def, v_bu_old, v_bu_new);
  v_def := replace(v_def, 'outcome, business_unit_id, detail)', 'outcome, business_unit_id, detail, before)');
  v_def := replace(v_def, 'l->>''detail'' from jsonb_array_elements(v_lines) l;', 'l->>''detail'', nullif(l->''before'', ''null''::jsonb) from jsonb_array_elements(v_lines) l;');
  execute v_def;
end $$;

-- ------------------------------------------------------------------ the void record
create table import_voids (
  batch_id      uuid primary key references import_batches(id) on delete restrict,
  voided_by     uuid not null references users(id),
  reason        text not null check (char_length(btrim(reason)) between 10 and 2000),
  voided_at     timestamptz not null default app_now(),
  undone        jsonb not null
);
create trigger import_voids_immutable before update or delete on import_voids for each row execute function forbid_mutation();
alter table import_voids enable row level security;
grant select on import_voids to authenticated;
create policy read_importers on import_voids for select to authenticated
  using ((select auth_has_permission('users.manage')) or (select auth_has_permission('business_units.manage')));

-- the rollback window; one place to change it (an ADR is needed to change it)
create or replace function import_void_window() returns interval language sql immutable as $$ select interval '72 hours' $$;

create or replace function void_import(p_actor uuid, p_batch uuid, p_reason text, p_confirm text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b import_batches; r record; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_blockers jsonb := '[]'::jsonb; v_prev import_voids;
  e employees; u business_units; v_restored int := 0; v_deactivated int := 0; v_undone jsonb;
begin
  if not is_super_admin(p_actor) then raise exception 'PERMISSION_DENIED' using detail = 'only a Super Admin may void an import'; end if;
  if p_confirm is distinct from 'VOID IMPORT' then raise exception 'VALIDATION_ERROR' using detail = 'type VOID IMPORT to confirm'; end if;
  if v_reason is null or char_length(v_reason) < 10 then raise exception 'REASON_REQUIRED' using detail = 'give a reason of at least 10 characters'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('import-void:' || p_batch::text, 0));
  select * into b from import_batches where id = p_batch;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_prev from import_voids where batch_id = p_batch;
  if found then return v_prev.undone || jsonb_build_object('replayed', true); end if;
  if b.entity not in ('EMPLOYEES','BUSINESS_UNITS') then raise exception 'IMPORT_VOID_NOT_AVAILABLE' using detail = 'this kind of import cannot be voided yet'; end if;
  if app_now() > b.committed_at + import_void_window() then
    raise exception 'IMPORT_VOID_WINDOW_CLOSED' using detail = 'the rollback window ended ' || to_char(b.committed_at + import_void_window(), 'YYYY-MM-DD HH24:MI') || '; correct the records the normal way';
  end if;

  -- 1. nothing may have touched the imported rows since, and nothing may depend on rows the import created
  for r in select * from import_batch_rows where batch_id = p_batch and outcome in ('CREATED','UPDATED') order by row_number loop
    if r.outcome = 'UPDATED' and r.before is null then
      raise exception 'IMPORT_VOID_NOT_AVAILABLE' using detail = 'this import changed existing records but was made before before-values were kept';
    end if;
    if b.entity = 'EMPLOYEES' then
      select * into e from employees where id = r.employee_id;
      if e.updated_at > b.committed_at then v_blockers := v_blockers || jsonb_build_object('row', r.row_number, 'item', r.item_key, 'why', 'the person was changed after the import'); continue; end if;
      if r.outcome = 'CREATED' and (exists (select 1 from users where employee_id = e.id) or exists (select 1 from attendance_records where employee_id = e.id)
                                    or exists (select 1 from violations where employee_id = e.id)) then
        v_blockers := v_blockers || jsonb_build_object('row', r.row_number, 'item', r.item_key, 'why', 'the person now has a sign-in, attendance or a violation');
      end if;
    else
      select * into u from business_units where id = r.business_unit_id;
      if u.updated_at > b.committed_at then v_blockers := v_blockers || jsonb_build_object('row', r.row_number, 'item', r.item_key, 'why', 'the unit was changed after the import'); continue; end if;
      if r.outcome = 'CREATED' and (exists (select 1 from employees where business_unit_id = u.id) or exists (select 1 from weekly_reports where business_unit_id = u.id)) then
        v_blockers := v_blockers || jsonb_build_object('row', r.row_number, 'item', r.item_key, 'why', 'the unit now has people or reports');
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'IMPORT_VOID_BLOCKED' using detail = (select jsonb_agg(x) from (select x from jsonb_array_elements(v_blockers) x limit 50) s)::text;
  end if;

  -- 2. undo: changed rows go back to their before-values, created rows are deactivated (never deleted)
  for r in select * from import_batch_rows where batch_id = p_batch and outcome in ('CREATED','UPDATED') order by row_number loop
    if b.entity = 'EMPLOYEES' then
      select * into e from employees where id = r.employee_id;
      if r.outcome = 'UPDATED' then
        perform update_employee(p_actor, e.id, r.before->>'first', r.before->>'last', (r.before->>'bu')::uuid, r.before->>'status'); v_restored := v_restored + 1;
      elsif e.employment_status <> 'INACTIVE' then
        perform update_employee(p_actor, e.id, e.first_name, e.last_name, e.business_unit_id, 'INACTIVE'); v_deactivated := v_deactivated + 1;
      end if;
    else
      select * into u from business_units where id = r.business_unit_id;
      if r.outcome = 'UPDATED' then
        perform update_business_unit(p_actor, u.id, r.before->>'name', r.before->>'status', (r.before->>'flag')::boolean); v_restored := v_restored + 1;
      elsif u.status <> 'INACTIVE' then
        perform update_business_unit(p_actor, u.id, u.name, 'INACTIVE', u.reports_weekly); v_deactivated := v_deactivated + 1;
      end if;
    end if;
  end loop;

  v_undone := jsonb_build_object('batchId', p_batch, 'entity', b.entity, 'restored', v_restored, 'deactivated', v_deactivated, 'replayed', false);
  insert into import_voids (batch_id, voided_by, reason, undone) values (p_batch, p_actor, v_reason, v_undone);
  perform write_audit(p_actor, 'IMPORT_VOIDED', 'import_batch', p_batch::text, jsonb_build_object('entity', b.entity, 'file_name', b.file_name),
    jsonb_build_object('restored', v_restored, 'deactivated', v_deactivated), v_reason, null);
  perform notify_users(users_with_permission('config.approve'), 'IMPORT_VOIDED', 'import_batch', p_batch::text, 'An import was voided',
    'A Super Admin rolled back the import of ' || b.file_name || ' (' || v_restored || ' record(s) restored, ' || v_deactivated || ' deactivated).', 'import-void:' || p_batch);
  return v_undone;
end $$;

-- the list of recent imports, with whether each can still be voided
create or replace function read_import_batches() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'entity', b.entity, 'file_name', b.file_name, 'policy', b.policy, 'row_count', b.row_count, 'created_count', b.created_count,
    'updated_count', b.updated_count, 'unchanged_count', b.unchanged_count, 'skipped_count', b.skipped_count, 'committed_at', b.committed_at,
    'email', (select email from users where id = b.actor_user_id),
    'void_until', b.committed_at + import_void_window(),
    'voided_at', v.voided_at, 'void_reason', v.reason,
    'voidable', (v.batch_id is null and b.entity in ('EMPLOYEES','BUSINESS_UNITS') and app_now() <= b.committed_at + import_void_window())
  ) order by b.committed_at desc), '[]'::jsonb)
  from (select * from import_batches order by committed_at desc limit 20) b left join import_voids v on v.batch_id = b.id;
$$;

select lock_down_function_grants();

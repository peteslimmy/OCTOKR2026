-- Bulk import of employees (ADR-056). The browser parses and previews; THIS function is the authority: it re-validates every row,
-- applies the chosen conflict policy and commits all rows in one transaction, or none. Idempotent per key. Every import is recorded
-- (batch + one line per row) and audited. Only employee records are touched (no login accounts, roles or reports).

create table import_batches (
  id               uuid primary key default gen_random_uuid(),
  entity           text not null check (entity in ('EMPLOYEES','BUSINESS_UNITS')),
  file_name        text not null,
  file_sha256      text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key  text not null unique,
  policy           text not null check (policy in ('ABORT_ON_CONFLICT','SKIP_EXISTING','UPDATE_EXISTING')),
  row_count        int not null,
  created_count    int not null,
  updated_count    int not null,
  unchanged_count  int not null,
  skipped_count    int not null,
  result           jsonb not null,
  actor_user_id    uuid not null references users(id) on delete restrict,
  committed_at     timestamptz not null default app_now()
);
create index import_batches_time_idx on import_batches (committed_at desc);
create index import_batches_hash_idx on import_batches (file_sha256);

create table import_batch_rows (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references import_batches(id) on delete restrict,
  row_number  int not null,
  item_key    text not null,   -- the email (employees) or code (Business Units) of the row
  outcome     text not null check (outcome in ('CREATED','UPDATED','UNCHANGED','SKIPPED')),
  employee_id uuid references employees(id) on delete restrict,
  business_unit_id uuid references business_units(id) on delete restrict,
  detail      text,
  unique (batch_id, row_number)
);

create trigger import_batches_immutable before update or delete on import_batches for each row execute function forbid_mutation();
create trigger import_batch_rows_immutable before update or delete on import_batch_rows for each row execute function forbid_mutation();

alter table import_batches enable row level security;
alter table import_batch_rows enable row level security;
grant select on import_batches, import_batch_rows to authenticated;
create policy read_importers on import_batches for select to authenticated using (auth_has_permission('users.manage'));
create policy read_importers on import_batch_rows for select to authenticated using (auth_has_permission('users.manage'));

create or replace function commit_employee_import(
  p_actor uuid, p_rows jsonb, p_policy text, p_idempotency_key text, p_file_name text, p_file_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ex import_batches; v_row record; v_n int;
  v_errors jsonb := '[]'::jsonb; v_plan jsonb := '[]'::jsonb; v_seen text[] := '{}';
  v_email text; v_first text; v_last text; v_bu_txt text; v_status text; v_bu uuid; v_bu_count int;
  v_emp employees; v_emp_id uuid; v_outcome text; v_detail text;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0; v_skipped int := 0;
  v_lines jsonb := '[]'::jsonb; v_result jsonb; v_batch uuid := gen_random_uuid(); p jsonb;
  v_bad constant text := '^[=+\-@\t\r]';
begin
  perform require_permission(p_actor, 'users.manage');
  if p_policy is null or p_policy not in ('ABORT_ON_CONFLICT','SKIP_EXISTING','UPDATE_EXISTING') then raise exception 'VALIDATION_ERROR' using detail = 'unknown conflict policy'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR' using detail = 'file checksum required'; end if;
  if p_file_name is null or length(btrim(p_file_name)) = 0 or length(p_file_name) > 255 then raise exception 'VALIDATION_ERROR' using detail = 'file name required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'VALIDATION_ERROR' using detail = 'rows must be a list'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 or v_n > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'an import holds between 1 and 2000 rows'; end if;

  -- two identical submissions arriving together are serialised, so the second one sees the first one's batch
  perform pg_advisory_xact_lock(hashtextextended('employee-import:' || p_idempotency_key, 0));
  select * into v_ex from import_batches where idempotency_key = p_idempotency_key;
  if found then
    if v_ex.entity <> 'EMPLOYEES' or v_ex.file_sha256 <> p_file_sha256 or v_ex.actor_user_id <> p_actor or v_ex.policy <> p_policy then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return v_ex.result || jsonb_build_object('replayed', true);
  end if;

  -- pass 1: validate every row, change nothing
  for v_row in select t.value as val, t.ordinality as n from jsonb_array_elements(p_rows) with ordinality as t(value, ordinality) loop
    if jsonb_typeof(v_row.val) <> 'object' then
      v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'row', 'code', 'INVALID_ROW', 'message', 'The row is not a set of fields.');
      continue;
    end if;
    v_email := lower(btrim(coalesce(v_row.val->>'email', '')));
    v_first := btrim(coalesce(v_row.val->>'firstName', ''));
    v_last := btrim(coalesce(v_row.val->>'lastName', ''));
    v_bu_txt := btrim(coalesce(v_row.val->>'businessUnit', ''));
    v_status := coalesce(nullif(upper(btrim(coalesce(v_row.val->>'status', ''))), ''), 'ACTIVE');

    if v_email = '' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'email', 'code', 'REQUIRED', 'message', 'Email is required.');
    elsif length(v_email) > 200 or v_email !~ '^[^@\s,;<>"()]+@[^@\s,;<>"()]+\.[^@\s,;<>"()]+$' or v_email ~ v_bad then
      v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'email', 'code', 'INVALID_EMAIL', 'message', 'This is not a valid email address.');
    elsif v_email = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'email', 'code', 'DUPLICATE_IN_FILE', 'message', 'This email appears more than once in the file.');
    end if;
    v_seen := v_seen || v_email;

    if v_first = '' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'firstName', 'code', 'REQUIRED', 'message', 'First name is required.');
    elsif length(v_first) > 500 or v_first ~ v_bad then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'firstName', 'code', 'INVALID_TEXT', 'message', 'First name is too long or starts with a formula character (= + - @).'); end if;
    if v_last = '' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'lastName', 'code', 'REQUIRED', 'message', 'Last name is required.');
    elsif length(v_last) > 500 or v_last ~ v_bad then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'lastName', 'code', 'INVALID_TEXT', 'message', 'Last name is too long or starts with a formula character (= + - @).'); end if;

    if v_status not in ('ACTIVE','INACTIVE') then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'status', 'code', 'INVALID_STATUS', 'message', 'Status must be Active or Inactive.'); end if;

    v_bu := null;
    if v_bu_txt = '' then v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'businessUnit', 'code', 'REQUIRED', 'message', 'Business Unit is required.');
    else
      select count(*), min(id::text)::uuid into v_bu_count, v_bu from business_units
        where status = 'ACTIVE' and (upper(code) = upper(v_bu_txt) or lower(name) = lower(v_bu_txt));
      if v_bu_count = 0 then v_bu := null; v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'businessUnit', 'code', 'UNKNOWN_BU', 'message', 'No active Business Unit has this code or name.');
      elsif v_bu_count > 1 then v_bu := null; v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'businessUnit', 'code', 'AMBIGUOUS_BU', 'message', 'More than one Business Unit matches. Use its code.'); end if;
    end if;

    if p_policy = 'ABORT_ON_CONFLICT' and v_email <> '' and exists (select 1 from employees where email = v_email::extensions.citext) then
      v_errors := v_errors || jsonb_build_object('row', v_row.n, 'field', 'email', 'code', 'EMAIL_EXISTS', 'message', 'An employee with this email already exists.');
    end if;
    v_plan := v_plan || jsonb_build_object('row', v_row.n, 'email', v_email, 'first', v_first, 'last', v_last, 'bu', v_bu, 'status', v_status);
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'IMPORT_INVALID' using detail = (select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 50) s)::text;
  end if;

  -- pass 2: apply, all inside this transaction
  for p in select value from jsonb_array_elements(v_plan) loop
    select * into v_emp from employees where email = (p->>'email')::extensions.citext;
    v_detail := null;
    if not found then
      v_emp_id := create_employee(p_actor, p->>'email', p->>'first', p->>'last', (p->>'bu')::uuid);
      if p->>'status' = 'INACTIVE' then perform update_employee(p_actor, v_emp_id, p->>'first', p->>'last', (p->>'bu')::uuid, 'INACTIVE'); end if;
      v_outcome := 'CREATED'; v_created := v_created + 1;
    elsif p_policy = 'SKIP_EXISTING' then
      v_emp_id := v_emp.id; v_outcome := 'SKIPPED'; v_skipped := v_skipped + 1; v_detail := 'Already exists; left as it was.';
    else
      v_emp_id := v_emp.id;
      if v_emp.first_name = p->>'first' and v_emp.last_name = p->>'last' and v_emp.business_unit_id = (p->>'bu')::uuid and v_emp.employment_status = p->>'status' then
        v_outcome := 'UNCHANGED'; v_unchanged := v_unchanged + 1;
      else
        v_detail := concat_ws(', ',
          case when v_emp.first_name <> p->>'first' or v_emp.last_name <> p->>'last' then 'name' end,
          case when v_emp.business_unit_id <> (p->>'bu')::uuid then 'business unit' end,
          case when v_emp.employment_status <> p->>'status' then 'status' end) || ' changed';
        perform update_employee(p_actor, v_emp.id, p->>'first', p->>'last', (p->>'bu')::uuid, p->>'status');
        v_outcome := 'UPDATED'; v_updated := v_updated + 1;
      end if;
    end if;
    v_lines := v_lines || jsonb_build_object('row', (p->>'row')::int, 'email', p->>'email', 'outcome', v_outcome, 'employeeId', v_emp_id, 'detail', v_detail);
  end loop;

  v_result := jsonb_build_object('batchId', v_batch, 'rowCount', v_n, 'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged,
                                 'skipped', v_skipped, 'policy', p_policy, 'rows', v_lines, 'replayed', false);
  insert into import_batches (id, entity, file_name, file_sha256, idempotency_key, policy, row_count, created_count, updated_count, unchanged_count, skipped_count, result, actor_user_id)
    values (v_batch, 'EMPLOYEES', btrim(p_file_name), p_file_sha256, p_idempotency_key, p_policy, v_n, v_created, v_updated, v_unchanged, v_skipped, v_result, p_actor);
  insert into import_batch_rows (batch_id, row_number, item_key, outcome, employee_id, detail)
    select v_batch, (l->>'row')::int, l->>'email', l->>'outcome', nullif(l->>'employeeId', '')::uuid, l->>'detail' from jsonb_array_elements(v_lines) l;
  perform write_audit(p_actor, 'EMPLOYEE_IMPORT_COMMITTED', 'import_batch', v_batch::text, null,
    jsonb_build_object('file_name', btrim(p_file_name), 'file_sha256', p_file_sha256, 'policy', p_policy, 'rows', v_n,
                       'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'skipped', v_skipped));
  return v_result;
end $$;

select lock_down_function_grants();

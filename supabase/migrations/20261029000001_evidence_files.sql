-- Milestone 2c: evidence files storage for violations, ledger entries, reports, sessions
-- Uses Supabase Storage (bucket: evidence) + DB tracking table
-- All mutations via SECURITY DEFINER functions (service_role only)

-- ---------------------------------------------------------------- evidence_files table
create table evidence_files (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null check (entity_type in ('VIOLATION','LEDGER','REPORT','SESSION')),
  entity_id       uuid not null,
  file_path       text not null,                              -- path in Supabase Storage bucket 'evidence'
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  checksum        text not null,                              -- sha256 hex
  uploaded_by     uuid not null references users(id) on delete restrict,
  uploaded_at     timestamptz not null default app_now(),
  deleted_at      timestamptz,
  deleted_by      uuid references users(id) on delete restrict
);
create index evidence_files_entity_idx on evidence_files (entity_type, entity_id);
create index evidence_files_uploaded_idx on evidence_files (uploaded_at desc);

-- Make the table immutable (no direct UPDATE/DELETE by clients)
create trigger evidence_files_immutable before update or delete on evidence_files
  for each row execute function forbid_mutation();

-- ---------------------------------------------------------------- RLS
alter table evidence_files enable row level security;
grant select on evidence_files to authenticated;

-- SELECT: authenticated users can see evidence for entities they have access to
-- Uses existing BU-scoped helpers and permission checks
create policy read_evidence on evidence_files
  for select to authenticated
  using (
    -- VIOLATION: user has violation.create/edit/payment.record OR finance.ledger.view
    (entity_type = 'VIOLATION' and auth_has_any(array['violation.create','violation.edit','violation.payment.record','finance.ledger.view']))
    -- LEDGER: user has finance.ledger.view
    or (entity_type = 'LEDGER' and auth_has_permission('finance.ledger.view'))
    -- REPORT: user has reports.view
    or (entity_type = 'REPORT' and auth_has_permission('reports.view'))
    -- SESSION: user has attendance.session.manage OR attendance.record OR attendance.amendment.view
    or (entity_type = 'SESSION' and auth_has_any(array['attendance.session.manage','attendance.record','attendance.amendment.view']))
  );

-- ---------------------------------------------------------------- permission: evidence.manage
insert into permissions (code, description)
values ('evidence.manage', 'Upload and manage evidence files')
on conflict (code) do nothing;

-- Grant evidence.manage to roles that need it
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.code in ('SUPER_ADMIN','ADMIN','HR','FINANCE') and p.code = 'evidence.manage'
on conflict do nothing;

-- ---------------------------------------------------------------- Supabase Storage bucket
-- Create the 'evidence' bucket if not exists
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence', 'evidence', false,
  52428800,  -- 50 MiB
  array['application/pdf','image/jpeg','image/png','image/gif','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain']
)
on conflict (id) do nothing;

-- Storage RLS: authenticated users can read files they have DB access to
-- Write is only via service_role (ops_upsert_evidence_file), so no INSERT policy needed for authenticated
create policy evidence_bucket_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence' and
    exists (
      select 1 from evidence_files ef
      where ef.file_path = storage.objects.name
        and (
          (ef.entity_type = 'VIOLATION' and (SELECT auth_has_any(array['violation.create','violation.edit','violation.payment.record','finance.ledger.view'])))
          or (ef.entity_type = 'LEDGER' and (SELECT auth_has_permission('finance.ledger.view')))
          or (ef.entity_type = 'REPORT' and (SELECT auth_has_permission('reports.view')))
          or (ef.entity_type = 'SESSION' and (SELECT auth_has_any(array['attendance.session.manage','attendance.record','attendance.amendment.view'])))
        )
        and ef.deleted_at is null
    )
  );

-- The main RLS policy also needs sub-selects for performance
-- Drop and recreate with sub-selects
drop policy if exists read_evidence on evidence_files;
create policy read_evidence on evidence_files
  for select to authenticated
  using (
    (entity_type = 'VIOLATION' and (SELECT auth_has_any(array['violation.create','violation.edit','violation.payment.record','finance.ledger.view'])))
    or (entity_type = 'LEDGER' and (SELECT auth_has_permission('finance.ledger.view')))
    or (entity_type = 'REPORT' and (SELECT auth_has_permission('reports.view')))
    or (entity_type = 'SESSION' and (SELECT auth_has_any(array['attendance.session.manage','attendance.record','attendance.amendment.view'])))
  );

-- ---------------------------------------------------------------- ops_upsert_evidence_file (service_role only)
create or replace function ops_upsert_evidence_file(
  p_actor        uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_file_path    text,
  p_file_name    text,
  p_mime_type    text,
  p_size_bytes   bigint,
  p_checksum     text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_bu uuid;
begin
  perform require_permission(p_actor, 'evidence.manage');
  if p_entity_type not in ('VIOLATION','LEDGER','REPORT','SESSION') then
    raise exception 'VALIDATION_ERROR' using detail = 'invalid entity_type';
  end if;
  if p_file_path is null or btrim(p_file_path) = '' then
    raise exception 'VALIDATION_ERROR' using detail = 'file_path required';
  end if;
  if p_file_name is null or btrim(p_file_name) = '' then
    raise exception 'VALIDATION_ERROR' using detail = 'file_name required';
  end if;
  if p_mime_type is null or btrim(p_mime_type) = '' then
    raise exception 'VALIDATION_ERROR' using detail = 'mime_type required';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'VALIDATION_ERROR' using detail = 'size_bytes must be positive';
  end if;
  if p_checksum is null or btrim(p_checksum) = '' then
    raise exception 'VALIDATION_ERROR' using detail = 'checksum required';
  end if;

  -- Verify entity exists and get its business_unit_id for audit
  if p_entity_type = 'VIOLATION' then
    select business_unit_id into v_bu from violations where id = p_entity_id;
    if not found then raise exception 'NOT_FOUND' using detail = 'violation not found'; end if;
  elsif p_entity_type = 'LEDGER' then
    select fund_id into v_bu from financial_ledger_entries where id = p_entity_id;
    if not found then raise exception 'NOT_FOUND' using detail = 'ledger entry not found'; end if;
    -- fund_id is not a BU, use org_id; just use null for audit BU
    v_bu := null;
  elsif p_entity_type = 'REPORT' then
    select business_unit_id into v_bu from weekly_reports where id = p_entity_id;
    if not found then raise exception 'NOT_FOUND' using detail = 'report not found'; end if;
  elsif p_entity_type = 'SESSION' then
    -- governance_sessions don't have a direct BU; use null for audit
    select 1 from governance_sessions where id = p_entity_id;
    if not found then raise exception 'NOT_FOUND' using detail = 'session not found'; end if;
    v_bu := null;
  end if;

  insert into evidence_files (entity_type, entity_id, file_path, file_name, mime_type, size_bytes, checksum, uploaded_by)
  values (p_entity_type, p_entity_id, btrim(p_file_path), btrim(p_file_name), btrim(p_mime_type), p_size_bytes, btrim(p_checksum), p_actor)
  returning id into v_id;

  perform write_audit(p_actor, 'EVIDENCE_UPLOADED', 'evidence_file', v_id::text, null,
    jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'file_name', btrim(p_file_name), 'size_bytes', p_size_bytes, 'checksum', btrim(p_checksum)), null, v_bu);

  return v_id;
end $$;

-- ---------------------------------------------------------------- ops_delete_evidence_file (service_role only)
create or replace function ops_delete_evidence_file(
  p_actor uuid,
  p_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v evidence_files;
begin
  perform require_permission(p_actor, 'evidence.manage');
  select * into v from evidence_files where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.deleted_at is not null then raise exception 'ALREADY_DELETED'; end if;

  update evidence_files set deleted_at = app_now(), deleted_by = p_actor where id = p_id;

  perform write_audit(p_actor, 'EVIDENCE_DELETED', 'evidence_file', p_id::text,
    jsonb_build_object('file_name', v.file_name, 'entity_type', v.entity_type, 'entity_id', v.entity_id),
    jsonb_build_object('deleted_at', app_now()), null, null);
end $$;

-- ---------------------------------------------------------------- read_evidence_files (security invoker, RLS enforced)
create or replace function read_evidence_files(
  p_entity_type text,
  p_entity_id uuid
) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'entity_type', entity_type, 'entity_id', entity_id,
    'file_path', file_path, 'file_name', file_name, 'mime_type', mime_type,
    'size_bytes', size_bytes, 'checksum', checksum,
    'uploaded_by', uploaded_by, 'uploaded_at', uploaded_at
  ) order by uploaded_at desc), '[]'::jsonb)
  from evidence_files
  where entity_type = p_entity_type and entity_id = p_entity_id and deleted_at is null;
$$;

select lock_down_function_grants();
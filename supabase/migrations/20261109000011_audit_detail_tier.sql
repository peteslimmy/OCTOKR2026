-- The audit log has two tiers (ADR-121).
--   Summary (audit.read: Admin and Super Admin): what happened, who (name, role, unit), when, the outcome, severity, category and the stated reason.
--   Detail  (audit.read_detail: Super Admin only): also the network address, location, device, browser, session and request ids, the raw old and new values, and the integrity chain.
-- Enforced in the database with column privileges, so a signed-in person cannot read the detail columns even by calling the API of the database directly.
-- Location is recorded inside the entry's `metadata` (which is part of the tamper-evident hash), from the request's geo headers when the server trusts them.

-- ---------------------------------------------------------------- the permission
insert into permissions (code, description, protected, reserved, module, risk) values
  ('audit.read_detail', 'Read the full technical detail of audit entries: network address, location, device, session and request ids, raw old and new values, and the integrity chain', true, false, 'Audit & security', 'critical')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p where r.code = 'SUPER_ADMIN' and p.code = 'audit.read_detail'
on conflict do nothing;

-- ---------------------------------------------------------------- who may see the detail: a holder of the permission who is a Super Admin (never shielded, see ADR-118)
create or replace function audit_can_see_detail(p_viewer uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_viewer is not null and actor_has_permission(p_viewer, 'audit.read_detail') and is_super_admin(p_viewer);
$$;

-- ---------------------------------------------------------------- column access: signed-in people may read only the summary columns of the log
revoke select on audit_logs from authenticated;
grant select (id, seq, occurred_at, actor_user_id, actor_role, business_unit_id, action, entity_type, entity_id, reason, outcome,
              event_category, severity, channel, actor_name, actor_bu_id, actor_bu_name, actor_scope)
  on audit_logs to authenticated;

-- ---------------------------------------------------------------- location: kept in the entry's metadata, written by the one trigger that completes every row
do $$
declare v_def text;
  a text := 'new.session_ref := coalesce(new.session_ref, left(h->>''x-audit-session'', 64));';
begin
  v_def := pg_get_functiondef('audit_logs_enrich()'::regprocedure);
  if position('x-audit-geo-country' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'audit_logs_enrich changed'; end if;
  execute replace(v_def, a, a || ' '
    || 'if h->>''x-audit-geo-country'' is not null or h->>''x-audit-geo-city'' is not null then '
    || 'new.metadata := coalesce(new.metadata, ''{}''::jsonb) || jsonb_build_object(''geo'', jsonb_strip_nulls(jsonb_build_object('
    || '''country'', left(h->>''x-audit-geo-country'', 8), ''region'', left(h->>''x-audit-geo-region'', 80), ''city'', left(h->>''x-audit-geo-city'', 120), ''trusted'', true))); end if;');
end $$;

-- ---------------------------------------------------------------- the event trace: a summary viewer gets the summary of the event only (no chain, no address, no raw values)
do $$
declare v_def text;
  a1 text := '''event'', to_jsonb(e) - ''prev_hash'' - ''row_hash'',';
  a2 text := '''chain'', jsonb_build_object(''chain_seq'', e.chain_seq, ''prev_hash'', e.prev_hash, ''row_hash'', e.row_hash, ''valid'', case when e.chain_seq is null then null else e.row_hash = audit_row_hash(e) end),';
begin
  v_def := pg_get_functiondef('audit_centre_trace(uuid,uuid)'::regprocedure);
  if position('audit_can_see_detail' in v_def) > 0 then return; end if;
  if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 then raise exception 'audit_centre_trace changed'; end if;
  v_def := replace(v_def, a1, '''event'', case when audit_can_see_detail(p_actor) then to_jsonb(e) - ''prev_hash'' - ''row_hash'' else to_jsonb(e) - array[''old_values'',''new_values'',''correlation_id'',''ip_address'',''user_agent'',''ip_trusted'',''browser'',''os'',''device'',''request_id'',''workflow_id'',''related_approval_id'',''session_ref'',''metadata'',''chain_seq'',''prev_hash'',''row_hash'',''actor_email''] end,');
  v_def := replace(v_def, a2, '''chain'', case when audit_can_see_detail(p_actor) then jsonb_build_object(''chain_seq'', e.chain_seq, ''prev_hash'', e.prev_hash, ''row_hash'', e.row_hash, ''valid'', case when e.chain_seq is null then null else e.row_hash = audit_row_hash(e) end) else null end,');
  execute v_def;
end $$;

select lock_down_function_grants();

-- ---------------------------------------------------------------- a gap found by the coverage check: changing a person's attendance status left no audit entry
do $$
declare v_def text;
  a text := 'update attendance_records set status = p_status, notes = nullif(btrim(p_notes), ''''), updated_at = app_now() where id = p_record_id;';
begin
  v_def := pg_get_functiondef('set_attendance_status(uuid,uuid,text,text)'::regprocedure);
  if position('ATTENDANCE_STATUS_SET' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'set_attendance_status changed'; end if;
  execute replace(v_def, a, a || ' perform write_audit(p_actor, ''ATTENDANCE_STATUS_SET'', ''attendance_record'', p_record_id::text, jsonb_build_object(''status'', rec.status, ''notes'', rec.notes), jsonb_build_object(''status'', p_status, ''notes'', nullif(btrim(p_notes), '''')), null, null);');
end $$;

select lock_down_function_grants();

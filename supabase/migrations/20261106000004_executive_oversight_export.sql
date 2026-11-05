-- Executive Oversight: an export is a governed act. Who exported what, with which filters and how many rows, is written to the audit log.
create or replace function record_eo_export(p_actor uuid, p_kind text, p_format text, p_params jsonb, p_rows int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'executive_oversight.export');
  perform write_audit(p_actor, 'EXEC_OVERSIGHT_EXPORTED', 'eo_export', p_kind, null, jsonb_build_object('format', p_format, 'rows', p_rows, 'params', p_params));
end $$;

select lock_down_function_grants();

-- A change a Super Admin applies directly is decided by its own requester, which the table allows only when the request is flagged `emergency`.
-- Flag it, so the record shows plainly that no second person approved it.
do $$
declare v_def text; v_old text := 'update config_change_requests set status = ''APPLIED'', decided_by = p_actor, decided_at = app_now(), decision_comment = ''Applied directly by the Super Admin''';
begin
  v_def := pg_get_functiondef('request_config_change(uuid,text,text,jsonb,text,text)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'request_config_change no longer contains the expected line'; end if;
  execute replace(v_def, v_old, v_old || ', emergency = true');
end $$;
select lock_down_function_grants();

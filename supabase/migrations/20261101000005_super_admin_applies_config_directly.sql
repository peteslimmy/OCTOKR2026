-- A Super Admin's configuration change is applied at once instead of waiting for a second approver (owner decision, ADR-085).
-- It still goes through the same request row, the setting's own validation, the audit trail and the same notifications for others.
do $$
declare v_def text; v_old text := 'perform notify_users(array_remove(users_with_permission(case when v_protected';
begin
  v_def := pg_get_functiondef('request_config_change(uuid,text,text,jsonb,text,text)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'request_config_change no longer contains the expected line'; end if;
  execute replace(v_def, v_old, $blk$if exists (select 1 from user_roles ur join roles ro on ro.id = ur.role_id where ur.user_id = p_actor and ro.code = 'SUPER_ADMIN') then
    select * into r from config_change_requests where id = v_id;
    perform apply_config_change(r);
    update config_change_requests set status = 'APPLIED', decided_by = p_actor, decided_at = app_now(), decision_comment = 'Applied directly by the Super Admin' where id = v_id;
    perform write_audit(p_actor, 'CONFIG_CHANGE_APPLIED', 'config_change_request', v_id::text, jsonb_build_object('status', 'PENDING', 'value', r.current_value),
      jsonb_build_object('status', 'APPLIED', 'topic', p_topic, 'proposed', p_proposed, 'direct_by_super_admin', true), btrim(p_reason));
    return jsonb_build_object('replayed', false, 'request_id', v_id, 'status', 'APPLIED', 'protected', v_protected);
  end if;
  $blk$ || v_old);
end $$;
select lock_down_function_grants();

-- ADR-131 follow-up: read_config_changes (which runs as the signed-in person) calls redact_hidden_ids, so that function must stay executable by
-- signed-in people. Every migration that ends with lock_down_function_grants() resets execute rights to an allow-list, which silently took the grant away
-- again and made the configuration-change list fail for everyone. The function is now on the allow-list itself.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('lock_down_function_grants'::regproc);
  if v_def like '%''redact_hidden_ids''%' then return; end if;
  v_new := replace(v_def, '''person_name'',', '''person_name'',''redact_hidden_ids'',');
  if v_new = v_def then raise exception 'lock_down_function_grants: the allow-list entry person_name was not found'; end if;
  execute v_new;
end $$;
select lock_down_function_grants();

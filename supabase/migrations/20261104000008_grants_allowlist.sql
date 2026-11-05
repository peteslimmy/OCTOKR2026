-- Two helpers must stay callable by signed-in people: my_domain_allowed() (the app asks it on every request whether the person's email domain is approved)
-- and person_name() (called by the read_* functions as the caller). lock_down_function_grants() withdrew both whenever it ran, so they are added to its list.
do $$
declare v_def text; a text := '''auth_has_any'',''attendance_effective_status''';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  execute replace(v_def, a, '''my_domain_allowed'',''person_name'',' || a);
end $$;
select lock_down_function_grants();

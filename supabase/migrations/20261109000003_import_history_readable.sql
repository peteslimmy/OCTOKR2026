-- The "Recent imports" list on the import screens was always empty: read_import_batches runs as the signed-in person (security invoker)
-- and calls import_void_window(), which the grant lock-down had not made executable for signed-in users, so the call was refused.
-- import_void_window() only returns the fixed 72-hour rollback window, so it is safe to expose.
-- lock_down_function_grants() keeps its allowlist inside its own definition and earlier migrations have each added names to it, so this one
-- adds its name to the definition as it stands (the same way they did) instead of restating the whole function.
do $$
declare v_def text; a text := '''auth_has_any'',''attendance_effective_status''';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position('''import_void_window''' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  execute replace(v_def, a, '''import_void_window'',' || a);
end $$;
select lock_down_function_grants();

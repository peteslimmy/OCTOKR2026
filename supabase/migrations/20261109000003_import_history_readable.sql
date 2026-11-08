-- The "Recent imports" list on the import screens was always empty: read_import_batches runs as the signed-in person (security invoker)
-- and calls import_void_window(), which the grant lock-down had not made executable for signed-in users, so the call was refused.
-- import_void_window() only returns the fixed 72-hour rollback window, so it is safe to expose. The lock-down function is restated here
-- with that one name added (and keeping my_domain_allowed and person_name, added by 20261104000008) so later migrations that call it keep the grant.
create or replace function lock_down_function_grants() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'lock_down_function_grants' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.proname in ('auth_has_permission','auth_bu','app_now','report_phase','quarter_is_locked','auth_can_view_bu',
                     'goal_is_done','report_goal_counts','calc_base_score','calc_final_score','active_penalty_rate',
                     'auth_has_any','my_domain_allowed','person_name','attendance_effective_status','fund_balance','fund_committed','report_phase_of','auth_aal_satisfied',
                     'import_void_window')
       or r.proname like 'read\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

select lock_down_function_grants();

-- Row-level security: SELECT-only for authenticated users; every mutation goes through service-only RPCs (ADR-035).

create or replace function auth_can_view_bu(p_bu uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth_has_permission('weekly_report.view_all')
      or (auth_has_permission('weekly_report.view_own_bu') and p_bu is not distinct from auth_bu());
$$;

-- default privileges: nothing for anon/authenticated on future objects
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t.tablename);
    execute format('grant select on %I to authenticated', t.tablename);
  end loop;
end $$;

-- reference / strategy data: readable by any authenticated user
create policy read_all on organisations          for select to authenticated using (true);
create policy read_all on business_units         for select to authenticated using (true);
create policy read_all on annual_themes          for select to authenticated using (true);
create policy read_all on annual_theme_changes   for select to authenticated using (true);
create policy read_all on quarters               for select to authenticated using (true);
create policy read_all on quarterly_objectives   for select to authenticated using (true);
create policy read_all on key_results            for select to authenticated using (true);
create policy read_all on sub_key_results        for select to authenticated using (true);
create policy read_all on reporting_weeks        for select to authenticated using (true);
create policy read_all on reporting_week_state_events for select to authenticated using (true);
create policy read_all on governance_sessions    for select to authenticated using (true);
create policy read_all on roles                  for select to authenticated using (true);
create policy read_all on permissions            for select to authenticated using (true);
create policy read_all on role_permissions       for select to authenticated using (true);

-- people
create policy read_scoped on employees for select to authenticated using (
  business_unit_id = auth_bu() or auth_has_permission('users.manage') or auth_has_permission('attendance.record')
  or auth_has_permission('attendance.session.manage') or auth_has_permission('weekly_report.view_all'));
create policy read_scoped on users for select to authenticated using (id = auth.uid() or auth_has_permission('users.manage'));
create policy read_scoped on user_roles for select to authenticated using (user_id = auth.uid() or auth_has_permission('users.manage'));

-- BU-scoped operational data (SEC-RLS-001..005)
create policy read_bu on weekly_reports          for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_bu on smart_goals             for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_bu on tasks                   for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_bu on weekly_score_snapshots  for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_bu on weekly_compliance       for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_bu on integrity_corrections   for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_bu on quarterly_score_snapshots for select to authenticated using (auth_can_view_bu(business_unit_id));
create policy read_via_goal on smart_evaluations for select to authenticated using (
  exists (select 1 from smart_goals g where g.id = smart_goal_id and auth_can_view_bu(g.business_unit_id)));
create policy read_via_task on task_status_history for select to authenticated using (
  exists (select 1 from tasks t where t.id = task_id and auth_can_view_bu(t.business_unit_id)));
create policy read_via_report on report_edit_sessions for select to authenticated using (
  exists (select 1 from weekly_reports r where r.id = weekly_report_id and auth_can_view_bu(r.business_unit_id)));

create policy read_config on integrity_penalty_configurations for select to authenticated using (
  auth_has_permission('integrity_penalty.configure') or auth_has_permission('integrity_correction.create'));
create policy read_audit on audit_logs for select to authenticated using (auth_has_permission('audit.read'));
create policy read_own on notifications for select to authenticated using (user_id = auth.uid());

-- notifications may be marked read by their owner only (no other column is writable)
grant update (read_at) on notifications to authenticated;
create policy mark_read on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

select lock_down_function_grants();

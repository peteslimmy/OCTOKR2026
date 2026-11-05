-- The question is asked once per query, not once per row.
drop policy read_executive on insight_actions;
create policy read_executive on insight_actions for select to authenticated using ((select auth_has_permission('dashboard.executive.view')));

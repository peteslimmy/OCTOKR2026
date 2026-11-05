-- A policy that calls a function for every row is slow on big tables. The unit goals policy now asks the question once per query,
-- as the other unit-scoped policies do: you may read all units' goals, or your own unit's.
drop policy read_scoped on bu_goals;
create policy read_scoped on bu_goals for select to authenticated
  using ((select auth_has_permission('weekly_report.view_all')) or (select auth_has_permission('weekly_report.view_own_bu')) and business_unit_id is not distinct from (select auth_bu()));

-- Row-level security that is cheap to evaluate (performance baseline finding, ADR-066).
-- A policy that calls auth_has_permission(...), auth_has_any(...), auth_bu(), auth_can_view_bu(...) or auth.uid() as a bare function is
-- evaluated for EVERY ROW it filters, and each call runs queries of its own. The report read models scan thousands of rows, so a function
-- that takes 5 ms when run as the database owner took 600 ms for a signed-in person. The cure is the standard one: write the call as a
-- sub-select, which PostgreSQL evaluates once per statement (an "InitPlan") instead of once per row. Nothing about WHO may see WHAT changes:
-- the same functions are called with the same arguments, only less often. The role-by-role DB tests prove the visibility rules are
-- unchanged, and tests/db/rls_cost.test.ts guards against the per-row pattern coming back.
--
-- auth_can_view_bu(x) is written out in full (it cannot be a sub-select because it depends on the row). It must stay equal to the function:
--   auth_has_permission('weekly_report.view_all') or (auth_has_permission('weekly_report.view_own_bu') and x is not distinct from auth_bu())

create or replace function rls_initplan(src text) returns text
language sql immutable set search_path = public, pg_temp as $$
  -- the text of a policy shows auth.uid() as uid() or as auth.uid() depending on the search path of whoever reads it: treat both the same
  select regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
           src,
           'auth\.uid\(\)', 'uid()', 'g'),
           '(?<!SELECT )auth_can_view_bu\(([A-Za-z_\.]+)\)',
           '((SELECT auth_has_permission(''weekly_report.view_all''::text)) OR ((SELECT auth_has_permission(''weekly_report.view_own_bu''::text)) AND (\1 IS NOT DISTINCT FROM (SELECT auth_bu()))))', 'g'),
           '(?<!SELECT )auth_has_any\((ARRAY\[[^\]]*\])\)', '(SELECT auth_has_any(\1))', 'g'),
           '(?<!SELECT )auth_has_permission\((''[^'']*''(::text)?)\)', '(SELECT auth_has_permission(\1))', 'g'),
           '(?<!SELECT )auth_bu\(\)', '(SELECT auth_bu())', 'g'),
           '(?<!SELECT )uid\(\)', '(SELECT auth.uid())', 'g');
$$;

do $$
declare p record; v_q text; v_c text; v_sql text; n int := 0;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    v_q := p.qual; v_c := p.with_check;
    -- already written as sub-selects (or not using these functions at all): leave alone, so this migration is safe to re-run
    if coalesce(v_q, '') !~ 'auth_|uid\(\)' and coalesce(v_c, '') !~ 'auth_|uid\(\)' then continue; end if;
    if coalesce(v_q, '') ~ 'SELECT (auth_|auth\.uid|uid)' or coalesce(v_c, '') ~ 'SELECT (auth_|auth\.uid|uid)' then continue; end if;
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_q is not null then v_sql := v_sql || format(' using (%s)', rls_initplan(v_q)); end if;
    if v_c is not null then v_sql := v_sql || format(' with check (%s)', rls_initplan(v_c)); end if;
    execute v_sql;
    n := n + 1;
  end loop;
  raise notice 'row-level security policies rewritten to evaluate permission checks once per statement: %', n;
end $$;

-- kept (not dropped): the cost test uses it to prove no policy still calls these functions per row
revoke all on function rls_initplan(text) from public, anon, authenticated;
select lock_down_function_grants();

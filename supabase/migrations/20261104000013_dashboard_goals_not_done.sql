-- The dashboard said "not done" for every goal that was not done yet, including goals whose tasks have not been marked at all. A goal is now counted as not done only when at
-- least one of its tasks is Not done (it can no longer be completed); the rest of the goals that are not done are still open.
do $$
declare v_def text; a1 text := 'count(*) filter (where goal_is_done(g.id))::int as done'; a2 text := 'coalesce(gl.total, 0) as goals_total, coalesce(gl.done, 0) as goals_done,';
begin
  v_def := pg_get_functiondef('read_dashboard_cells(uuid)'::regprocedure);
  if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 then raise exception 'read_dashboard_cells changed'; end if;
  v_def := replace(v_def, a1, a1 || ', count(*) filter (where exists (select 1 from tasks t2 where t2.smart_goal_id = g.id and t2.deleted_at is null and t2.status = ''NOT_DONE''))::int as not_done');
  v_def := replace(v_def, a2, a2 || ' coalesce(gl.not_done, 0) as goals_not_done,');
  execute v_def;
end $$;
select lock_down_function_grants();

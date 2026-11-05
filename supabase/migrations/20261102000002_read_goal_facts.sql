-- One row per weekly goal of a quarter, with what the intelligence view needs: the week, whether it was submitted, which unit goal and Sub-KR it supports,
-- whether it is done, how its tasks stand and how well it is written. Limited to the units the caller may see; nothing is calculated or stored here.
create or replace function read_goal_facts(p_quarter_id uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'goal_id', g.id, 'business_unit_id', r.business_unit_id, 'week_id', w.id, 'week_number', w.week_number, 'week_start_at', w.week_start_at,
    'submitted', r.submission_status = 'SUBMITTED', 'bu_goal_id', g.bu_goal_id, 'sub_kr_code', s.code, 'kr_code', k.code, 'title', g.title,
    'done', goal_is_done(g.id), 'tasks_total', tk.total, 'tasks_done', tk.done, 'tasks_undefined', tk.undefined_count,
    'smart', (select e.overall_score from smart_evaluations e where e.smart_goal_id = g.id order by e.evaluated_at desc, e.id desc limit 1)
  ) order by w.week_start_at, g.position), '[]'::jsonb)
  from smart_goals g
  join weekly_reports r on r.id = g.weekly_report_id
  join reporting_weeks w on w.id = r.reporting_week_id
  left join sub_key_results s on s.id = g.sub_key_result_id
  left join key_results k on k.id = s.key_result_id
  left join lateral (
    select count(*)::int total, count(*) filter (where t.status = 'DONE')::int done, count(*) filter (where t.status = 'UNDEFINED')::int undefined_count
    from tasks t where t.smart_goal_id = g.id and t.deleted_at is null) tk on true
  where w.quarter_id = p_quarter_id and g.deleted_at is null and auth_can_view_bu(r.business_unit_id);
$$;
select lock_down_function_grants();

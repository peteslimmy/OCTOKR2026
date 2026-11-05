-- Strategy scores are cumulative and live: every goal in a SUBMITTED report counts as soon as it is filed, not only after final lock,
-- so Sub-KR figures move as tasks are marked. Each Key Result also carries the cumulative total of its Sub-KRs.
create or replace function read_strategy_tree(p_quarter_id uuid) returns jsonb
language plpgsql stable set search_path to 'public', 'pg_temp' as $$
begin
  return (
    select jsonb_build_object(
      'quarter', to_jsonb(q),
      'objective', case when o.id is null then null else jsonb_build_object('id', o.id, 'title', o.title, 'description', o.description) end,
      'pending_changes', (select count(*) from strategy_change_requests c where c.quarter_id = q.id and c.status = 'PENDING'),
      'key_results', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id, 'code', k.code, 'title', k.title, 'description', k.description, 'status', k.status,
          'mapped_goals', kt.total, 'done_goals', kt.done,
          'execution', case when kt.total = 0 then null else round(kt.done * 100.0 / kt.total, 2) end,
          'sub_key_results', coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'title', s.title, 'description', s.description, 'status', s.status,
              'mapped_goals', m.total, 'done_goals', m.done,
              'execution', case when m.total = 0 then null else round(m.done * 100.0 / m.total, 2) end) order by s.sequence)
            from sub_key_results s
            left join lateral (
              select count(*)::int total, count(*) filter (where goal_is_done(g.id))::int done
              from smart_goals g join weekly_reports r on r.id = g.weekly_report_id
              where g.sub_key_result_id = s.id and g.deleted_at is null and r.submission_status = 'SUBMITTED') m on true
            where s.key_result_id = k.id), '[]'::jsonb)) order by k.sequence)
        from key_results k
        left join lateral (
          select count(*)::int total, count(*) filter (where goal_is_done(g.id))::int done
          from smart_goals g join weekly_reports r on r.id = g.weekly_report_id join sub_key_results s2 on s2.id = g.sub_key_result_id
          where s2.key_result_id = k.id and g.deleted_at is null and r.submission_status = 'SUBMITTED') kt on true
        where k.objective_id = o.id), '[]'::jsonb),
      'readiness', case when q.status = 'PLANNED' then read_quarter_readiness(q.id) else '[]'::jsonb end)
    from quarters q left join quarterly_objectives o on o.quarter_id = q.id where q.id = p_quarter_id);
end $$;
select lock_down_function_grants();

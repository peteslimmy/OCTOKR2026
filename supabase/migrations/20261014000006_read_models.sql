-- Read models. SECURITY INVOKER: every table read below is filtered by the caller's RLS policies.

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
                     'goal_is_done','report_goal_counts','calc_base_score','calc_final_score','active_penalty_rate')
       or r.proname like 'read\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

create or replace function read_report_view(p_report_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  r weekly_reports; w reporting_weeks; v_phase text; v_goals jsonb; v_total int; v_done int; v_base numeric;
  v_rates numeric; v_snap weekly_score_snapshots; v_comp weekly_compliance; v_outcome text; v_bu business_units;
begin
  select * into r from weekly_reports where id = p_report_id;
  if not found then return null; end if;
  select * into w from reporting_weeks where id = r.reporting_week_id;
  select * into v_bu from business_units where id = r.business_unit_id;
  v_phase := report_phase(w.id);
  select outcome into v_outcome from governance_sessions where reporting_week_id = w.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'title', g.title, 'description', g.description, 'goal_type', g.goal_type, 'position', g.position,
      'status', case when goal_is_done(g.id) then 'DONE' else 'NOT_DONE' end,
      'has_undefined_tasks', exists (select 1 from tasks t where t.smart_goal_id = g.id and t.deleted_at is null and t.status = 'UNDEFINED'),
      'sub_key_result', case when s.id is null then null else jsonb_build_object('id', s.id, 'code', s.code, 'title', s.title, 'kr_code', k.code, 'kr_title', k.title) end,
      'evaluation', (select to_jsonb(e) - 'smart_goal_id' - 'evaluated_by' from smart_evaluations e where e.smart_goal_id = g.id order by e.evaluated_at desc, e.id desc limit 1),
      'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'status', t.status, 'position', t.position) order by t.position)
                         from tasks t where t.smart_goal_id = g.id and t.deleted_at is null), '[]'::jsonb)
    ) order by g.position), '[]'::jsonb)
  into v_goals
  from smart_goals g
  left join sub_key_results s on s.id = g.sub_key_result_id
  left join key_results k on k.id = s.key_result_id
  where g.weekly_report_id = r.id and g.deleted_at is null;

  select total_goals, done_goals into v_total, v_done from report_goal_counts(r.id);
  v_base := calc_base_score(v_done, v_total);
  select coalesce(sum(penalty_rate), 0) into v_rates from integrity_corrections where weekly_report_id = r.id and penalty_decision = 'APPLY';
  select * into v_snap from weekly_score_snapshots where business_unit_id = r.business_unit_id and reporting_week_id = w.id order by version_number desc limit 1;
  select * into v_comp from weekly_compliance where business_unit_id = r.business_unit_id and reporting_week_id = w.id;

  return jsonb_build_object(
    'report', jsonb_build_object('id', r.id, 'status', r.status, 'submission_status', r.submission_status, 'review_status', r.review_status,
      'version', r.version, 'submitted_at', r.submitted_at, 'skipped_session_summary_comment', r.skipped_session_summary_comment,
      'reviewed_at', r.reviewed_at, 'final_locked_at', r.final_locked_at),
    'business_unit', jsonb_build_object('id', v_bu.id, 'code', v_bu.code, 'name', v_bu.name),
    'week', jsonb_build_object('id', w.id, 'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at,
      'content_lock_at', w.content_lock_at, 'final_lock_at', w.final_lock_at, 'reporting_state', w.reporting_state),
    'phase', v_phase,
    'session_outcome', coalesce(v_outcome, 'SCHEDULED'),
    'summary_required', v_outcome = 'SKIPPED',
    'goals', v_goals,
    'score_preview', jsonb_build_object('total_goals', v_total, 'done_goals', v_done, 'base_score', round(v_base, 2),
      'applied_penalty_rate', v_rates, 'final_score', calc_final_score(v_base, v_rates)),
    'snapshot', case when v_snap.id is null then null else jsonb_build_object('version', v_snap.version_number, 'state', v_snap.score_state,
      'base_score', round(v_snap.base_score, 2), 'combined_penalty_rate', v_snap.combined_penalty_rate, 'final_score', v_snap.final_score,
      'applied_penalty_rates', v_snap.applied_penalty_rates, 'reason', v_snap.reason) end,
    'compliance', case when v_comp.id is null then null else jsonb_build_object('status', v_comp.status, 'reason', v_comp.reason) end
  );
end $$;

-- Presenter / executive: week overview of every BU (submission state, derived goal counts, latest score).
create or replace function read_week_overview(p_week_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_unit', jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name),
      'report_id', r.id, 'submission_status', coalesce(r.submission_status, 'NOT_SUBMITTED'), 'review_status', r.review_status,
      'total_goals', c.total_goals, 'done_goals', c.done_goals,
      'base_preview', case when r.id is null then null else round(calc_base_score(c.done_goals, c.total_goals), 2) end,
      'final_score', s.final_score, 'score_state', s.score_state, 'snapshot_version', s.version_number,
      'compliance', wc.status) order by b.name)
    from business_units b
    left join weekly_reports r on r.business_unit_id = b.id and r.reporting_week_id = p_week_id
    left join lateral (select * from report_goal_counts(r.id)) c on r.id is not null
    left join lateral (select * from weekly_score_snapshots x where x.business_unit_id = b.id and x.reporting_week_id = p_week_id order by version_number desc limit 1) s on true
    left join weekly_compliance wc on wc.business_unit_id = b.id and wc.reporting_week_id = p_week_id
    where b.status = 'ACTIVE' and b.reports_weekly), '[]'::jsonb);
end $$;

-- Strategy tree with execution metric (done mapped goals / total mapped goals, final-locked & submitted reports only).
create or replace function read_strategy_tree(p_quarter_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return (
    select jsonb_build_object(
      'quarter', to_jsonb(q),
      'objective', case when o.id is null then null else jsonb_build_object('id', o.id, 'title', o.title, 'description', o.description) end,
      'key_results', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id, 'code', k.code, 'title', k.title, 'description', k.description,
          'sub_key_results', coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'title', s.title, 'description', s.description,
              'mapped_goals', m.total, 'done_goals', m.done,
              'execution', case when m.total = 0 then null else round(m.done * 100.0 / m.total, 2) end) order by s.sequence)
            from sub_key_results s
            left join lateral (
              select count(*)::int total, count(*) filter (where goal_is_done(g.id))::int done
              from smart_goals g join weekly_reports r on r.id = g.weekly_report_id
              where g.sub_key_result_id = s.id and g.deleted_at is null and r.status = 'FINAL_LOCKED' and r.submission_status = 'SUBMITTED') m on true
            where s.key_result_id = k.id), '[]'::jsonb)) order by k.sequence)
        from key_results k where k.objective_id = o.id), '[]'::jsonb),
      'readiness', case when q.status = 'PLANNED' then read_quarter_readiness(q.id) else '[]'::jsonb end)
    from quarters q left join quarterly_objectives o on o.quarter_id = q.id where q.id = p_quarter_id);
end $$;

create or replace function read_quarter_readiness(p_quarter_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_obj uuid; v_krs int; v_b jsonb := '[]'::jsonb; r record;
begin
  select id into v_obj from quarterly_objectives where quarter_id = p_quarter_id;
  if v_obj is null then return jsonb_build_array('An objective has not been created yet'); end if;
  select count(*) into v_krs from key_results where objective_id = v_obj;
  if v_krs < 3 then v_b := v_b || to_jsonb('Needs 3–4 key results (currently ' || v_krs || ')'); end if;
  for r in select k.code from key_results k where k.objective_id = v_obj and not exists (select 1 from sub_key_results s where s.key_result_id = k.id) order by k.sequence loop
    v_b := v_b || to_jsonb(r.code || ' has no Sub-KR');
  end loop;
  return v_b;
end $$;
create or replace function read_executive_dashboard(p_quarter_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_week uuid; v_rank jsonb; v_noncomp jsonb; v_ic jsonb; v_tree jsonb;
begin
  if not auth_has_permission('dashboard.executive.view') then raise exception 'PERMISSION_DENIED'; end if;
  select id into v_week from reporting_weeks where quarter_id = p_quarter_id and status = 'FINAL_LOCKED' and reporting_state = 'NORMAL' order by week_start_at desc limit 1;
  select coalesce(jsonb_agg(x order by (x->>'quarter_score')::numeric desc nulls last, x->>'name'), '[]'::jsonb) into v_rank from (
    select jsonb_build_object('business_unit_id', b.id, 'name', b.name, 'code', b.code,
      'latest_week_score', (select s.final_score from weekly_score_snapshots s where s.business_unit_id = b.id and s.reporting_week_id = v_week order by version_number desc limit 1),
      'quarter_score', qs.score, 'quarter_status', qs.calculation_status, 'quarter_score_reason', qs.score_reason,
      'quarter_version', qs.version_number, 'missing_report_zero_count', qs.missing_report_zero_count) x
    from business_units b
    left join lateral (select * from quarterly_score_snapshots z where z.business_unit_id = b.id and z.quarter_id = p_quarter_id order by version_number desc limit 1) qs on true
    where b.status = 'ACTIVE' and b.reports_weekly) t;
  select coalesce(jsonb_agg(jsonb_build_object('business_unit', b.name, 'week_start_at', w.week_start_at, 'reason', c.reason) order by w.week_start_at desc), '[]'::jsonb)
    into v_noncomp
    from weekly_compliance c join business_units b on b.id = c.business_unit_id join reporting_weeks w on w.id = c.reporting_week_id
    where c.status = 'NON_COMPLIANT' and w.quarter_id = p_quarter_id;
  select jsonb_build_object('total', count(*), 'applied', count(*) filter (where penalty_decision = 'APPLY'), 'waived', count(*) filter (where penalty_decision = 'WAIVE'))
    into v_ic from integrity_corrections ic join weekly_reports r on r.id = ic.weekly_report_id join reporting_weeks w on w.id = r.reporting_week_id where w.quarter_id = p_quarter_id;
  v_tree := read_strategy_tree(p_quarter_id);
  return jsonb_build_object('latest_finalised_week_id', v_week, 'ranking', v_rank, 'non_compliant', v_noncomp, 'integrity', v_ic, 'strategy', v_tree);
end $$;

select lock_down_function_grants();

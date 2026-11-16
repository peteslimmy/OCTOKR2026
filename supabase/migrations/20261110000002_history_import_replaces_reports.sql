-- Historical import replaces a report that already exists for a unit and week in the file (ADR-124; owner decision: "overwrite any existing report
-- when historical is being uploaded", and "delete old, replace" rather than keeping an archive).
-- Safeguards that stay: history.import (Admin and Super Admin), the rehearsal (which now says how many reports it will replace), the typed
-- IMPORT HISTORY confirmation, the fresh authenticator code, the notification to every Super Admin, and one audit entry per replaced report that
-- keeps the removed goals, tasks and scores in its old_values, so the deletion leaves a trace.
-- A report that other records depend on (comments, corrections, exceptions, evidence...) is still refused, never cut loose from them.
-- A batch that replaced reports, or loaded reports into weeks the application had already closed, cannot be rolled back with the import's
-- rollback (it cannot restore what it removed); corrections go through the ordinary routes.

insert into audit_action_rules (pattern, category, severity, priority) values ('HISTORICAL_IMPORT_REPORT_REPLACED', 'FILES_EXPORT', 'HIGH', 900)
on conflict (pattern) do nothing;

create or replace function history_report_replaceable(p_report uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g uuid[]; t uuid[];
begin
  select coalesce(array_agg(id), '{}') into g from smart_goals where weekly_report_id = p_report;
  select coalesce(array_agg(id), '{}') into t from tasks where smart_goal_id = any(g);
  return jsonb_array_length(
           import_void_children('weekly_reports'::regclass, array[p_report], array['smart_goals','weekly_compliance','weekly_score_snapshots','report_edit_sessions','employee_kpi_snapshots'])
        || import_void_children('smart_goals'::regclass, g, array['tasks'])
        || import_void_children('tasks'::regclass, t, array['task_status_history'])) = 0;
end $$;

-- history_issues: an existing report is no longer a reason to refuse, unless something depends on it
do $$
declare v_def text;
  a text := $a$when exists (select 1 from weekly_reports x where x.reporting_week_id = w.week_id and x.business_unit_id = w.bu_id) then 'This unit already has a report for this week.'$a$;
  b text := $b$when exists (select 1 from weekly_reports x where x.reporting_week_id = w.week_id and x.business_unit_id = w.bu_id and not history_report_replaceable(x.id)) then 'This unit already has a report for this week, and other records depend on it (comments, corrections or exceptions), so it cannot be replaced.'$b$;
begin
  v_def := pg_get_functiondef('history_issues(uuid)'::regprocedure);
  if position('history_report_replaceable' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_issues changed'; end if;
  execute replace(v_def, a, b);
end $$;

-- history_apply: delete the reports being replaced (keeping what was removed in the audit entry), and report how many
do $$
declare v_def text;
  d1 text := $a$v_touched uuid[] := '{}'; v_fin jsonb; v_gap_weeks int := 0;$a$;
  n1 text := $b$v_touched uuid[] := '{}'; v_fin jsonb; v_gap_weeks int := 0; v_replaced int := 0; v_closed int := 0; ex record; v_g_ids uuid[]; v_t_ids uuid[]; v_old jsonb;$b$;
  a2 text := $a$  -- the weeks, the reports, their goals and tasks$a$;
  b2 text := $b$  -- reports that already exist for a unit and week in the file are replaced: what is removed is kept in the audit entry, the delete runs under the narrow import flag
  for ex in select wr.id as report_id, wr.business_unit_id as bu_id, bu.code as unit_code, rw.week_year, rw.week_number, wr.submission_status, wr.review_status
              from weekly_reports wr join reporting_weeks rw on rw.id = wr.reporting_week_id join business_units bu on bu.id = wr.business_unit_id
             where exists (select 1 from historical_import_rows h where h.batch_id = p_batch and h.bu_id = wr.business_unit_id and h.monday = (rw.week_start_at at time zone 'Africa/Lagos')::date) loop
    select coalesce(array_agg(id), '{}') into v_g_ids from smart_goals where weekly_report_id = ex.report_id;
    select coalesce(array_agg(id), '{}') into v_t_ids from tasks where smart_goal_id = any(v_g_ids);
    v_old := jsonb_build_object('unit', ex.unit_code, 'year', ex.week_year, 'week', ex.week_number, 'submission', ex.submission_status, 'review', ex.review_status,
      'goals', (select coalesce(jsonb_agg(jsonb_build_object('title', xg.title, 'tasks', (select coalesce(jsonb_agg(jsonb_build_object('d', xt.description, 's', xt.status) order by xt.position), '[]'::jsonb) from tasks xt where xt.smart_goal_id = xg.id)) order by xg.position), '[]'::jsonb) from smart_goals xg where xg.weekly_report_id = ex.report_id),
      'scores', (select coalesce(jsonb_agg(jsonb_build_object('version', xs.version_number, 'state', xs.score_state, 'score', xs.final_score) order by xs.version_number), '[]'::jsonb) from weekly_score_snapshots xs where xs.weekly_report_id = ex.report_id));
    perform set_config('app.import_void', 'on', true);
    delete from task_status_history where task_id = any(v_t_ids);
    delete from tasks where id = any(v_t_ids);
    delete from smart_goals where id = any(v_g_ids);
    perform import_void_purge('weekly_reports'::regclass, array[ex.report_id], array['weekly_compliance','weekly_score_snapshots','report_edit_sessions','employee_kpi_snapshots']);
    delete from weekly_reports where id = ex.report_id;
    perform set_config('app.import_void', 'off', true);
    perform write_audit(p_actor, 'HISTORICAL_IMPORT_REPORT_REPLACED', 'weekly_report', ex.report_id::text, v_old, null, 'Replaced by the historical import (batch ' || p_batch || ')', ex.bu_id);
    v_replaced := v_replaced + 1;
  end loop;

$b$ || a2;
  a3 text := $a$perform create_weekly_snapshot(rr.business_unit_id, rr.reporting_week_id, rr.report_id, 'HISTORICAL_IMPORT');$a$;
  b3 text := $b$v_closed := v_closed + 1;
        perform create_weekly_snapshot(rr.business_unit_id, rr.reporting_week_id, rr.report_id, 'HISTORICAL_IMPORT');$b$;
  a4 text := $a$'weeks_with_rows', v_weeks, 'weeks_without_rows_scored', v_gap_weeks, 'reports', v_reports,$a$;
  b4 text := $b$'weeks_with_rows', v_weeks, 'weeks_without_rows_scored', v_gap_weeks, 'reports', v_reports, 'reports_replaced', v_replaced, 'closed_week_reports', v_closed,$b$;
begin
  v_def := pg_get_functiondef('history_apply(uuid,uuid,boolean)'::regprocedure);
  if position('v_replaced' in v_def) > 0 then return; end if;
  if position(d1 in v_def) = 0 or position(a2 in v_def) = 0 or position(a3 in v_def) = 0 or position(a4 in v_def) = 0 then raise exception 'history_apply changed'; end if;
  execute replace(replace(replace(replace(v_def, d1, n1), a2, b2), a3, b3), a4, b4);
end $$;

-- history_void: refuse to roll back a batch that replaced or added reports in weeks that already existed
do $$
declare v_def text;
  a text := $a$if b.status <> 'COMMITTED' then raise exception 'HISTORY_BATCH_STATE' using detail = 'only a committed import can be rolled back'; end if;$a$;
begin
  v_def := pg_get_functiondef('history_void(uuid,uuid,text,text)'::regprocedure);
  if position('reports_replaced' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_void changed'; end if;
  execute replace(v_def, a, a || $b$
  if coalesce((b.result->>'reports_replaced')::int, 0) > 0 or coalesce((b.result->>'closed_week_reports')::int, 0) > 0 then
    raise exception 'IMPORT_VOID_NOT_AVAILABLE' using detail = 'this import replaced existing reports or added reports to weeks the application had already closed, so it cannot be rolled back; correct scores through the amendment routes';
  end if;$b$);
end $$;

select lock_down_function_grants();

-- A week whose final lock time has passed is final: it can no longer be edited, whether or not its locks had been suspended.
-- Suspending locks holds a week open only until its final lock time. After that the scheduled job finalises it (open tasks become Not done, the week is scored) and the report is
-- immutable. To add a report for a week that has already ended, use an authorised late report or the history import.
do $$
declare v_def text; a text;
begin
  v_def := pg_get_functiondef('report_phase(uuid)'::regprocedure);
  a := 'when w.locks_suspended_at is not null then ''OPEN''';
  if position(a in v_def) = 0 then raise exception 'report_phase changed'; end if;
  execute replace(v_def, a, 'when w.locks_suspended_at is not null and app_now() < w.final_lock_at then ''OPEN''');

  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  a := 'where status <> ''FINAL_LOCKED'' and locks_suspended_at is null and app_now() >= final_lock_at order by';
  if position(a in v_def) = 0 then raise exception 'run_scheduled_jobs changed'; end if;
  execute replace(v_def, a, 'where status <> ''FINAL_LOCKED'' and app_now() >= final_lock_at order by');

  v_def := pg_get_functiondef('finalize_reporting_week(uuid)'::regprocedure);
  a := 'if app_now() < w.final_lock_at or w.locks_suspended_at is not null then raise exception ''FINAL_LOCK_NOT_DUE''; end if;';
  if position(a in v_def) = 0 then raise exception 'finalize_reporting_week changed'; end if;
  execute replace(v_def, a, 'if app_now() < w.final_lock_at then raise exception ''FINAL_LOCK_NOT_DUE''; end if;');
end $$;

-- how many of a unit's people were present in each week's session (the unit's own lead may not read attendance rows, so this reads them for the unit's own totals only)
create or replace function read_bu_attendance(p_bu uuid, p_quarter uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth_can_view_bu(p_bu) then coalesce((
    select jsonb_agg(jsonb_build_object('reporting_week_id', x.week_id, 'present', x.present, 'total', x.total) order by x.week_start)
    from (select w.id week_id, w.week_start_at week_start, count(*) filter (where ar.status in ('PRESENT', 'VIRTUAL_PRESENT'))::int present, count(*)::int total
          from attendance_records ar join governance_sessions gs on gs.id = ar.governance_session_id join reporting_weeks w on w.id = gs.reporting_week_id
          where ar.business_unit_id = p_bu and w.quarter_id = p_quarter group by w.id, w.week_start_at) x), '[]'::jsonb)
  else '[]'::jsonb end;
$$;
select lock_down_function_grants();

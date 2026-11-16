-- Historical import may load a week the application has already closed (ADR-123; owner decision: "all historical should be allowed, only by Admin").
-- Until now history_issues refused any week that already existed and was FINAL_LOCKED, which in the running quarter is every past week, so the
-- running-quarter change of ADR-122 could load almost nothing. Now such a week accepts a report for a unit that has none yet:
--   * the report, its goals and tasks are added and the report is locked at the week's own lock times;
--   * the week's first score for the unit (usually the final-lock zero, "no report") is never edited: a NEW weekly snapshot version is added
--     with the ordinary scoring rules, and the quarter's score gets a new snapshot version computed from the finished weeks;
--   * the week itself, its other reports and its lock stay as they are; compliance is left as recorded (and written only when none exists);
--   * a unit that already has a report for the week is still refused, as are holiday weeks and weeks that have not closed.
-- Who may do it is unchanged: history.import (Admin and Super Admin), with the rehearsal, the typed confirmation, the fresh authenticator code,
-- the audit entry and the notification to every Super Admin.

alter table weekly_score_snapshots drop constraint weekly_score_snapshots_reason_check;
alter table weekly_score_snapshots add constraint weekly_score_snapshots_reason_check
  check (reason in ('FINAL_LOCK','INTEGRITY_CORRECTION','LATE_REPORT_AMENDMENT','HOLIDAY_REVERSAL','HISTORICAL_IMPORT'));

do $$
declare v_def text; a text := $a$w.week_status = 'FINAL_LOCKED' then 'The application has already closed this week; a report can be added to it only through a late-report exception.'$a$;
begin
  v_def := pg_get_functiondef('history_issues(uuid)'::regprocedure);
  if position('and false then' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_issues changed'; end if;
  execute replace(v_def, a, $b$false then 'closed weeks are accepted by the historical import'$b$);
end $$;

do $$
declare v_def text; a text := $a$  -- optionally the rest of each touched quarter$a$;
  b text := $b$  -- a week the application had already closed: lock the new report at the week's own times and score it as a NEW version (the first score stays)
  declare rr record; qq uuid; v_qs uuid[] := '{}';
  begin
    for rr in select wr.id as report_id, rw.quarter_id, wr.business_unit_id, wr.reporting_week_id, rw.content_lock_at, rw.final_lock_at, rw.reporting_state
                from weekly_reports wr join reporting_weeks rw on rw.id = wr.reporting_week_id
               where wr.status = 'OPEN' and rw.status = 'FINAL_LOCKED' and rw.quarter_id = any(v_touched) loop
      v_qs := v_qs || rr.quarter_id;
      update weekly_reports set status = 'FINAL_LOCKED', content_locked_at = rr.content_lock_at, final_locked_at = rr.final_lock_at, updated_at = app_now() where id = rr.report_id;
      if rr.reporting_state = 'NORMAL' then
        perform create_weekly_snapshot(rr.business_unit_id, rr.reporting_week_id, rr.report_id, 'HISTORICAL_IMPORT');
        insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
          values (rr.business_unit_id, rr.reporting_week_id, rr.report_id, 'COMPLIANT', 'REPORT_SUBMITTED') on conflict do nothing;
      end if;
    end loop;
    for qq in select distinct x from unnest(v_qs) x loop
      perform snapshot_quarterly_scores(qq);                   -- the quarter's score gets a new version from the finished weeks; the earlier version stays
    end loop;
  end;

$b$ || a;
begin
  v_def := pg_get_functiondef('history_apply(uuid,uuid,boolean)'::regprocedure);
  if position('score it as a NEW version' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'history_apply changed'; end if;
  execute replace(v_def, a, b);
end $$;

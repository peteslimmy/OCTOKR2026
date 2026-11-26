-- Every Business Unit must submit a weekly report (owner rule, 25 November 2026). At the final lock (Tuesday 11:00 WAT) every task still Undefined already becomes Not done; now a report that was
-- never submitted is SUBMITTED by the system as well, and flagged: "auto-submitted at final lock". It is counted as submitted (so the week is scored from what was filed and shown as compliant), but it carries the
-- flag and its own compliance reason (AUTO_SUBMITTED_AT_FINAL_LOCK), so leadership can still see who submitted on their own and who did not.
-- Only a report that meets the same minimum as a manual submission is submitted: at least one goal, every goal with at least one task, and the summary the OKR session needs when the session was skipped.
-- A report that does not meet it stays unsubmitted and non-compliant, and a Business Unit with no report at all stays a zero, as before. A holiday week and a historical import are left alone.
-- The submission is recorded as made by the system (no submitter) and audited as REPORT_AUTO_SUBMITTED.

alter table weekly_reports add column if not exists auto_submitted boolean not null default false;

do $$
declare v_def text; v_new text; n int; r record;
begin
  v_def := pg_get_functiondef('finalize_reporting_week(uuid)'::regprocedure);
  if position('v_auto_n' in v_def) > 0 then return; end if;
  v_new := v_def;
  for r in select * from (values
    ('v_flipped int := 0; v_snap uuid;',
     'v_flipped int := 0; v_snap uuid; v_auto boolean; v_auto_n int := 0; v_gn int; v_blk int;'),
    ('    update weekly_reports set status = ''FINAL_LOCKED'', content_locked_at = coalesce(content_locked_at, w.content_lock_at),',
     '    v_auto := false;
    if w.reporting_state = ''NORMAL'' and r.submission_status <> ''SUBMITTED'' and coalesce(current_setting(''app.historical_import'', true), '''') <> ''on'' then
      select count(*) into v_gn from smart_goals g where g.weekly_report_id = r.id and g.deleted_at is null;
      select count(*) into v_blk from smart_goals g where g.weekly_report_id = r.id and g.deleted_at is null and not exists (select 1 from tasks tk2 where tk2.smart_goal_id = g.id and tk2.deleted_at is null);
      if v_gn > 0 and v_blk = 0
         and (not exists (select 1 from governance_sessions s where s.reporting_week_id = p_week_id and s.outcome = ''SKIPPED'') or nullif(btrim(coalesce(r.skipped_session_summary_comment, '''')), '''') is not null) then
        update weekly_reports set submission_status = ''SUBMITTED'', submitted_at = app_now(), submitted_by = null, auto_submitted = true, version = version + 1, updated_at = app_now() where id = r.id;
        perform write_audit(null, ''REPORT_AUTO_SUBMITTED'', ''weekly_report'', r.id::text, jsonb_build_object(''submission_status'', r.submission_status),
          jsonb_build_object(''submission_status'', ''SUBMITTED'', ''goals'', v_gn, ''auto_submitted'', true), ''Submitted by the system at the final lock'', r.business_unit_id);
        r.submission_status := ''SUBMITTED'';
        v_auto := true; v_auto_n := v_auto_n + 1;
      end if;
    end if;
    update weekly_reports set status = ''FINAL_LOCKED'', content_locked_at = coalesce(content_locked_at, w.content_lock_at),'),
    ('case when r.submission_status = ''SUBMITTED'' then ''REPORT_SUBMITTED'' else ''NOT_SUBMITTED_AT_FINAL_LOCK'' end',
     'case when v_auto then ''AUTO_SUBMITTED_AT_FINAL_LOCK'' when r.submission_status = ''SUBMITTED'' then ''REPORT_SUBMITTED'' else ''NOT_SUBMITTED_AT_FINAL_LOCK'' end'),
    ('''tasks_set_not_done'', v_flipped, ''reporting_state'', w.reporting_state));',
     '''tasks_set_not_done'', v_flipped, ''auto_submitted'', v_auto_n, ''reporting_state'', w.reporting_state));'),
    ('''missing'', v_missing, ''tasks_set_not_done'', v_flipped);',
     '''missing'', v_missing, ''tasks_set_not_done'', v_flipped, ''auto_submitted'', v_auto_n);')
  ) as x(a, b) loop
    n := (length(v_new) - length(replace(v_new, r.a, ''))) / length(r.a);
    if n <> 1 then raise exception 'finalize_reporting_week: expected one match, found % for: %', n, left(r.a, 70); end if;
    v_new := replace(v_new, r.a, r.b);
  end loop;
  execute v_new;
end $$;

-- the report in the view the screens read says whether it was auto-submitted
do $$
declare v_def text; n int;
  a text := '''submission_status'', r.submission_status,';
  b text := '''submission_status'', r.submission_status, ''auto_submitted'', r.auto_submitted,';
begin
  v_def := pg_get_functiondef('read_report_view_base(uuid)'::regprocedure);
  if position('''auto_submitted'', r.auto_submitted' in v_def) > 0 then return; end if;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n < 1 then raise exception 'read_report_view_base: the submission_status line was not found'; end if;
  execute replace(v_def, a, b);
end $$;

select lock_down_function_grants();

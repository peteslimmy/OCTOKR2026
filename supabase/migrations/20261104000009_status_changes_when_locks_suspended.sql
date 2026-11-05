-- While an administrator holds a week open (locks suspended), a SUBMITTED report is presented and run like one past content lock:
--   * the BU Lead can set an undefined task to Done or Not done (execute_task),
--   * the Presenter can toggle Done <-> Not done as a governed integrity correction (create_integrity_correction).
-- Before, both needed the content lock to have passed, so in a held-open week nobody could change a status at all.
-- The read model also says whether the week's quarter is locked, so the screen can explain why corrections are closed.
do $$
declare v_def text; a text;
begin
  v_def := pg_get_functiondef('execute_task(uuid,uuid,text)'::regprocedure);
  a := 'v_phase := report_phase_of(v_r);';
  if position(a in v_def) = 0 then raise exception 'execute_task changed'; end if;
  execute replace(v_def, a, a || ' if v_phase = ''OPEN'' and v_r.submission_status = ''SUBMITTED'' and exists (select 1 from reporting_weeks rw where rw.id = v_r.reporting_week_id and rw.locks_suspended_at is not null) then v_phase := ''CONTENT_LOCKED''; end if;');

  v_def := pg_get_functiondef('create_integrity_correction(uuid,uuid,text,text,text,text,text)'::regprocedure);
  a := 'v_phase := report_phase(v_w.id);';
  if position(a in v_def) = 0 then raise exception 'create_integrity_correction changed'; end if;
  execute replace(v_def, a, a || ' if v_phase = ''OPEN'' and v_r.submission_status = ''SUBMITTED'' and v_w.locks_suspended_at is not null then v_phase := ''CONTENT_LOCKED''; end if;');

  v_def := pg_get_functiondef('read_report_view_base(uuid)'::regprocedure);
  a := '''phase'', v_phase,';
  if position(a in v_def) = 0 then raise exception 'read_report_view_base changed'; end if;
  execute replace(v_def, a, a || ' ''quarter_locked'', quarter_is_locked(w.quarter_id), ''status_changes_open'', (v_phase = ''OPEN'' and r.submission_status = ''SUBMITTED'' and w.locks_suspended_at is not null),');
end $$;
select lock_down_function_grants();

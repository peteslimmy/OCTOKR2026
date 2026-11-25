-- The point of pausing or suspending the locks (ADR-132, owner clarification 25 November 2026): while a week's locks are off, the BU Lead has FULL access to the report,
-- with no content lock and no final lock in the way. They can edit goals and tasks (the week stays open), and they can set and change task statuses: Undefined to Done or
-- Not done, and Done and Not done back and forth, whether or not the report was submitted. Until now (20261104000009) status changes in such a week needed a SUBMITTED report
-- and could only go from Undefined once; a draft report could not be executed at all, so the pause let people edit goals but not tick tasks.
-- Every change is still recorded (status history with the real previous status, audit entry). When the locks come back, the clock takes over again: the content lock and the
-- final lock apply at their times, and at the final lock any task still Undefined becomes Not done, as always. A week that is not paused keeps the old one-way rule.

do $$
declare v_def text; v_new text; n int;
  r record;
begin
  v_def := pg_get_functiondef('execute_task(uuid,uuid,text)'::regprocedure);
  if position('v_paused' in v_def) > 0 then return; end if;
  v_new := v_def;
  for r in select * from (values
    ('declare v_t tasks; v_g smart_goals; v_r weekly_reports; v_phase text;',
     'declare v_t tasks; v_g smart_goals; v_r weekly_reports; v_phase text; v_paused boolean := false;'),
    ('if v_phase = ''OPEN'' and v_r.submission_status = ''SUBMITTED'' and exists (select 1 from reporting_weeks rw where rw.id = v_r.reporting_week_id and rw.locks_suspended_at is not null) then v_phase := ''CONTENT_LOCKED''; end if;',
     'if v_phase = ''OPEN'' and exists (select 1 from reporting_weeks rw where rw.id = v_r.reporting_week_id and rw.locks_suspended_at is not null) then v_phase := ''CONTENT_LOCKED''; v_paused := true; end if;'),
    ('if v_t.status <> ''UNDEFINED'' then raise exception ''INVALID_STATE_TRANSITION'' using detail = v_t.status || '' -> '' || p_status; end if;',
     'if v_paused and v_t.status = p_status then return jsonb_build_object(''task_id'', p_task_id, ''status'', p_status, ''goal_done'', goal_is_done(v_g.id), ''unchanged'', true); end if; if v_t.status <> ''UNDEFINED'' and not v_paused then raise exception ''INVALID_STATE_TRANSITION'' using detail = v_t.status || '' -> '' || p_status; end if;'),
    ('update tasks set status = p_status, updated_at = app_now() where id = p_task_id;',
     'if v_paused then perform set_config(''app.paused_status_change'', ''on'', true); end if; update tasks set status = p_status, updated_at = app_now() where id = p_task_id; perform set_config(''app.paused_status_change'', ''off'', true);'),
    ('values (p_task_id, ''UNDEFINED'', p_status, ''BU_LEAD_EXECUTION'', p_actor);',
     'values (p_task_id, v_t.status, p_status, ''BU_LEAD_EXECUTION'', p_actor);'),
    ('jsonb_build_object(''status'', ''UNDEFINED''), jsonb_build_object(''status'', p_status), null, v_r.business_unit_id);',
     'jsonb_build_object(''status'', v_t.status), jsonb_build_object(''status'', p_status), case when v_paused then ''The locks are paused: statuses can be changed freely'' else null end, v_r.business_unit_id);')
  ) as x(a, b) loop
    n := (length(v_new) - length(replace(v_new, r.a, ''))) / length(r.a);
    if n <> 1 then raise exception 'execute_task: expected one match, found % for: %', n, left(r.a, 70); end if;
    v_new := replace(v_new, r.a, r.b);
  end loop;
  execute v_new;
end $$;

-- the guard on tasks allows only Undefined to Done or Not done (or an integrity correction); a status change made inside a paused week is allowed too
do $$
declare v_def text;
  a text := $a$and coalesce(current_setting('app.integrity_correction', true), '') <> 'on'$a$;
  b text := $b$and coalesce(current_setting('app.integrity_correction', true), '') <> 'on' and coalesce(current_setting('app.paused_status_change', true), '') <> 'on'$b$;
begin
  v_def := pg_get_functiondef('guard_task()'::regprocedure);
  if position('app.paused_status_change' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'guard_task: the integrity-correction condition was not found'; end if;
  execute replace(v_def, a, b);
end $$;

-- the screen is told a paused week allows status changes whatever the submission state
do $$
declare v_def text;
  a text := '''status_changes_open'', (v_phase = ''OPEN'' and r.submission_status = ''SUBMITTED'' and w.locks_suspended_at is not null),';
  b text := '''status_changes_open'', (v_phase = ''OPEN'' and w.locks_suspended_at is not null),';
begin
  v_def := pg_get_functiondef('read_report_view_base(uuid)'::regprocedure);
  if position(b in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'read_report_view_base: the status_changes_open line was not found'; end if;
  execute replace(v_def, a, b);
end $$;

select lock_down_function_grants();

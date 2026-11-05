-- Skipping the OKR session needs a written justification. It is stored with the session, written to the audit trail,
-- sent to every BU Lead in the notification and shown on the session and on each BU's weekly report.
alter table governance_sessions add column skip_reason text;

drop function skip_okr_session(uuid, uuid, boolean, text);
create function skip_okr_session(p_actor uuid, p_session_id uuid, p_confirm boolean, p_idempotency_key text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s governance_sessions; w reporting_weeks; n int; v_ref uuid := gen_random_uuid(); v_bu_leads uuid[]; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'attendance.session.manage');
  if p_confirm is not true then raise exception 'VALIDATION_ERROR' using detail = 'explicit confirmation required'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  select * into s from governance_sessions where id = p_session_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.outcome = 'SKIPPED' then
    if s.skip_idempotency_key = p_idempotency_key then
      return jsonb_build_object('replayed', true, 'outcome', 'SKIPPED', 'staff_tagged', s.staff_tagged_count, 'operation_ref', s.skip_operation_ref);
    end if;
    raise exception 'INVALID_STATE_TRANSITION' using detail = 'session already skipped';
  end if;
  if s.roster_status = 'FINALIZED' then raise exception 'ATTENDANCE_SESSION_NOT_SKIPPABLE' using detail = 'a held roster is already finalised'; end if;
  select * into w from reporting_weeks where id = s.reporting_week_id;
  if w.reporting_state = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED' using detail = 'an organisation-holiday week has no OKR session to skip'; end if;

  perform set_config('app.attendance_skip', 'on', true);
  delete from attendance_records where governance_session_id = p_session_id;
  insert into attendance_records (governance_session_id, employee_id, business_unit_id, status, source)
    select p_session_id, e.id, e.business_unit_id, 'VIRTUAL_PRESENT', 'SKIP' from employees e where e.employment_status = 'ACTIVE' and e.on_attendance_roster;
  get diagnostics n = row_count;
  perform set_config('app.attendance_skip', 'off', true);

  update governance_sessions set outcome = 'SKIPPED', outcome_at = app_now(), outcome_by = p_actor, skip_operation_ref = v_ref, skip_reason = v_reason,
         staff_tagged_count = n, skip_idempotency_key = p_idempotency_key, roster_status = 'FINALIZED', roster_staff_count = n,
         roster_finalised_at = app_now(), roster_finalised_by = p_actor, updated_at = app_now()
   where id = p_session_id;
  perform write_audit(p_actor, 'OKR_SESSION_SKIPPED', 'governance_session', p_session_id::text, jsonb_build_object('outcome', s.outcome),
    jsonb_build_object('outcome', 'SKIPPED', 'staff_tagged_virtual_present', n, 'operation_ref', v_ref, 'reporting_week_id', s.reporting_week_id,
                       'note', 'weekly BU reports and manual summaries remain mandatory'), v_reason, null);
  v_bu_leads := users_with_permission('weekly_report.submit');
  perform notify_users(v_bu_leads, 'OKR_SESSION_SKIPPED', 'reporting_week', s.reporting_week_id::text,
    'OKR session skipped — your weekly report is still required',
    'The OKR session was not held this week (everyone is recorded as virtually present). Reason: ' || v_reason || '. Please log in, submit your weekly report and enter your performance comment for the week.',
    'skip:' || p_session_id);
  return jsonb_build_object('replayed', false, 'outcome', 'SKIPPED', 'staff_tagged', n, 'operation_ref', v_ref, 'notified_bu_leads', cardinality(v_bu_leads));
end $$;

do $$
declare v_def text; v_old text := '''skip_operation_ref'', s.skip_operation_ref,';
begin
  v_def := pg_get_functiondef('read_session_roster(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'read_session_roster no longer contains the expected line'; end if;
  execute replace(v_def, v_old, v_old || ' ''skip_reason'', s.skip_reason,');
end $$;

do $$
declare v_def text; v_old text := '''summary_required'', v_outcome = ''SKIPPED'',';
begin
  v_def := pg_get_functiondef('read_report_view_base(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'read_report_view_base no longer contains the expected line'; end if;
  execute replace(v_def, v_old, v_old || ' ''skip_reason'', (select gs.skip_reason from governance_sessions gs where gs.reporting_week_id = w.id),');
end $$;

select lock_down_function_grants();

-- Management brief: what the intelligence needs beyond the weekly goals themselves, and a log of what management did about a unit.
--  read_brief_facts   per unit, for a quarter: how tasks were decided (how many in the last two hours before final lock), integrity corrections, late
--                     submissions, attendance, open violations; and the decision queues across the organisation. Read-only, gated to dashboard.executive.view.
--  insight_actions    a note of an action taken for a unit (a call, a coaching session, a change of plan) with the unit's score at the time, so the brief can
--                     show whether the weeks that followed improved.

create or replace function read_brief_facts(p_quarter_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not auth_has_permission('dashboard.executive.view') then return jsonb_build_object('units', '[]'::jsonb, 'queues', '{}'::jsonb); end if;
  return jsonb_build_object(
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_unit_id', b.id,
        'decided_tasks', coalesce(d.decided, 0), 'late_decided_tasks', coalesce(d.late, 0),
        'corrections', coalesce(c.n, 0),
        'submissions', coalesce(s.submitted, 0), 'late_submissions', coalesce(s.late, 0),
        'attendance_present', coalesce(a.present, 0), 'attendance_total', coalesce(a.total, 0),
        'open_violations', coalesce(v.n, 0), 'open_fines', coalesce(v.fines, 0)))
      from business_units b
      left join lateral (
        select count(*)::int decided, count(*) filter (where h.occurred_at >= w.final_lock_at - interval '2 hours' and h.occurred_at <= w.final_lock_at)::int late
        from task_status_history h join tasks t on t.id = h.task_id join smart_goals g on g.id = t.smart_goal_id join weekly_reports r on r.id = g.weekly_report_id
        join reporting_weeks w on w.id = r.reporting_week_id
        where r.business_unit_id = b.id and w.quarter_id = p_quarter_id and h.change_source = 'BU_LEAD_EXECUTION' and w.locks_suspended_at is null and r.late_exception_id is null) d on true
      left join lateral (
        select count(*)::int n from integrity_corrections ic join weekly_reports r on r.id = ic.weekly_report_id join reporting_weeks w on w.id = r.reporting_week_id
        where ic.business_unit_id = b.id and w.quarter_id = p_quarter_id) c on true
      left join lateral (
        select count(*) filter (where r.submission_status = 'SUBMITTED')::int submitted, count(*) filter (where r.submission_status = 'SUBMITTED' and r.submitted_at > w.content_lock_at)::int late
        from weekly_reports r join reporting_weeks w on w.id = r.reporting_week_id where r.business_unit_id = b.id and w.quarter_id = p_quarter_id and w.locks_suspended_at is null and r.late_exception_id is null) s on true
      left join lateral (
        select count(*) filter (where ar.status in ('PRESENT', 'VIRTUAL_PRESENT'))::int present, count(*)::int total
        from attendance_records ar join governance_sessions gs on gs.id = ar.governance_session_id join reporting_weeks w on w.id = gs.reporting_week_id
        where ar.business_unit_id = b.id and w.quarter_id = p_quarter_id) a on true
      left join lateral (
        select count(*)::int n, coalesce(sum(fine_amount), 0) fines from violations vi where vi.business_unit_id = b.id and vi.status = 'OPEN') v on true
      where b.status = 'ACTIVE'), '[]'::jsonb),
    'queues', jsonb_build_object(
      'attendance_amendments', (select jsonb_build_object('waiting', count(*), 'oldest_days', coalesce(max(extract(day from app_now() - requested_at)), 0)) from attendance_amendment_requests where status = 'PENDING'),
      'disbursements', (select jsonb_build_object('waiting', count(*), 'oldest_days', coalesce(max(extract(day from app_now() - created_at)), 0)) from disbursement_requests where status in ('SUBMITTED', 'UNDER_REVIEW')),
      'config_changes', (select jsonb_build_object('waiting', count(*), 'oldest_days', coalesce(max(extract(day from app_now() - created_at)), 0)) from config_change_requests where status = 'PENDING'),
      'late_report_exceptions', (select jsonb_build_object('waiting', count(*), 'oldest_days', coalesce(max(extract(day from app_now() - authorised_at)), 0)) from late_report_exceptions where status = 'AUTHORISED' and weekly_report_id is null)));
end $$;

create table insight_actions (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id),
  quarter_id       uuid not null references quarters(id),
  note             text not null check (btrim(note) <> '' and char_length(note) <= 2000),
  score_before     numeric(5,2),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default app_now()
);
create index insight_actions_unit_idx on insight_actions (business_unit_id, created_at desc);
alter table insight_actions enable row level security;
grant select on insight_actions to authenticated;
create policy read_executive on insight_actions for select to authenticated using (auth_has_permission('dashboard.executive.view'));

create or replace function log_insight_action(p_actor uuid, p_bu uuid, p_quarter uuid, p_note text, p_score_before numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_note text := btrim(coalesce(p_note, ''));
begin
  perform require_permission(p_actor, 'dashboard.executive.view');
  if v_note = '' or char_length(v_note) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'describe the action in up to 2000 characters'; end if;
  if not exists (select 1 from business_units where id = p_bu and status = 'ACTIVE') then raise exception 'NOT_FOUND'; end if;
  insert into insight_actions (business_unit_id, quarter_id, note, score_before, created_by) values (p_bu, p_quarter, v_note, p_score_before, p_actor) returning id into v_id;
  perform write_audit(p_actor, 'INSIGHT_ACTION_LOGGED', 'insight_action', v_id::text, null, jsonb_build_object('business_unit_id', p_bu, 'score_before', p_score_before), v_note, p_bu);
  return v_id;
end $$;

select lock_down_function_grants();

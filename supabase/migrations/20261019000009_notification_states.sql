-- Actionable notifications (ADR-061 follow-up): for the notifications that ask someone to do something, say whether it is STILL waiting
-- or has been dealt with since. The caller only ever sees the state of their OWN notifications, and only a single word per notification,
-- never the underlying record, so this cannot be used to read requests the person has no right to see.

create or replace function safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = public, pg_temp as $$
begin return p::uuid; exception when others then return null; end $$;

create or replace function read_notification_states(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(n.id::text, s.state), '{}'::jsonb)
  from notifications n
  cross join lateral (
    select case
      when n.event_type = 'HOLIDAY_AMENDMENT_REQUESTED' then (select case when r.status = 'PENDING' then 'WAITING' else 'DONE' end from holiday_amendment_requests r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'LEDGER_REVERSAL_REQUESTED'   then (select case when r.status = 'PENDING' then 'WAITING' else 'DONE' end from ledger_reversal_requests r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'LEDGER_REVERSAL_APPROVED'    then (select case when r.status = 'APPROVED' then 'WAITING' else 'DONE' end from ledger_reversal_requests r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'SESSION_CORRECTION_REQUESTED' then (select case when r.status = 'PENDING' then 'WAITING' else 'DONE' end from session_outcome_corrections r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'SESSION_CORRECTION_APPROVED'  then (select case when r.status = 'APPROVED' then 'WAITING' else 'DONE' end from session_outcome_corrections r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'STRATEGY_CHANGE_REQUESTED'   then (select case when r.status = 'PENDING' then 'WAITING' else 'DONE' end from strategy_change_requests r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'DISBURSEMENT_REQUESTED'      then (select case when r.status in ('SUBMITTED','UNDER_REVIEW') then 'WAITING' else 'DONE' end from disbursement_requests r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'ATTENDANCE_AMENDMENT_SUBMITTED' then (select case when r.status = 'PENDING' then 'WAITING' else 'DONE' end from attendance_amendment_requests r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'LATE_REPORT_AUTHORISED'      then (select case when r.status = 'AUTHORISED' then 'WAITING' else 'DONE' end from late_report_exceptions r where r.id = safe_uuid(n.entity_id))
      when n.event_type = 'REPORT_DUE_REMINDER' then (
        select case when app_now() >= w.content_lock_at or exists (
                   select 1 from weekly_reports r join employees e on e.business_unit_id = r.business_unit_id join users u on u.employee_id = e.id
                    where u.id = n.user_id and r.reporting_week_id = w.id and r.submission_status = 'SUBMITTED') then 'DONE' else 'WAITING' end
        from reporting_weeks w where w.id = safe_uuid(n.entity_id))
      else null end as state
  ) s
  where n.id = any(p_ids) and n.user_id = auth.uid() and s.state is not null;
$$;
grant execute on function read_notification_states(uuid[]) to authenticated;

select lock_down_function_grants();

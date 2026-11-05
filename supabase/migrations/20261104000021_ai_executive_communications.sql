-- 4COREPAL phase 6: what the executive centre counts, what the communication centre shows, and the audit of report exports.
-- Read-only except ai_log_report, which writes one audit line (no content). Counts are invoker functions: row-level security has already narrowed what each person can count.

create or replace function read_ai_executive_counts() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'cases', (select jsonb_build_object(
        'open', count(*) filter (where status not in ('RESOLVED', 'CLOSED')),
        'highOpen', count(*) filter (where severity in ('HIGH', 'CRITICAL') and status not in ('RESOLVED', 'CLOSED')),
        'escalated', count(*) filter (where status = 'ESCALATED'),
        'awaitingResponse', count(*) filter (where status in ('OPEN', 'AWAITING_RESPONSE') and responded_at is null),
        'overdueResponse', count(*) filter (where status not in ('RESOLVED', 'CLOSED') and responded_at is null and response_due_at < app_now()),
        'resolvedLast30', count(*) filter (where status in ('RESOLVED', 'CLOSED') and closed_at >= app_now() - interval '30 days')) from ai_cases),
    'remarkRequests', (select jsonb_build_object(
        'open', count(*) filter (where status in ('PENDING', 'PARTIAL', 'ESCALATED')),
        'overdue', count(*) filter (where status in ('PENDING', 'PARTIAL', 'ESCALATED') and due_at < app_now()),
        'escalated', count(*) filter (where status = 'ESCALATED')) from ai_remark_requests),
    'closureRequests', (select jsonb_build_object(
        'open', count(*) filter (where status in ('PENDING', 'PARTIAL', 'ESCALATED')),
        'overdue', count(*) filter (where status in ('PENDING', 'PARTIAL', 'ESCALATED') and due_at < app_now())) from ai_closure_requests),
    'awaitingClosureConfirmation', (select count(*) from ai_dispositions where status = 'PROPOSED'),
    'approvalsPending', (select count(*) from ai_approvals where status = 'PENDING'),
    'plans', (select jsonb_build_object(
        'inProgress', count(*) filter (where status = 'IN_PROGRESS'),
        'proposed', count(*) filter (where status in ('DRAFT', 'PROPOSED')),
        'improved', count(*) filter (where effectiveness = 'IMPROVED'),
        'noChange', count(*) filter (where effectiveness = 'NO_CHANGE'),
        'worse', count(*) filter (where effectiveness = 'WORSE'),
        'insufficientData', count(*) filter (where effectiveness = 'INSUFFICIENT_DATA')) from ai_corrective_plans),
    'unresolvedTasks', (select count(*) from tasks t join smart_goals g on g.id = t.smart_goal_id and g.deleted_at is null join weekly_reports r on r.id = g.weekly_report_id
                          join reporting_weeks w on w.id = r.reporting_week_id and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
                         where t.deleted_at is null and t.status <> 'DONE' and w.week_start_at >= app_now() - interval '56 days'),
    'newFindings', (select count(*) from ai_findings where state = 'NEW'),
    'communications', (select jsonb_build_object(
        'sentLast7', count(*) filter (where created_at >= app_now() - interval '7 days'),
        'awaitingResponse', count(*) filter (where follow_up_status = 'PENDING'),
        'unanswered3Days', count(*) filter (where follow_up_status = 'PENDING' and created_at < app_now() - interval '3 days')) from ai_communications)
  );
$$;

-- every message the agent sent, with how the email half went. A security-definer read so the email outbox, which no client may read, can be joined for status only.
-- Scope: the whole organisation for ai.insights.org, otherwise the person's own unit. Names only: no email address leaves the function.
create or replace function read_ai_communications(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org boolean; v_bu uuid;
begin
  if not auth_has_permission('ai.communication.view') then return '[]'::jsonb; end if;
  v_org := auth_has_permission('ai.insights.org'); v_bu := auth_bu();
  if not v_org and (v_bu is null or not auth_has_permission('ai.insights.bu')) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'createdAt') desc) from (
      select jsonb_build_object('id', c.id, 'kind', c.kind, 'channel', c.channel, 'subject', c.subject, 'createdAt', c.created_at,
        'recipient', coalesce(e.first_name || ' ' || e.last_name, 'Unknown'), 'unit', b.name, 'caseId', c.case_id, 'remarkRequestId', c.remark_request_id,
        'inApp', c.delivery_status, 'email', coalesce(o.status, 'NOT_EMAILED'), 'emailAttempts', coalesce(o.attempts, 0),
        'acknowledgedAt', c.acknowledged_at, 'respondedAt', c.responded_at, 'followUp', c.follow_up_status) x
        from ai_communications c
        left join users u on u.id = c.recipient_user_id left join employees e on e.id = u.employee_id
        left join business_units b on b.id = c.business_unit_id
        left join email_outbox o on o.notification_id = c.notification_id
       where v_org or c.business_unit_id = v_bu
       order by c.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) q), '[]'::jsonb);
end $$;

-- one audit line when a report is produced for export: who, which report, which format. Never its content.
create or replace function ai_log_report(p_actor uuid, p_report text, p_format text, p_scope text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'ai.report.export');
  if not ai_enabled() then raise exception 'AI_DISABLED'; end if;
  if p_format not in ('csv', 'print') then raise exception 'VALIDATION_ERROR' using detail = 'format'; end if;
  perform write_audit(p_actor, 'AI_REPORT_EXPORTED', 'ai_report', left(p_report, 80), null, jsonb_build_object('format', p_format, 'scope', left(coalesce(p_scope, ''), 80)));
end $$;
select lock_down_function_grants();

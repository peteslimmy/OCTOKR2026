-- 4COREPAL, phase 2: the foundation of the AI Performance Agent module (docs/38-4COREPAL-DESIGN.md).
--
-- Additive only. Nothing existing is altered: no existing table, column, function, policy or permission changes. Everything here is prefixed ai_.
-- Rules this migration builds in:
--  * The module is OFF until a Super Admin turns it on (ai_settings 'enabled', default false). Nothing here runs or sends anything while it is off.
--  * Ownership is the business unit (a BU is a department; no assignee). Tasks are due at the end of their week. Remarks are separate rows that never touch a task.
--  * Reads go through row-level security; writes go only through the SECURITY DEFINER functions below (service role), never through a client.
--  * Actions the agent may take are DATA (ai_action_policies). HIGH-impact actions can never be automatic: a check constraint holds them to NEEDS_APPROVAL or DISABLED.
--  * Records that show what the agent did (case events, remarks, usage) cannot be changed or deleted.

-- ------------------------------------------------------------------ permissions (additive; existing roles are not changed)
insert into permissions (code, description, protected, reserved, module, risk) values
  ('ai.assistant.use',        '4COREPAL: use the assistant', false, false, 'AI Performance Agent', 'low'),
  ('ai.insights.own',         '4COREPAL: see insights about your own work', false, false, 'AI Performance Agent', 'low'),
  ('ai.insights.bu',          '4COREPAL: see insights about your own business unit', false, false, 'AI Performance Agent', 'low'),
  ('ai.insights.org',         '4COREPAL: see insights about every business unit and the organisation', false, false, 'AI Performance Agent', 'medium'),
  ('ai.remark.submit',        '4COREPAL: give remarks on your business unit''s unresolved tasks', false, false, 'AI Performance Agent', 'low'),
  ('ai.case.view',            '4COREPAL: view performance intelligence cases', false, false, 'AI Performance Agent', 'low'),
  ('ai.case.manage',          '4COREPAL: open, update, escalate and close cases', false, false, 'AI Performance Agent', 'medium'),
  ('ai.action.assign',        '4COREPAL: assign corrective actions', false, false, 'AI Performance Agent', 'medium'),
  ('ai.approval.decide',      '4COREPAL: approve or reject what the agent proposes', true, true, 'AI Performance Agent', 'critical'),
  ('ai.escalation.manage',    '4COREPAL: set escalation policies', true, false, 'AI Performance Agent', 'critical'),
  ('ai.communication.view',   '4COREPAL: view the communication history', false, false, 'AI Performance Agent', 'medium'),
  ('ai.communication.manage', '4COREPAL: manage the agent''s communications', false, false, 'AI Performance Agent', 'medium'),
  ('ai.knowledge.manage',     '4COREPAL: manage organisational knowledge sources', false, false, 'AI Performance Agent', 'medium'),
  ('ai.config.manage',        '4COREPAL: switch the module on or off and set its configuration', true, true, 'AI Performance Agent', 'critical'),
  ('ai.schedule.manage',      '4COREPAL: set monitoring schedules', false, false, 'AI Performance Agent', 'medium'),
  ('ai.audit.view',           '4COREPAL: view the agent''s audit and execution history', false, false, 'AI Performance Agent', 'medium'),
  ('ai.report.export',        '4COREPAL: export the agent''s reports', false, false, 'AI Performance Agent', 'medium');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('BU_LEAD','ai.assistant.use'), ('BU_LEAD','ai.insights.own'), ('BU_LEAD','ai.insights.bu'), ('BU_LEAD','ai.remark.submit'), ('BU_LEAD','ai.case.view'),
  ('PRESENTER','ai.insights.own'),
  ('EXECUTIVE','ai.assistant.use'), ('EXECUTIVE','ai.insights.own'), ('EXECUTIVE','ai.insights.org'), ('EXECUTIVE','ai.case.view'), ('EXECUTIVE','ai.communication.view'), ('EXECUTIVE','ai.report.export'),
  ('DIRECTOR','ai.assistant.use'), ('DIRECTOR','ai.insights.own'), ('DIRECTOR','ai.insights.org'), ('DIRECTOR','ai.case.view'), ('DIRECTOR','ai.communication.view'), ('DIRECTOR','ai.report.export'),
  ('ADMIN','ai.assistant.use'), ('ADMIN','ai.insights.own'), ('ADMIN','ai.insights.org'), ('ADMIN','ai.case.view'), ('ADMIN','ai.case.manage'), ('ADMIN','ai.communication.view'), ('ADMIN','ai.audit.view'), ('ADMIN','ai.report.export'),
  ('SUPER_ADMIN','ai.assistant.use'), ('SUPER_ADMIN','ai.insights.own'), ('SUPER_ADMIN','ai.insights.bu'), ('SUPER_ADMIN','ai.insights.org'),
  ('SUPER_ADMIN','ai.case.view'), ('SUPER_ADMIN','ai.case.manage'), ('SUPER_ADMIN','ai.action.assign'), ('SUPER_ADMIN','ai.approval.decide'), ('SUPER_ADMIN','ai.escalation.manage'),
  ('SUPER_ADMIN','ai.communication.view'), ('SUPER_ADMIN','ai.communication.manage'), ('SUPER_ADMIN','ai.knowledge.manage'), ('SUPER_ADMIN','ai.config.manage'),
  ('SUPER_ADMIN','ai.schedule.manage'), ('SUPER_ADMIN','ai.audit.view'), ('SUPER_ADMIN','ai.report.export')
) v(role_code, perm) join roles r on r.code = v.role_code join permissions p on p.code = v.perm;

-- ------------------------------------------------------------------ configuration
-- Each setting has a kind; the function that changes one checks the value against it. A new setting is a new row, not new code.
create table ai_settings (
  key         text primary key,
  value       jsonb not null,
  kind        text not null check (kind in ('boolean', 'number', 'string')),
  label       text not null,
  help        text,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default app_now(),
  check (jsonb_typeof(value) = kind)
);
insert into ai_settings (key, value, kind, label, help) values
  ('enabled',                    'false', 'boolean', 'Module enabled', 'Off until a Super Admin turns it on. While off, nothing monitors, sends or answers.'),
  ('execute_enabled',            'false', 'boolean', 'Allow the agent to execute approved changes (level 5)', 'Even when on, high-impact changes need an approval from a person other than the proposer.'),
  ('pseudonymise_prompts',       'true',  'boolean', 'Replace names with codes before text goes to the AI provider', 'Real names are restored only for people allowed to see them.'),
  ('timezone',                   '"Africa/Lagos"', 'string', 'Time zone for schedules', 'Matches the application calendar.'),
  ('schedule_daily_time',        '"07:00"', 'string', 'Daily monitoring time (HH:MM)', null),
  ('schedule_weekly_day',        '"MON"',   'string', 'Weekly monitoring day (MON to SUN)', null),
  ('schedule_weekly_time',       '"07:30"', 'string', 'Weekly monitoring time (HH:MM)', null),
  ('schedule_monthly_time',      '"08:00"', 'string', 'Monthly closure review time on the last day of the month (HH:MM)', null),
  ('remark_deadline_days',       '3',  'number', 'Days a BU Lead has to give task remarks', 'Counted from the request.'),
  ('remark_reminder_days',       '2',  'number', 'Days before the one reminder is sent', 'Counted from the request; no reminder once the request is answered.'),
  ('remark_escalate_days',       '5',  'number', 'Days before an unanswered request goes to executives', null),
  ('carry_over_weeks_threshold', '3',  'number', 'Weeks a goal must be repeated unfinished before it is flagged', null),
  ('inactive_weeks_threshold',   '4',  'number', 'Weeks without any status change before an unfinished goal is called inactive', null),
  ('daily_cost_ceiling_usd',     '5',  'number', 'Daily ceiling for AI provider spend (USD)', 'New requests are refused for the day once it is reached.'),
  ('user_rate_limit_per_hour',   '60', 'number', 'Assistant questions per person per hour', null),
  ('request_timeout_seconds',    '30', 'number', 'Timeout for one AI provider request', null),
  ('max_retries',                '2',  'number', 'Retries for a failed AI provider request or job', null),
  ('retention_days_messages',    '365','number', 'Days conversation messages are kept', null);
alter table ai_settings enable row level security;
grant select on ai_settings to authenticated;
create policy read_config on ai_settings for select to authenticated using ((select auth_has_permission('ai.config.manage')));

-- What the agent may do, by action type and risk. HIGH-impact actions are never automatic.
create table ai_action_policies (
  action_type text primary key,
  risk        text not null check (risk in ('LOW', 'MEDIUM', 'HIGH')),
  mode        text not null check (mode in ('AUTO', 'NEEDS_APPROVAL', 'DISABLED')),
  label       text not null,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default app_now(),
  constraint high_never_auto check (risk <> 'HIGH' or mode in ('NEEDS_APPROVAL', 'DISABLED'))
);
insert into ai_action_policies (action_type, risk, mode, label) values
  ('GENERATE_REPORT',           'LOW',    'AUTO',           'Generate a report'),
  ('CREATE_FINDING',            'LOW',    'AUTO',           'Record a monitoring finding'),
  ('OPEN_CASE',                 'LOW',    'AUTO',           'Open a performance intelligence case'),
  ('REQUEST_REMARK',            'LOW',    'AUTO',           'Ask a BU Lead for remarks on unresolved tasks'),
  ('REQUEST_EXPLANATION',       'LOW',    'AUTO',           'Ask a BU Lead for an explanation'),
  ('SEND_REMINDER',             'LOW',    'AUTO',           'Send an approved reminder'),
  ('SCHEDULE_FOLLOWUP',         'LOW',    'AUTO',           'Schedule a follow-up'),
  ('CREATE_CORRECTIVE_ACTION',  'MEDIUM', 'NEEDS_APPROVAL', 'Create a corrective action'),
  ('PROPOSE_ACTIVITY_CHANGE',   'MEDIUM', 'NEEDS_APPROVAL', 'Propose a change to an activity'),
  ('PROPOSE_DEADLINE',          'MEDIUM', 'NEEDS_APPROVAL', 'Propose a revised deadline'),
  ('ASSIGN_FOLLOWUP_OWNER',     'MEDIUM', 'NEEDS_APPROVAL', 'Assign a follow-up to a business unit'),
  ('START_INTERVENTION',        'MEDIUM', 'NEEDS_APPROVAL', 'Start an intervention with a business unit'),
  ('CHANGE_GOAL',               'HIGH',   'NEEDS_APPROVAL', 'Change an approved goal'),
  ('CHANGE_KR_TARGET',          'HIGH',   'NEEDS_APPROVAL', 'Change a Key Result target'),
  ('MODIFY_SCORE',              'HIGH',   'NEEDS_APPROVAL', 'Modify an official performance score'),
  ('CHANGE_HISTORY',            'HIGH',   'NEEDS_APPROVAL', 'Change a historical performance record'),
  ('REASSIGN_OWNERSHIP',        'HIGH',   'NEEDS_APPROVAL', 'Reassign ownership of a commitment'),
  ('CANCEL_COMMITMENT',         'HIGH',   'NEEDS_APPROVAL', 'Cancel a strategic commitment'),
  ('EMPLOYEE_DECISION',         'HIGH',   'NEEDS_APPROVAL', 'Make a formal employee performance decision');
alter table ai_action_policies enable row level security;
grant select on ai_action_policies to authenticated;
create policy read_policies on ai_action_policies for select to authenticated using ((select auth_has_permission('ai.config.manage')) or (select auth_has_permission('ai.audit.view')));

-- Who is told, and when, as a case of a given severity goes unanswered. BU Lead first, then executives; a critical case goes to both at once.
create table ai_escalation_policies (
  severity    text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  step        int  not null check (step between 1 and 5),
  audience    text not null check (audience in ('BU_LEAD', 'AFFECTED_BU_LEADS', 'EXECUTIVES')),
  after_hours int  not null check (after_hours between 0 and 720),
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default app_now(),
  primary key (severity, step)
);
insert into ai_escalation_policies (severity, step, audience, after_hours) values
  ('LOW', 1, 'BU_LEAD', 0), ('LOW', 2, 'EXECUTIVES', 168),
  ('MEDIUM', 1, 'BU_LEAD', 0), ('MEDIUM', 2, 'EXECUTIVES', 96),
  ('HIGH', 1, 'BU_LEAD', 0), ('HIGH', 2, 'EXECUTIVES', 48),
  ('CRITICAL', 1, 'BU_LEAD', 0), ('CRITICAL', 2, 'EXECUTIVES', 0);
alter table ai_escalation_policies enable row level security;
grant select on ai_escalation_policies to authenticated;
create policy read_escalation on ai_escalation_policies for select to authenticated using ((select auth_has_permission('ai.config.manage')) or (select auth_has_permission('ai.escalation.manage')) or (select auth_has_permission('ai.audit.view')));

-- ------------------------------------------------------------------ conversations
create table ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  title      text not null default 'New conversation' check (char_length(title) <= 200),
  created_at timestamptz not null default app_now(),
  updated_at timestamptz not null default app_now()
);
create index ai_conversations_user_idx on ai_conversations (user_id, updated_at desc);
create table ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) <= 20000),
  tool_calls      jsonb not null default '[]'::jsonb,
  sources         jsonb not null default '[]'::jsonb,   -- the records an answer rests on, each with its reporting period and a link
  model           text,
  created_at      timestamptz not null default app_now()
);
create index ai_messages_conv_idx on ai_messages (conversation_id, created_at);
create trigger ai_messages_immutable before update on ai_messages for each row execute function forbid_mutation();
alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
grant select on ai_conversations, ai_messages to authenticated;
create policy own_conversations on ai_conversations for select to authenticated using (user_id = (select auth.uid()));
create policy own_messages on ai_messages for select to authenticated using (exists (select 1 from ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));

-- ------------------------------------------------------------------ findings and cases
create table ai_findings (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (char_length(kind) between 1 and 60),
  business_unit_id uuid references business_units(id),
  reporting_week_id uuid references reporting_weeks(id),
  quarter_id       uuid references quarters(id),
  severity         text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  summary          text not null check (char_length(summary) <= 2000),
  evidence         jsonb not null default '{}'::jsonb,
  fingerprint      text not null unique,                  -- the same observation on a rerun is the same finding
  state            text not null default 'NEW' check (state in ('NEW', 'ACKNOWLEDGED', 'CASE_OPENED', 'DISMISSED', 'RESOLVED')),
  detected_at      timestamptz not null default app_now(),
  updated_at       timestamptz not null default app_now()
);
create index ai_findings_bu_idx on ai_findings (business_unit_id, detected_at desc);
create sequence ai_case_seq;
create table ai_cases (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique default ('PIC-' || to_char(app_now(), 'YYYY') || '-' || lpad(nextval('ai_case_seq')::text, 6, '0')),
  title            text not null check (char_length(btrim(title)) between 1 and 300),
  category         text not null check (category in ('MISSED_COMMITMENTS', 'REPEATED_DELAYS', 'UNDERPERFORMING_KR', 'UNDERPERFORMING_BU', 'REPORTING_NON_COMPLIANCE',
                     'CROSS_BU_DEPENDENCY', 'RESOURCE_CONSTRAINT', 'STRATEGIC_OBJECTIVE_AT_RISK', 'INACTIVE_ACTIVITY', 'OTHER')),
  description      text not null default '' check (char_length(description) <= 8000),
  business_unit_id uuid references business_units(id),     -- null for an organisation-wide case
  smart_goal_id    uuid references smart_goals(id),
  task_id          uuid references tasks(id),
  sub_key_result_id uuid references sub_key_results(id),
  finding_id       uuid references ai_findings(id),
  fingerprint      text unique,
  severity         text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  risk_level       text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  assessment       text not null default '' check (char_length(assessment) <= 8000),
  hypotheses       jsonb not null default '[]'::jsonb,       -- each one labelled hypothesis or confirmed, with its evidence
  recommendation   text not null default '' check (char_length(recommendation) <= 8000),
  assigned_bu_id   uuid references business_units(id),
  oversight_user_id uuid references users(id),
  response_due_at  timestamptz,
  status           text not null default 'OPEN' check (status in ('OPEN', 'UNDER_INVESTIGATION', 'AWAITING_RESPONSE', 'INTERVENTION_REQUIRED', 'CORRECTIVE_ACTION_IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED')),
  resolution       text check (resolution is null or char_length(resolution) <= 8000),
  detected_at      timestamptz not null default app_now(),
  closed_at        timestamptz,
  created_by       uuid references users(id),                -- null when the agent opened it
  created_by_agent boolean not null default true,
  updated_at       timestamptz not null default app_now(),
  check ((status in ('RESOLVED', 'CLOSED')) = (closed_at is not null) or status = 'RESOLVED')
);
create index ai_cases_bu_idx on ai_cases (business_unit_id, status);
create table ai_case_evidence (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references ai_cases(id) on delete cascade,
  kind              text not null check (kind in ('WEEKLY_REPORT', 'GOAL', 'TASK', 'STATUS_HISTORY', 'REMARK', 'SCORE', 'COMMENT', 'OTHER')),
  ref_table         text,
  ref_id            text,
  reporting_week_id uuid references reporting_weeks(id),
  summary           text not null check (char_length(summary) <= 2000),
  captured_value    jsonb,                                     -- the figure as it was when the case was opened
  captured_at       timestamptz not null default app_now()
);
create index ai_case_evidence_case_idx on ai_case_evidence (case_id);
create table ai_case_events (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references ai_cases(id) on delete cascade,
  event_type    text not null check (event_type in ('CREATED', 'COMMUNICATION', 'RESPONSE', 'APPROVAL', 'ESCALATION', 'STATUS_CHANGE', 'ACTION', 'NOTE')),
  actor_user_id uuid references users(id),
  by_agent      boolean not null default false,
  detail        jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default app_now()
);
create index ai_case_events_case_idx on ai_case_events (case_id, occurred_at);
create trigger ai_case_events_immutable before update or delete on ai_case_events for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ remarks on unresolved tasks
create table ai_remark_requests (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references business_units(id),
  reporting_week_id uuid not null references reporting_weeks(id),
  task_count        int  not null check (task_count > 0),
  status            text not null default 'PENDING' check (status in ('PENDING', 'PARTIAL', 'ANSWERED', 'ESCALATED', 'EXPIRED')),
  requested_at      timestamptz not null default app_now(),
  due_at            timestamptz not null,
  reminded_at       timestamptz,
  escalated_at      timestamptz,
  answered_at       timestamptz,
  unique (business_unit_id, reporting_week_id)              -- one batched request per unit and week, however often the job runs
);
create index ai_remark_requests_open_idx on ai_remark_requests (status, due_at) where status in ('PENDING', 'PARTIAL', 'ESCALATED');
create table ai_task_remarks (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references ai_remark_requests(id) on delete cascade,
  task_id          uuid not null references tasks(id),
  business_unit_id uuid not null references business_units(id),
  reason_code      text not null check (reason_code in ('EXECUTION', 'RESOURCES', 'DEPENDENCY', 'AWAITING_DECISION', 'PRIORITY_CHANGE', 'UNREALISTIC_TIMELINE', 'TECHNICAL', 'COMPLETED_NOT_RECORDED', 'OTHER')),
  remark           text not null default '' check (char_length(remark) <= 2000),
  author_user_id   uuid not null references users(id),
  created_at       timestamptz not null default app_now(),
  unique (request_id, task_id)
);
create index ai_task_remarks_task_idx on ai_task_remarks (task_id);
create trigger ai_task_remarks_immutable before update or delete on ai_task_remarks for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ monthly closure responses
create table ai_dispositions (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id),
  subject_type     text not null check (subject_type in ('GOAL', 'TASK')),
  subject_id       uuid not null,
  option_code      text not null check (option_code in ('COMPLETED_NOT_RECORDED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'STEPPED_DOWN', 'NO_LONGER_REQUIRED', 'DEFERRED', 'BLOCKED', 'SCOPE_CHANGED')),
  explanation      text not null default '' check (char_length(explanation) <= 4000),
  evidence_note    text check (evidence_note is null or char_length(evidence_note) <= 2000),
  revised_commitment jsonb,
  related_subject_id uuid,                                    -- where a step-down points: the original stays linked
  case_id          uuid references ai_cases(id),
  status           text not null default 'PROPOSED' check (status in ('PROPOSED', 'APPROVED', 'REJECTED', 'APPLIED', 'WITHDRAWN')),
  proposed_by      uuid not null references users(id),
  proposed_at      timestamptz not null default app_now(),
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision_note    text,
  check (decided_by is null or decided_by <> proposed_by)     -- nobody approves their own proposal
);
create index ai_dispositions_subject_idx on ai_dispositions (subject_type, subject_id);

-- ------------------------------------------------------------------ corrective actions
create table ai_corrective_plans (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid not null references ai_cases(id),
  problem              text not null check (char_length(problem) <= 4000),
  evidence             text not null default '' check (char_length(evidence) <= 4000),
  root_cause_assessment text not null default '' check (char_length(root_cause_assessment) <= 4000),
  intervention         text not null check (char_length(intervention) <= 4000),
  expected_outcome     text not null default '' check (char_length(expected_outcome) <= 2000),
  owner_bu_id          uuid references business_units(id),
  supporting_bu_ids    uuid[] not null default '{}',
  target_date          date,
  success_measure      text not null default '' check (char_length(success_measure) <= 1000),
  review_date          date,
  status               text not null default 'DRAFT' check (status in ('DRAFT', 'PROPOSED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  baseline_score       numeric(5,2),
  review_score         numeric(5,2),
  effectiveness        text check (effectiveness in ('IMPROVED', 'NO_CHANGE', 'WORSE', 'INSUFFICIENT_DATA')),   -- judged on the later score, not on a tick
  created_by           uuid references users(id),
  created_by_agent     boolean not null default true,
  created_at           timestamptz not null default app_now(),
  updated_at           timestamptz not null default app_now()
);
create table ai_corrective_actions (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references ai_corrective_plans(id) on delete cascade,
  description  text not null check (char_length(btrim(description)) between 1 and 2000),
  owner_bu_id  uuid references business_units(id),
  due_date     date,
  status       text not null default 'OPEN' check (status in ('OPEN', 'DONE', 'BLOCKED', 'CANCELLED')),
  completed_at timestamptz,
  note         text check (note is null or char_length(note) <= 2000),
  created_at   timestamptz not null default app_now()
);

-- ------------------------------------------------------------------ communications and approvals
create table ai_communications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references users(id),
  channel           text not null check (channel in ('IN_APP', 'EMAIL')),
  kind              text not null check (kind in ('ALERT', 'WEEKLY_SUMMARY', 'REMINDER', 'CLOSURE_REQUEST', 'REMARK_REQUEST', 'CORRECTIVE_ACTION', 'ESCALATION', 'REPORT', 'APPROVAL_REQUEST', 'FOLLOW_UP')),
  subject           text not null check (char_length(subject) <= 300),
  body              text not null check (char_length(body) <= 8000),
  case_id           uuid references ai_cases(id),
  remark_request_id uuid references ai_remark_requests(id),
  business_unit_id  uuid references business_units(id),
  reporting_week_id uuid references reporting_weeks(id),
  notification_id   uuid references notifications(id),       -- the in-app message, and through the outbox the email, this record tracks
  delivery_status   text not null default 'QUEUED' check (delivery_status in ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  acknowledged_at   timestamptz,
  response          text check (response is null or char_length(response) <= 4000),
  responded_at      timestamptz,
  follow_up_status  text not null default 'NONE' check (follow_up_status in ('NONE', 'PENDING', 'DONE')),
  dedupe_key        text not null,
  created_at        timestamptz not null default app_now(),
  unique (recipient_user_id, channel, dedupe_key)              -- the same message is never sent twice
);
create index ai_communications_case_idx on ai_communications (case_id);
create index ai_communications_open_idx on ai_communications (follow_up_status, created_at) where follow_up_status = 'PENDING';

create table ai_approvals (
  id            uuid primary key default gen_random_uuid(),
  action_type   text not null references ai_action_policies(action_type),
  subject_type  text not null,
  subject_id    text,
  proposal      jsonb not null,
  case_id       uuid references ai_cases(id),
  requested_by  uuid references users(id),                     -- null when the agent proposed it
  by_agent      boolean not null default true,
  status        text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED')),
  decided_by    uuid references users(id),
  decided_at    timestamptz,
  decision_note text,
  executed_at   timestamptz,
  created_at    timestamptz not null default app_now(),
  check (requested_by is null or decided_by is null or requested_by <> decided_by)
);
create index ai_approvals_open_idx on ai_approvals (status, created_at) where status = 'PENDING';

-- ------------------------------------------------------------------ jobs and usage
create table ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  idempotency_key text not null unique,                        -- e.g. daily:2026-11-04; a rerun of the same period does nothing twice
  status        text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD')),
  attempts      int not null default 0,
  max_attempts  int not null default 3,
  scheduled_for timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  error         text,
  result        jsonb
);
create index ai_jobs_status_idx on ai_jobs (status, scheduled_for);
create table ai_usage (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id),
  conversation_id uuid references ai_conversations(id) on delete set null,
  purpose         text not null,
  provider        text not null,
  model           text not null,
  input_tokens    int not null default 0 check (input_tokens >= 0),
  output_tokens   int not null default 0 check (output_tokens >= 0),
  cost_usd        numeric(10,6) not null default 0 check (cost_usd >= 0),
  latency_ms      int,
  outcome         text not null check (outcome in ('OK', 'ERROR', 'TIMEOUT', 'BLOCKED')),
  occurred_at     timestamptz not null default app_now()
);
create index ai_usage_day_idx on ai_usage (occurred_at);
create trigger ai_usage_immutable before update or delete on ai_usage for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ row-level security: read only; every write is through a function
-- Scope: the whole organisation for ai.insights.org, otherwise the person's own business unit for ai.insights.bu.
alter table ai_findings enable row level security;
alter table ai_cases enable row level security;
alter table ai_case_evidence enable row level security;
alter table ai_case_events enable row level security;
alter table ai_remark_requests enable row level security;
alter table ai_task_remarks enable row level security;
alter table ai_dispositions enable row level security;
alter table ai_corrective_plans enable row level security;
alter table ai_corrective_actions enable row level security;
alter table ai_communications enable row level security;
alter table ai_approvals enable row level security;
alter table ai_jobs enable row level security;
alter table ai_usage enable row level security;
grant select on ai_findings, ai_cases, ai_case_evidence, ai_case_events, ai_remark_requests, ai_task_remarks, ai_dispositions, ai_corrective_plans, ai_corrective_actions,
                ai_communications, ai_approvals, ai_jobs, ai_usage to authenticated;

create policy read_scope on ai_findings for select to authenticated using ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and business_unit_id = (select auth_bu())));
create policy read_scope on ai_cases for select to authenticated using ((select auth_has_permission('ai.case.view')) and ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and (business_unit_id = (select auth_bu()) or assigned_bu_id = (select auth_bu())))));
create policy read_scope on ai_case_evidence for select to authenticated using (exists (select 1 from ai_cases c where c.id = case_id));      -- as visible as the case itself
create policy read_scope on ai_case_events for select to authenticated using (exists (select 1 from ai_cases c where c.id = case_id));
create policy read_scope on ai_remark_requests for select to authenticated using ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and business_unit_id = (select auth_bu())));
create policy read_scope on ai_task_remarks for select to authenticated using ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and business_unit_id = (select auth_bu())));
create policy read_scope on ai_dispositions for select to authenticated using ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and business_unit_id = (select auth_bu())));
create policy read_scope on ai_corrective_plans for select to authenticated using (exists (select 1 from ai_cases c where c.id = case_id));
create policy read_scope on ai_corrective_actions for select to authenticated using (exists (select 1 from ai_corrective_plans p where p.id = plan_id));
create policy read_scope on ai_communications for select to authenticated using (recipient_user_id = (select auth.uid())
  or ((select auth_has_permission('ai.communication.view')) and ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and business_unit_id = (select auth_bu())))));
create policy read_scope on ai_approvals for select to authenticated using (requested_by = (select auth.uid()) or (select auth_has_permission('ai.approval.decide')) or (select auth_has_permission('ai.audit.view')));
create policy read_audit on ai_jobs for select to authenticated using ((select auth_has_permission('ai.audit.view')) or (select auth_has_permission('ai.config.manage')));
create policy read_audit on ai_usage for select to authenticated using ((select auth_has_permission('ai.audit.view')) or (select auth_has_permission('ai.config.manage')) or user_id = (select auth.uid()));

-- ------------------------------------------------------------------ functions (service role only unless named read_*)
create or replace function ai_enabled() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value)::text = 'true' from ai_settings where key = 'enabled'), false);
$$;

create or replace function ai_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select value from ai_settings where key = p_key;
$$;

-- What the screen needs to decide whether to show the module at all, without leaking configuration.
create or replace function read_ai_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'enabled', ai_enabled(),
    'canUse', ai_enabled() and exists (select 1 from permissions p where p.code like 'ai.%' and auth_has_permission(p.code))
  );
$$;

create or replace function ai_set_setting(p_actor uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old jsonb; v_kind text;
begin
  perform require_permission(p_actor, 'ai.config.manage');
  select value, kind into v_old, v_kind from ai_settings where key = p_key;
  if v_kind is null then raise exception 'NOT_FOUND' using detail = 'unknown setting'; end if;
  if jsonb_typeof(p_value) <> v_kind then raise exception 'VALIDATION_ERROR' using detail = 'the value must be a ' || v_kind; end if;
  if v_kind = 'number' and (p_value)::text::numeric < 0 then raise exception 'VALIDATION_ERROR' using detail = 'the value cannot be negative'; end if;
  update ai_settings set value = p_value, updated_by = p_actor, updated_at = app_now() where key = p_key;
  perform write_audit(p_actor, 'AI_SETTING_CHANGED', 'ai_setting', p_key, jsonb_build_object('value', v_old), jsonb_build_object('value', p_value));
end $$;

create or replace function ai_set_policy(p_actor uuid, p_action text, p_mode text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text; v_risk text;
begin
  perform require_permission(p_actor, 'ai.config.manage');
  select mode, risk into v_old, v_risk from ai_action_policies where action_type = p_action;
  if v_risk is null then raise exception 'NOT_FOUND' using detail = 'unknown action'; end if;
  if p_mode not in ('AUTO', 'NEEDS_APPROVAL', 'DISABLED') then raise exception 'VALIDATION_ERROR' using detail = 'unknown mode'; end if;
  if v_risk = 'HIGH' and p_mode = 'AUTO' then raise exception 'VALIDATION_ERROR' using detail = 'a high-impact action can never be automatic'; end if;
  update ai_action_policies set mode = p_mode, updated_by = p_actor, updated_at = app_now() where action_type = p_action;
  perform write_audit(p_actor, 'AI_POLICY_CHANGED', 'ai_action_policy', p_action, jsonb_build_object('mode', v_old), jsonb_build_object('mode', p_mode));
end $$;

-- Whether the agent may do something now: the module is on and the policy for that action is not DISABLED. Returns the mode (AUTO or NEEDS_APPROVAL) or null.
create or replace function ai_action_mode(p_action text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when ai_enabled() then (select mode from ai_action_policies where action_type = p_action and mode <> 'DISABLED') end;
$$;

-- A job may run once for a period: this says whether this call should do the work.
create or replace function ai_job_begin(p_kind text, p_key text, p_for timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j ai_jobs; v_max int := coalesce((select (value)::text::int from ai_settings where key = 'max_retries'), 2) + 1;
begin
  insert into ai_jobs (kind, idempotency_key, scheduled_for, max_attempts) values (p_kind, p_key, p_for, v_max) on conflict (idempotency_key) do nothing;
  select * into j from ai_jobs where idempotency_key = p_key for update;
  if j.status in ('SUCCEEDED', 'RUNNING', 'DEAD') or (j.status = 'RUNNING') then return jsonb_build_object('id', j.id, 'run', false, 'status', j.status); end if;
  if j.attempts >= j.max_attempts then update ai_jobs set status = 'DEAD' where id = j.id; return jsonb_build_object('id', j.id, 'run', false, 'status', 'DEAD'); end if;
  update ai_jobs set status = 'RUNNING', attempts = attempts + 1, started_at = clock_timestamp(), error = null where id = j.id;
  return jsonb_build_object('id', j.id, 'run', true, 'status', 'RUNNING');
end $$;

create or replace function ai_job_finish(p_id uuid, p_ok boolean, p_error text default null, p_result jsonb default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j ai_jobs;
begin
  select * into j from ai_jobs where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update ai_jobs set finished_at = clock_timestamp(), result = p_result, error = case when p_ok then null else left(coalesce(p_error, 'failed'), 2000) end,
    status = case when p_ok then 'SUCCEEDED' when j.attempts >= j.max_attempts then 'DEAD' else 'FAILED' end where id = p_id;
end $$;

-- One row per provider call: tokens and cost, kept for ever. Returns whether the day's ceiling has been reached, so the next call can be refused.
create or replace function ai_record_usage(p_user uuid, p_conversation uuid, p_purpose text, p_provider text, p_model text, p_in int, p_out int, p_cost numeric, p_latency int, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today numeric; v_ceiling numeric := coalesce((select (value)::text::numeric from ai_settings where key = 'daily_cost_ceiling_usd'), 0);
begin
  insert into ai_usage (user_id, conversation_id, purpose, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, outcome)
  values (p_user, p_conversation, p_purpose, p_provider, p_model, coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_cost, 0), p_latency, p_outcome);
  select coalesce(sum(cost_usd), 0) into v_today from ai_usage where occurred_at >= date_trunc('day', app_now());
  return jsonb_build_object('todayUsd', v_today, 'ceilingUsd', v_ceiling, 'ceilingReached', v_ceiling > 0 and v_today >= v_ceiling);
end $$;

-- The place the scheduler will call. It does nothing while the module is off; the monitors are added in phase 4.
create or replace function ai_run_jobs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ai_enabled() then return jsonb_build_object('skipped', 'disabled'); end if;
  return jsonb_build_object('ran', '[]'::jsonb);
end $$;

select lock_down_function_grants();

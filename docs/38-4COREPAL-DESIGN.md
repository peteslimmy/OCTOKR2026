# 38. 4COREPAL: Phase 1 discovery and design

Status: **Phase 1 (discovery and design). No application code has been written.** Approved by the owner on 2026-11-03 with the defaults in section 9.
4COREPAL is an additive module: its own routes, tables, services and feature flag. Existing scoring, calendar, weekly workflow, RBAC and RLS are not changed.

## 1. Facts the design rests on (confirmed by the owner and the schema)

| Question | Answer |
|---|---|
| Who owns a goal or task? | The **business unit**. `smart_goals.business_unit_id` and `tasks.business_unit_id`; there is no assignee. |
| Is there a department below a BU? | **No.** BU and department are the same thing. The ladder is BU Lead → Executive Management. |
| Task due date | The **end of the week the task was scheduled for** (`reporting_weeks.week_end_at`, finalised at `final_lock_at`). Tasks have no date column and none is added. |
| Task progress history | `task_status_history` (immutable): from/to status, source, who, when. Plus `audit_logs` (`TASK_CREATED/UPDATED/DELETED/STATUS_CHANGED`). The app records no other progress updates. |
| Per-task remarks | Do not exist. **New**: `ai_task_remarks` (section 4). |
| Who is the BU Lead? | `user_roles` row with role `BU_LEAD` and `business_unit_id`. |
| Who are executives? | Holders of `dashboard.executive.view` (EXECUTIVE, DIRECTOR, ADMIN, SUPER_ADMIN by the current role grants). |

Chain of ownership for evidence: `reporting_weeks → weekly_reports (BU, week) → smart_goals (BU, Sub-KR) → tasks (BU) → task_status_history`.

## 2. Baseline (before any change)

| Check | Result | Notes |
|---|---|---|
| Unit tests `vitest run src` | **325 passed** | 2026-11-03 |
| Type check `tsc --noEmit` | **clean** | |
| DB suite `tests/db` (test stack, clean DB) | see section 2.1 | |
| API sweep, e2e | last green run recorded in session notes: API 24 files passed; e2e subset 69/70 (known stale expectation in `09-metric-cards`) | not re-run for Phase 1: no code has changed since |

Working tree: a git repository exists with uncommitted changes from earlier work. They are preserved; Phase 1 only adds this file and one ADR line.

### 2.1 DB suite
Baseline before Phase 2: **46 files, 307 tests passed** (clean test stack, 2026-11-03).

## 3. Existing building blocks to reuse (no duplication)

| Need | Reused |
|---|---|
| AI provider and key | Integrations AI slot: `getAiRuntime()` in `src/lib/integrations/runtime.ts` (ANTHROPIC or OPENAI_COMPATIBLE, encrypted key, change approval, test button). Nothing calls it today. |
| In-app messages | `notifications` + `notify_users()` (idempotent on `(user_id, dedupe_key)`). |
| Email | `email_outbox` (leases, back-off, give-up; one row per notification) and the SMTP integration. AI email = a notification + outbox row, so delivery, retry and failure handling are inherited. |
| Scheduling | `run_scheduled_jobs()` + `job_heartbeats` + `/api/internal/jobs/run`. |
| Audit | `write_audit(...)` and `audit_logs`. |
| Approvals | `config_change_requests` pattern (one asks, another approves); AI approvals use the same shape in `ai_approvals`. |
| Permissions | `permissions`, `role_permissions`, `require_permission`, `auth_has_permission`, `auth_can_view_bu`, `lock_down_function_grants` allowlist. |
| Analytics | `src/lib/analytics.ts`, `src/lib/insights/*` (outlook, forecast, carry-over, capacity, integrity, executive report), `getTrendHistory`, `getBuWeekTrend`. |
| Presentation | `Card`, `DataTable`, `Badge`, `Banner`, `NavSelect`, `PageHeader`; the app shell navigation in `src/app/(app)/layout.tsx`. |

## 4. New database objects (all `ai_`-prefixed, additive, RLS on, no existing table altered)

| Table | Purpose |
|---|---|
| `ai_settings` | Key/value configuration: `enabled` (default **false**), schedules, thresholds, reminder and escalation days, pseudonymisation on/off. |
| `ai_action_policies` | One row per action type: risk class (LOW/MEDIUM/HIGH), mode (AUTO / NEEDS_APPROVAL / DISABLED). HIGH actions are fixed at NEEDS_APPROVAL by a check constraint; they cannot be set to AUTO. |
| `ai_conversations`, `ai_messages` | Chat history per user, with tool calls and source references. |
| `ai_findings` | A monitoring result: kind, BU, week, evidence JSON, severity, **fingerprint (unique)** so reruns never duplicate. |
| `ai_cases`, `ai_case_evidence`, `ai_case_events` | Performance Intelligence Cases (reference `PIC-YYYY-000001`), their evidence, and a timeline of communications, approvals and escalations. |
| `ai_remark_requests` | One batch request to a BU Lead for the unresolved tasks of one BU and week: status, due, reminded_at, escalated_at, linked communication. Unique on `(business_unit_id, reporting_week_id)`. |
| `ai_task_remarks` | The per-task remark: task, request, `reason_code`, text, author, time. Never changes the task; works on locked weeks. |
| `ai_dispositions` | Closure responses (completed-not-recorded, in progress, partially completed, stepped down, no longer required, deferred, blocked, scope changed). Status PROPOSED → APPROVED/REJECTED → APPLIED; original record untouched; approver stored. |
| `ai_corrective_plans`, `ai_corrective_actions` | Plans and their actions: owner BU, review date, success measure, baseline score and review score (effectiveness is judged on the later score). |
| `ai_communications` | Every message the agent sends: recipient, channel, case, kind, notification id, delivery status, acknowledged_at, response. |
| `ai_approvals` | Generic approval record for any proposed action. |
| `ai_jobs` | Each monitoring run: idempotency key, status, attempts, error (dead-letter state after the retry limit). |
| `ai_usage` | Tokens, cost, model, latency per LLM call. |
| `ai_knowledge_documents`, `ai_knowledge_chunks` | Created in a later phase, only when approved documents exist. |

`reason_code` for remarks: EXECUTION, RESOURCES, DEPENDENCY, AWAITING_DECISION, PRIORITY_CHANGE, UNREALISTIC_TIMELINE, TECHNICAL, COMPLETED_NOT_RECORDED, OTHER.

## 5. The remark workflow (the new capability)

1. **Eligible task**: its week is `FINAL_LOCKED`, the week is not an organisation holiday, the BU `reports_weekly`, and the task status is not `DONE`.
2. **Request**: one batch per BU and week (not one message per task). In-app notification plus email to every BU Lead of that BU, with the task list, the goal each belongs to and a secure link, a response deadline from `ai_settings`.
3. **Response**: the BU Lead gives a reason and optional text for each task. Saved through a SECURITY DEFINER function that checks `ai.remark.submit` and `auth_can_view_bu`. Audited.
4. **Reminder** after N days unanswered (once), then **escalation** to the executives after M days. Both are idempotent and suppressed once the request is answered or acknowledged.
5. **Use**: remarks are evidence for cases, root-cause (a remark is a recorded explanation, not a verified cause), memory ("resources cited in four weeks") and the executive report. A missed task with a DEPENDENCY remark is not counted as an execution failure.
6. **Never** changes a task, its status, any score or a locked week.

## 6. Agent tools (the only things the model may call; all read-only in Phases 3 to 4)

Each tool is a named backend function that runs as the signed-in user, so RLS and `auth_can_view_bu` decide what it returns. A second scope check runs in code. The model never receives SQL access.

`get_org_summary`, `get_bu_performance`, `compare_periods`, `rank_bus`, `list_sub_kr_risks`, `get_forecast`, `list_carried_goals`, `list_unresolved_tasks`, `get_task_history`, `list_remarks`, `get_reporting_compliance`, `list_cases`, `get_case`, `list_corrective_actions`, `list_pending_requests`, `my_outstanding`, `my_performance_trend`, `search_comments` (scoped, returned as untrusted data).

Rules: every number comes from a tool result; the answer is checked so that any figure it states appears in the tool results; each statement is tagged Fact, Calculation, Interpretation, Forecast or Recommendation; sources link to records; user-written text is wrapped as untrusted data and cannot change tools or permissions; names are replaced by BU codes and ids in prompts (default) and restored only for users allowed to see them.

## 7. Permissions to add (a new migration; existing roles untouched)

`ai.assistant.use`, `ai.insights.own`, `ai.insights.bu`, `ai.insights.org`, `ai.remark.submit`, `ai.case.view`, `ai.case.manage`, `ai.action.assign`, `ai.approval.decide`, `ai.escalation.manage`, `ai.communication.view`, `ai.communication.manage`, `ai.knowledge.manage`, `ai.config.manage`, `ai.schedule.manage`, `ai.audit.view`, `ai.report.export`. Defaults: BU_LEAD gets assistant, bu insights, remark submit; EXECUTIVE/DIRECTOR/ADMIN/SUPER_ADMIN get org insights, cases, communications, audit view and export; configuration and approval decisions go to SUPER_ADMIN (protected). Added to the `lock_down_function_grants` allowlist only for the read functions the app calls.

## 8. Files

**New (no existing file overwritten):**
- `supabase/migrations/2026110x…_ai_*.sql` (schema, permissions, functions)
- `src/lib/ai/` (provider adapter, orchestrator, tools, policy, monitors, cases, remarks, communications, usage)
- `src/app/(app)/ai/**` (assistant, executive centre, cases, remarks, communication centre, administration, audit)
- `src/app/api/v1/ai/**`, `src/components/ai/**`, tests under `tests/db`, `tests/api`, `src/lib/ai/__tests__`

**Existing files to modify, minimal, each with its reason:**
| File | Change | Why |
|---|---|---|
| `src/app/(app)/layout.tsx` | One navigation entry "4COREPAL", visible only when the module is enabled and the user has an `ai.*` permission | Reach the module |
| `src/lib/rbac/access.ts` | One catalogue line per new area | Access map completeness |
| `run_scheduled_jobs()` (via migration) | One guarded call to `ai_run_jobs()` that does nothing while disabled | Reuse the scheduler |
| `docs/24-DECISIONS.md`, `docs/17-NOTIFICATIONS.md`, `docs/12-API-CONTRACT.md` | ADR and spec lines | Project contract |
| Management brief and Insights wording that says "no AI" | Reworded **only** while the module is enabled | Truthfulness; Phase 8 |

**Deliberately untouched:** scoring and quarter formulas, the weekly reporting workflow, locks and calendar, RLS on existing tables, authentication, existing dashboards and reports.

## 9. Defaults adopted (owner may change any)

1. Provider: Anthropic via the existing integration; pseudonymised prompts.
2. "No AI" wording: changed only while the module is enabled.
3. Email: built and tested against the outbox; nothing is sent until the email provider is configured and tested.
4. Level 5 (execute): built but off until enabled; read-only and draft mode first.

## 10. Feature flag and failure isolation

- Master switch: `ai_settings.enabled` (default false) **and** the integration AI slot enabled. Both must be true.
- Every AI route and job first checks the switch; when off, routes return "not enabled", the navigation entry is hidden and jobs exit immediately.
- Provider outage, timeout or budget exhaustion produces a clear "assistant unavailable" state and records an `ai_jobs` failure; no OKR page depends on the module.
- Timeouts, retry limits, rate limits per user, and a daily cost ceiling are settings, not constants.

## 11. Autonomy matrix

| Action | Class | Default |
|---|---|---|
| Generate reports, open cases, create findings, request remarks, send approved reminders, schedule follow-ups | LOW | AUTO when enabled |
| Create corrective actions, propose activity changes, propose revised deadlines, assign follow-up owners | MEDIUM | NEEDS_APPROVAL (BU Lead or executive per policy) |
| Change goals or KR targets, change scores or history, reassign ownership, cancel commitments, formal employee decisions | HIGH | NEEDS_APPROVAL, not configurable to AUTO; the agent can only draft the proposal |

## 12. Phase plan and exit gates

| Phase | Exit gate |
|---|---|
| 2 Foundation: schema, permissions, adapter, usage, audit | Migrations apply to real and test DBs; DB tests for RLS and permissions pass; baseline suites unchanged |
| 3 Assistant (read-only) | Scope and leakage tests, prompt-injection tests, evidence checks pass |
| 4 Monitoring and remark requests | Idempotency tests (rerun creates no duplicates); schedules follow the reporting calendar |
| 5 Cases, closure, engagement, escalation | The closure and escalation journey passes end to end |
| 6 Prediction, executive centre, reports, communication centre | Figures reconcile with existing dashboards |
| 7 Administration and governance | Policy, approval and audit screens; HIGH actions cannot be automated |
| 8 Readiness | Full regression, security tests, 14-step journey, build; report with fully tested / partial / not implemented / blocked |

## 13. Known limitations carried forward

- No per-task owner, due date or progress notes exist; the agent states so and never infers them.
- Remarks are explanations given by a BU Lead, not verified causes; they are labelled as such.
- Semantic search and document knowledge start only when approved documents exist.

## 14. Phase 2 (foundation): built and tested

Migrations `20261104000015_ai_foundation.sql` and `20261104000016_ai_pricing_and_usage_status.sql` (additive, applied in one transaction to the real and test databases). 18 `ai_` tables, 17 `ai.*` permissions, 19 action policies (7 HIGH, 5 MEDIUM, 7 LOW), 8 escalation steps, 20 settings (module OFF by default).

Deliberate departures from section 4: no `ai_knowledge_*` tables yet (created when approved documents exist); `ai_escalation_policies` was added; the scheduler hook `ai_run_jobs()` exists and does nothing while the module is off, but is **not yet called from `run_scheduled_jobs()`**: that single call is added in Phase 4 when there is something to run, so Phase 2 changes no existing function.

Server code: `src/lib/ai/provider-call.ts` (the provider call: timeout, bounded retries, no redirects, key never shown) and `src/lib/ai/provider.ts` (checks the module is on and a provider exists, enforces the daily ceiling and hourly allowance, records every attempt, never throws).

Prices start at 0, so cost is recorded as 0 and the daily ceiling cannot trigger until an administrator enters the provider's price (settings `price_input_per_mtok_usd`, `price_output_per_mtok_usd`).

Existing files changed in Phase 2: `tests/db/fixtures/role-matrix.json` (the approved role matrix now lists the new `ai.*` grants). No application source file was changed.

## 15. Phase 3 (the read-only assistant): built and tested

Migration `20261104000017_ai_conversation_functions.sql`: `ai_start_conversation`, `ai_add_message` (owner only; audits an answer by the tools it used, never by the question or answer text), `ai_title_conversation`.

**Tools (9, read-only, `src/lib/ai/tools/`):** `list_business_units`, `get_org_summary`, `rank_business_units`, `get_bu_performance`, `get_weekly_trend`, `list_carried_goals`, `list_unresolved_tasks`, `get_task_history`, `get_reporting_compliance`. The design's `list_cases`, `get_case`, `list_corrective_actions`, `list_pending_requests`, `list_remarks` and `search_comments` are not built because the data behind them does not exist until Phases 4 and 5.
Scope: organisation-wide tools and any unit require `ai.insights.org` and `dashboard.executive.view`; anyone else with `ai.insights.bu` reaches their own unit only, and another unit gives the same answer as one that does not exist. The data is also read as the signed-in person (row-level security), so scope is enforced twice.

**Loop (`assistant.ts`):** the model replies with JSON, either tool calls (max 4 a round, 3 rounds, allowlist, validated arguments) or an answer. Tool results are cleaned of angle brackets and control characters, fenced with a per-request nonce and labelled as untrusted data. Every figure in an answer must appear in the tool results (`grounding.ts`); a figure that does not is sent back once, and if it persists the written answer is withheld and only the verified figures are shown. Business unit names are replaced by placeholders on the way to the provider and restored on the way back (setting `pseudonymise_prompts`, on by default), including in the question and earlier turns.

**Interface:** `/ai` (conversation list, chat, labelled statements, source links, retrieval time, limitations); `POST /api/v1/ai/assistant`, `GET /api/v1/ai/conversations`, `GET /api/v1/ai/conversations/{id}`. The navigation entry appears only when the module is on and the person has `ai.assistant.use`.

**Existing files changed in Phase 3 (each minimal):** `src/app/(app)/layout.tsx` (one nav entry and one status read for people holding `ai.assistant.use`), `src/lib/rbac/access.ts` (one capability line), `src/lib/domain/errors.ts` (the `AI_DISABLED` code).

**Known limits, stated plainly:** free text inside goal and task titles is cleaned but not pseudonymised, so a person's name typed into a goal reaches the provider; the model's labels (Fact, Interpretation…) are its own and the figure check does not test non-numeric claims; there is no streaming, so a long answer arrives all at once; follow-up memory covers the last eight messages.

## 16. Phase 4 (monitoring and remark requests): built and tested

Migration `20261104000018_ai_monitoring_remarks.sql` (additive). Deterministic SQL over recorded data; no model decides who is asked what.

- **Eligible task:** week `FINAL_LOCKED`, `NORMAL` (not an organisation holiday), unit active and reporting weekly, task not Done and not deleted, week finalised within `remark_lookback_days` (21). Due date = end of the task's week.
- **Request:** one batched `ai_remark_requests` row per unit and week (unique), to every active person of the unit who holds `ai.remark.submit` (BU Leads by default), as an in-app notification plus an email through the existing outbox (event types `AI_REMARK_REQUEST`, `AI_REMARK_REMINDER`, `AI_ESCALATION` added to `email_event_types`). Each is recorded in `ai_communications` with its notification, acknowledgement and follow-up state.
- **Reminder** once after `remark_reminder_days` (2); **escalation** once to the executives (`ai.insights.org` and `dashboard.executive.view`) after `remark_escalate_days` (5); an answered request gets neither.
- **Giving remarks:** `ai_submit_remarks` (all or none; own unit only; tasks must be on the request; one remark per task; reason from nine fixed codes; `OTHER` needs text). A remark cannot be edited. Nothing changes a task, a score, a report or a locked week.
- **Findings** (`ai_scan_findings`): `MISSED_REPORT`, `CONSECUTIVE_MISSED_REPORTS`, `SCORE_DROP` (threshold `score_drop_points`), each unique by fingerprint.
- **Scheduler:** `ai_run_jobs()` runs the daily review once a day after `schedule_daily_time` (Lagos), job-logged and retried; it is called from `run_scheduled_jobs()` by one guarded call whose failure is swallowed. A job stuck running for over 30 minutes can be taken again. Weekly, monthly and quarterly runs arrive with the reports (Phase 6).
- **Screens:** `/ai/remarks` (list), `/ai/remarks/[id]` (the form), `/ai/monitoring` (executives: waiting requests, findings, runs). API: `POST /api/v1/ai/remarks/{id}`.
- **Decision recorded during testing:** the Super Admin does not hold `ai.remark.submit`, so a Super Admin who sits in a unit is not asked for that unit's remarks; executives see the request through monitoring and the escalation.

**Limits:** emails carry the notification text and say where to go in the application but contain no direct link (the existing email service adds none); delivery of the email half is tracked by the existing outbox, and the Communication Centre (Phase 6) will show it beside the in-app record; the monthly closure of long-open activities and case creation are Phase 5.

## 17. Phase 5 (cases, closure, engagement, corrective plans): built and tested

Migrations `20261104000019_ai_cases_engagement.sql` and `20261104000020_ai_closure_dispositions.sql` (additive). All deterministic SQL: the model decides nothing here.

- **Cases:** opened once per observation (fingerprint) by the daily review: a HIGH or CRITICAL finding, a recurring `RESOURCES` or `DEPENDENCY` reason in a unit's remarks (three or more in 28 days), or three or more goals carried forward at the month end. A manager can open one by hand. Each has evidence as it was, hypotheses labelled `HYPOTHESIS` (a unit's remarks are labelled as its own unverified account), and a timeline nobody can edit.
- **Adaptive engagement:** by the escalation policy (data): BU Lead first; executives after the policy's hours with no response (LOW 168 h, MEDIUM 96 h, HIGH 48 h); CRITICAL both at once; an organisation-wide case goes straight to the executives. A response from the unit stops escalation. One notification per person and step.
- **Monthly closure:** on the last day of the month after the monthly time, goals set under identical wording in three or more finished weeks and not done in the latest are put to the unit, one request per unit and month, one reminder, one escalation. Answers are dispositions (the eight options). `IN_PROGRESS` and `BLOCKED` are noted; the rest are proposals needing a decision by a different person with `ai.approval.decide`. **No goal is cancelled, retired, re-dated or re-scored by any answer or approval:** an approved disposition is the recorded decision and stops the unit being asked about that goal again until it is set once more.
- **Corrective plans:** drafted by the agent for HIGH or CRITICAL cases of a unit (problem, evidence, root cause stated as "Not established", intervention, expected outcome, success measure, review date, baseline score). Someone with `ai.action.assign` (Super Admin, Admin) adds actions and submits; a different person with `ai.approval.decide` decides; the unit then marks its own actions done or blocked. Effectiveness is judged at the review date on the unit's final scores since the plan started (IMPROVED at +5 points or more, WORSE at -5 or less, otherwise NO_CHANGE, INSUFFICIENT_DATA under two weeks), **never on actions being ticked done**.
- **Approvals queue:** one `ai_approvals` queue for plans and dispositions; nobody decides their own; a reason is needed to reject; the decision route needs a recent second factor.
- **Daily run:** findings, cases from findings, remark requests, cases from remarks, plan drafts, engagement, plan review; each step is isolated so one failure never stops the others.
- **Screens:** `/ai/cases` and `/ai/cases/[id]` (the case workspace), `/ai/closure` and `/ai/closure/[id]`, `/ai/approvals`. API under `/api/v1/ai/{cases,plans,actions,approvals,closure}`.
- **Permission change:** Admin now holds `ai.action.assign` so an Admin can submit a plan for a Super Admin to approve. With a single Super Admin, that Super Admin cannot approve a plan they submitted themselves.

**Limits, stated plainly:** exact-wording matching finds fewer repeated goals than the executive report's similar-wording matching; the plan draft's wording is a fixed template per case category, not AI-written (narrative drafting by the model is a later option); the two-person rule needs two people holding the approval permission; no screen yet lets a manager open a case by hand (the function and permission exist); the browser screens have not been viewed signed in.

## 18. Phase 6 (predictions, executive centre, reports, communications): built and tested

Migration `20261104000021_ai_executive_communications.sql` (additive): `read_ai_executive_counts()` (invoker, so row-level security narrows every count), `read_ai_communications()` (security definer, names only, never an email address, joins the email outbox for status only) and `ai_log_report()` (one audit line per export: who, which report, which format; never content).

- **Predictions** (`predictions.ts`): from the application's own forecasting rules; each states outcome, period, evidence, assumptions, confidence, factors and a recommendation, and is labelled Forecast. A unit that cannot be forecast says so. A Sub-KR is judged on its weekly goals only, because the application records no numeric target for a Key Result or Sub-KR.
- **Executive centre** `/ai/executive`: organisational health, unit comparison, execution, executive attention, predictions, risks, open cases, intervention effectiveness; from the same engine as the Management brief so the figures reconcile with it. Organisation-wide: needs `ai.insights.org` and `dashboard.executive.view`.
- **Reports** `/ai/reports` (13): daily brief, weekly organisation, monthly executive, quarterly assessment, business unit, outstanding activities, carried-forward activities, unresolved cases, corrective tracking, Sub-KR risk, reporting compliance, dependencies and bottlenecks, intervention effectiveness. Commentary is a fixed rule from the report's figures. Export: CSV (spreadsheet formulas defused) and print; needs `ai.report.export`. **Not built:** departmental (it is the business unit report: a department is a business unit), employee performance summary (no per-person data: work belongs to units), and a separate organisational risk and bottleneck report (covered by the dependencies report and the executive centre).
- **Optional written explanation** (`commentary.ts`): from the report's figures only, names pseudonymised, shown only if every figure in it is in the report; otherwise no commentary. The report never depends on it. The figure check treats a recorded change as matching with either sign ("fell by 10" for -10); this also applies to the assistant.
- **Communications** `/ai/communications`: every message with the in-app and email status (queued, sent, failed with tries), acknowledgement, response and follow-up; filters for waiting and for failed or unanswered.

**Limits:** model-written explanations are only as good as the figure check, which tests numbers, not claims; the executive and report screens have not been viewed signed in; "upcoming scheduled communications" are not listed (the daily and monthly times are settings); email delivery status depends on the existing outbox and is only as current as its last run.

## 19. Phase 7 (administration and governance): built and tested

Migration `20261104000022_ai_governance.sql` (additive): `ai_set_escalation` / `ai_delete_escalation` (executives must stay reachable: every severity keeps a step that reaches them), `read_ai_usage_summary()`, `read_ai_activity()` (audit lines only: what was done, by whom, never the text of a question, answer or remark), `ai_purge()` and the guard that lets a message be deleted only by it. The daily run gains the purge step.

- **Administration** `/ai/admin` (switch and settings), `/ai/admin/policies` (what it may do, who is asked and when), `/ai/admin/usage` (cost, runs, activity). Switching on or off and every setting, policy and escalation change needs `ai.config.manage` (escalation: `ai.escalation.manage`) and a recent second factor, and is audited with the old and new value.
- **Provider and email** are set under Integrations, not here, so there is one place for secrets; the page shows whether each is configured and its last test. The module can be switched on without a provider: the daily review, remarks, cases and reports do not need one.
- **Autonomy** (the action policy matrix): a high-impact action offers no "automatic" choice and the database refuses it; **choosing "Needs approval" for a low-risk action the agent does by itself (asking for remarks, opening cases, reminders) stops it acting**, because those actions have no approval step: the screen says so.
- **Governance tests** include a scan that only the person-run functions write settings, policies and escalation, and that no `ai_` function touches roles, permissions or grants.
- **Retention:** conversation messages are deleted after `retention_days_messages` (365) with their empty conversations; job records after 90 days. Cases, remarks, decisions, usage and the audit log are kept.

**Not built, stated plainly:** a document knowledge base (no `ai_knowledge_*` tables; the screen says policies and SOPs are not read), automatic execution of approved changes (`execute_enabled` exists as a setting but nothing reads it: approved proposals are decisions, not actions), per-severity case categories and thresholds beyond the settings listed, and any notification setting of its own (the existing notification settings apply).

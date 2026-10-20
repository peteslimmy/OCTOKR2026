# 4CORE-OKR — Product Requirements Document (PRD)

**Revision note (2026-10-13):** Confirmed weekly operating states: NORMAL (weekly report required), SKIPPED physical OKR session (weekly report and manually authored summary comment still required; all BU Leads notified), and ORGANIZATION_HOLIDAY (no report due; report reminders/missing-report penalties suppressed; the affected week is excluded from quarterly scoring). Quarterly scoring includes all non-holiday reporting weeks; missing-report zero and authorised late-correction/versioning rules remain in force for reportable weeks. A submitted-but-unreviewed report remains a separate open decision.

**Version:** 1.0 | **Status:** Consolidated baseline + proposed enhancements | **Audience:** Product owner, business owner, design, engineering, QA, security, operations

## 1. Product vision
Deliver a trustworthy execution and governance workspace that connects organisation strategy to weekly BU commitments, measures execution fairly, gives leaders reliable visibility, and controls related attendance and violation-fund workflows.

## 2. Product principles
1. **One source of truth:** strategic entities are organisation-wide; weekly commitments belong to BUs.
2. **Predictable rules:** dates, locks, scoring and state transitions are explicit and deterministic.
3. **No silent historical changes:** corrections are reasoned, permissioned and auditable.
4. **Security by default:** least privilege, server-side checks, database row-level controls and scoped exports.
5. **Operational clarity:** show what can be done now, what is locked, why an action failed, and what comes next.
6. **Management signal over decorative cards:** dashboards prioritise hierarchy, trends, comparisons, exceptions and drill-down rather than generic counters.
7. **Recommendations are not policy:** proposed features remain visibly unapproved until accepted.

## 3. Personas and primary jobs
| Persona | Primary job | Main surfaces |
|---|---|---|
| SuperAdmin | Govern users, roles, organisation setup, strategy exceptions, security and audit | Admin console, strategy, access, audit, system health |
| Admin | Configure operational records and support approved workflows | Administration, strategy, weekly reports, integrity, audit |
| BU Lead | Create, submit and execute one shared weekly BU commitment | My BU, weekly report editor, SMART guidance, task execution |
| Presenter | Present BU execution and perform approved integrity corrections | Presentation mode, correction dialog |
| Executive / Director | Assess performance and identify exceptions without editing source data | Executive dashboard, trends, BU/Sub-KR drill-down |
| HR | Manage attendance, violations, payments and disbursement requests | HR dashboard, roster, violations, fund requests |
| Finance | Review requests and control approved disbursement | Finance queue, request detail, ledger, reconciliation |

## 4. Product outcomes and measures
- Weekly report submission rate and count of non-compliant BUs.
- Percentage of reports finalised on schedule; scheduler lag and failed finalisations.
- Score reproducibility and number of unexplained score mutations (target: zero).
- Cross-BU authorization test failures (target: zero).
- Percentage of critical actions with complete audit evidence (target: 100%).
- Ledger reconciliation differences (target: zero); rejected overdraft attempts and duplicate transaction prevention.
- Task/goal completion and Sub-KR coverage trends.
- Accessibility automated checks pass on all critical routes.

## 5. Product scope and module map
### P-01 Organisation & BU Directory
Maintain one organisation, active BUs, staff and membership. Staff may exist without login. User identity must resolve to a unique email and a current BU membership for the baseline scope. **Proposed enhancement:** effective-dated membership history and deactivation workflows.

### P-02 Identity, Authentication & Access
Login/session controls, user provisioning, role assignment, permission checks, security settings and audit. Existing decision records describe MFA, step-up verification and session revocation; those technical decisions must be preserved and verified against current implementation. No permission is granted by hiding UI controls alone.

### P-03 Strategy & Quarterly Planning
Annual Theme; quarterly Objective; 3–4 KRs; one or more Sub-KRs per KR; activation validation; exceptional Annual Theme change with reason; quarter rollover and historical read-only views.

### P-04 Weekly Reporting Workspace
Create/retrieve one report per BU/week, edit lease for multiple BU Leads, explicit submit action, lock countdowns, content lock, task execution window, final lock, immutable final state, missing-report compliance and exception display.

### P-05 Goals, Tasks & SMART Evaluation
Goal creation/edit/deletion before lock; KR-aligned vs Stretch classification; Sub-KR mapping; one or more tasks; deterministic derived goal status; SMART score and dimension guidance 0–100%; warnings do not block submission. SMART evaluation persistence failures must be surfaced explicitly, not silently swallowed.

### P-06 Scoring & Analytics
Equal goal weighting; weekly base score; integrity penalties calculated as a percentage of the original weekly base score; additive aggregation of applicable penalty rates; final score floored at zero and rounded to two decimal places; quarterly score calculated across every non-holiday calendar reporting week; missing report scored zero/NON_COMPLIANT unless an authorised exception applies; append-only score snapshots and post-quarter authorised late-report amendments; BU rankings; Sub-KR execution; historical trends and transparent calculation explanations. The denominator and missing-report policy are agreed. Submitted-but-unreviewed and partial-quarter/BU lifecycle edge cases remain decision-required.

### P-07 Presentation Mode
Meeting-friendly read-only navigation across BUs and strategy mappings, with goal/task state and score. Only explicitly authorised integrity actions are available; no general administration clutter.

### P-08 Integrity Correction & Penalty
Task status correction with reason, explicit confirmation, apply/waive decision, waiver reason, resulting score, actor attribution, audit and notification. For DONE → NOT_DONE, add applicable penalty rates and apply their sum once to the original weekly base score. Floor at 0.00%, round the final score to two decimal places, and preserve the inputs and rule version. No administrator bypass.

### P-09 Attendance & Sessions
Create weekly sessions and rosters with every active staff member pre-populated as PRESENT; after a held OKR session, HR toggles exceptions such as ABSENT, ON_LEAVE, EXCUSED or ILL. Show roster summaries and confirm finalisation. Finalised rosters remain immutable. A permissioned `Skip OKR for this week` action atomically marks the week/session SKIPPED and all rostered staff VIRTUAL_PRESENT. VIRTUAL_PRESENT is a skipped-week marker, not a physical-attendance claim. Skipping affects only the physical session; every BU must manually enter a performance summary, submit its weekly report, and complete normal review. There is no CANCELLED OKR outcome. HR can submit an attendance amendment at any time with a mandatory reason and optional evidence; an authorised independent Admin or designated HR approver must approve or reject it, and self-approval is prohibited. Approved amendments are appended, update the effective attendance status without overwriting the original roster, and retain a complete decision/audit trail. SKIPPED sessions show the read-only VIRTUAL_PRESENT roster and skipped-week indicator; skip-generated rows are not individually editable. The weekly report workspace remains mandatory for every BU and requires a manually entered performance-summary comment for the skipped week, followed by normal submission and review. No CANCELLED OKR outcome exists.

### P-10 Violations & Payments
Record employee, session, violation type, criticality, fine/amount, payment/deduction events and lifecycle. Payment and ledger credit must commit atomically and idempotently.

### P-11 Violation Fund & Disbursements
Author request, validate fields and available balance, submit for Finance, approve/reject with reason, record disbursement separately, append ledger debit, prevent self-approval/overdraft/duplicate actions, reconcile balance.

### P-12 Dashboards & Reporting
Executive, BU Lead, HR and Finance views; ranked tables, time series, hierarchical strategy views, exception queues, filters, accessible drill-down and controlled export.

### P-13 Notifications & Reminders
In-app/email-ready event notifications for submissions, upcoming locks, missed submissions, integrity corrections, attendance/violation events and Finance decisions. Delivery failure must not corrupt the business transaction. **Proposed enhancement:** user preferences, digesting and retry/dead-letter monitoring.

### P-14 Audit & Compliance Evidence
Append-only audit for critical business/security events, before/after snapshots where appropriate, reasons, actor/system identity, timestamp and resource references. Admin-only query and export; audit failures must be observable and security-critical events must use a reliable write path.

### P-15 Administration & Configuration
Users, BUs, roles, permissions, reporting calendar, approved violation types/criticality/fines, notification templates and operational settings. **Proposed enhancement:** a controlled configuration UI for non-secret operational settings; no developer-free editing of security-critical policies without approval/versioning.

### P-16 Platform Operations
Scheduler health, job retries, error monitoring, backups, restore verification, migrations, performance monitoring and support diagnostics. Admin tools must not permit arbitrary historical mutation.

## 6. Priority framework
- **P0 — Release blocker:** authorization, lock enforcement, correct scoring, financial integrity, auditability, strategy cardinality, finalisation reliability, no cross-BU leakage.
- **P1 — Core workflow:** full report creation, dashboards, attendance, violation management, finance workflow, notifications and accessible UX.
- **P2 — Recommended enhancement:** richer configurable analytics, notification preferences, scheduled exports, effective-dated organisational history, dashboard personalisation and advanced reconciliation tools.
- **P3 — Later / only after approval:** multi-organisation support, external integrations and predictive/AI analytics that may influence performance interpretation.

## 7. Critical product workflows
1. SuperAdmin creates/exceptionally changes Annual Theme.
2. Admin plans and validates quarter strategy.
3. BU Lead creates goal(s), runs SMART evaluation, maps each normal goal to Sub-KR or classifies as Stretch, adds tasks, submits.
4. Scheduler locks content Tuesday 18:00 WAT.
5. BU Lead executes allowed task status changes until following Tuesday 11:00 WAT.
6. Scheduler finalises report, converts remaining undefined tasks to not done, snapshots score and compliance, audits and notifies.
7. Presenter/Admin/SuperAdmin runs integrity correction and penalty decision.
8. HR finalises attendance, records violations and payment events; if an error is discovered after finalisation, HR submits an audited amendment request for independent approval.
9. HR submits disbursement request; Finance independently approves/rejects; approved request is disbursed through a separate transaction.
10. Executives review dashboard metrics and drill into authorised historical evidence.

## 8. UX product requirements
- Show active week, BU, report state, submit state, content-lock deadline and final-lock deadline clearly.
- Keep strategy hierarchy visible: Annual Theme → Quarterly Objective → KR → Sub-KR → BU goals/tasks.
- Explain scoring with formula and counts, not score alone.
- Distinguish NOT_SUBMITTED / NON_COMPLIANT from submitted score of zero.
- Use strong table hierarchy and charts that answer a management question; avoid generic metric-card walls.
- All empty states suggest a safe next action; all errors explain cause and recovery.
- Responsive design, keyboard operation, visible focus, WCAG 2.2 AA target, reduced-motion support and semantic landmarks.

## 9. Dependencies and constraints
- Single organisation, one BU per employee for current operational scope, WAT, NGN.
- Authentication/session model and Supabase/PostgreSQL/RLS decisions recorded in ADRs are implementation constraints pending current-code verification.
- Scheduled jobs must use a reliable server/database time source and idempotent processing.
- Ledger and audit append-only semantics must be enforced beyond the UI.
- Existing documents and accepted ADRs remain part of the source package; this PRD does not replace them.

## 10. Product risks
- Penalty calculation must use one agreed formula, deterministic decimal arithmetic and an auditable score snapshot; inconsistent formula implementations could create unfair outcomes.
- Attendance immutability without correction workflow makes data errors permanent.
- Mishandling missing, late, skipped-week, organization-holiday or unreviewed reports can distort quarterly score comparisons; include all reportable non-holiday weeks, include SKIPPED-session weeks, exclude ORGANIZATION_HOLIDAY weeks, preserve explicit missing-report zero/compliance states, and version late corrections.
- Shared BU report edit lease can cause stale writes without concurrency control.
- Scheduler outages can delay finalisation; idempotent retry and monitoring are mandatory.
- Permission drift between UI, API and RLS can expose sensitive cross-BU records.
- Silent SMART persistence errors can leave goals without trustworthy evaluation history.

## 11. Release gates
P0 acceptance tests pass; RLS/authorization matrix passes; lock jobs are tested for timezone boundaries and retries; score formulas have approved examples; financial concurrency tests pass; audit and ledger mutation are denied; critical-route accessibility tests pass; backup/restore and rollback plans are rehearsed; unresolved P0 decisions are signed off.


### Attendance product requirements — clarified workflow
- Reduce HR effort by using PRESENT as the default and requiring manual changes only for exceptions.
- Provide a single, permissioned Skip OKR action for a skipped week; do not require staff-by-staff updates. The action must prompt all BUs to complete and submit a manually authored performance summary for that week; weekly report submission and review remain mandatory.
- Clearly differentiate PRESENT, VIRTUAL_PRESENT, ABSENT, ON_LEAVE, EXCUSED, ILL and any configured status across UI, dashboards, reports and exports.
- Make skip atomic, idempotent, auditable and non-duplicating. A skipped session must not generate absence violations.
- Preserve the accepted post-finalisation correction workflow; no direct editing of a finalised source roster.


### P-17 Weekly operating calendar states
Support three distinct operating situations: normal reporting week; physical OKR session skipped while reports remain mandatory; and `ORGANIZATION_HOLIDAY` where the organisation is closed and reports are not required. The Skip action notifies all BU Leads and activates a mandatory BU-authored performance-summary comment in each weekly report. Organization Holiday is an authorised HR/Admin/SuperAdmin reporting-period action; it suppresses report reminders/missing-report penalties and excludes the affected week(s) from quarterly scoring.

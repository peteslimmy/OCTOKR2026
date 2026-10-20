# 4CORE-OKR — Software Requirements Specification (SRS)

**Revision note (2026-10-13):** Confirmed weekly operating states: NORMAL (weekly report required), SKIPPED physical OKR session (weekly report and manually authored summary comment still required; all BU Leads notified), and ORGANIZATION_HOLIDAY (no report due; report reminders/missing-report penalties suppressed; the affected week is excluded from quarterly scoring). Quarterly scoring includes all non-holiday reporting weeks; missing-report zero and authorised late-correction/versioning rules remain in force for reportable weeks. A submitted-but-unreviewed report remains a separate open decision.

**Version:** 1.0 | **System:** 4CORE-OKR | **Status:** consolidated logical specification; verify implementation against accepted ADRs and live code

## 1. Purpose and system boundary
This SRS specifies expected externally observable system behaviour, data integrity, interfaces, security and operational requirements. The source package indicates a web application using Supabase/PostgreSQL and application API routes; this SRS does not assume that every current implementation detail is correct. Accepted ADRs in `24-DECISIONS.md` remain binding unless formally superseded.

## 2. System context and logical components
1. **Web client:** role-specific pages, forms, dashboards and accessible interaction states.
2. **Application/API layer:** authenticated request handling, permission evaluation, validation, workflow orchestration, error mapping and audit integration.
3. **Identity/session layer:** verified user identity, MFA/step-up requirements, session listing/revocation and account controls consistent with ADRs.
4. **PostgreSQL/Supabase data layer:** relational entities, constraints, transaction boundaries, row-level security and append-only records.
5. **Scheduled job runner:** weekly lock/finalisation, quarter rollover and notification scheduling; jobs must be idempotent.
6. **Notification delivery:** in-app events and configured delivery provider; retry/observability separated from core transaction outcome.
7. **Observability/operations:** structured logs, metrics, alerts, backup/restore, migrations and support diagnostics.

## 3. External interfaces
### 3.1 User interface
Browser-based responsive web interface. Critical actions require authenticated context and must return clear success/failure feedback. Presentation mode supports large-screen meeting use.

### 3.2 API contract
- Use authenticated endpoints for all protected reads/writes.
- Validate input schemas at API boundary and enforce permissions on every request.
- Return stable error envelopes with machine-readable `code`, safe `message`, optional field errors and a correlation ID.
- Never expose raw SQL, stack traces, secrets, service-role credentials or unredacted sensitive fields.
- Apply pagination and bounded filtering to collection endpoints.
- Use idempotency keys for payment/disbursement operations and any retry-prone transaction endpoint.
- Use optimistic concurrency/version tokens for shared report edits.

The existing `12-API-CONTRACT.md` is the endpoint-level companion. Any endpoint added or changed must update that contract and its tests.

## 4. Logical data model
The final physical schema must reconcile with `09-DOMAIN-MODEL.md`, `10-DATABASE-SPEC.md`, migrations and accepted ADRs. Minimum logical entities:
- Organisation (single organisation in current scope)
- BusinessUnit
- Staff/Employee
- ApplicationUser / identity link
- Role, Permission, UserRole/RolePermission assignment
- AnnualTheme
- Quarter / QuarterlyObjective
- KeyResult (KR), SubKeyResult (Sub-KR)
- WeeklyReport (unique BU + reporting week)
- Goal (report reference, type, optional Sub-KR, SMART evaluation reference)
- Task (goal reference, state)
- SmartEvaluation (scores, dimension scores, warnings/suggestions, version/timestamp)
- ScoreSnapshot / ScoreCalculation / ComplianceState
- QuarterlyScoreSnapshot (append-only versions, fixed denominator, contributing-week evidence) / QuarterlyScoreAmendment (authorised late-report correction event)
- EditLease / report version or concurrency token
- IntegrityCorrection / PenaltyDecision; persist base score, individual applied rates, combined rate, formula/rule version, unrounded calculation result where useful for reproducibility, and final two-decimal score snapshot.
- AttendanceSession / immutable AttendanceRecord / AttendanceAmendmentRequest / append-only AttendanceAmendmentDecision or event; approved amendment history determines effective status without modifying the original roster record.
- Violation / ViolationPayment
- DisbursementRequest / FinanceDecision / Disbursement
- LedgerEntry (append-only credit/debit)
- Notification / delivery attempt
- AuditLog (append-only)
- SystemSetting / configuration version (only for approved configurable settings)

### 4.1 Integrity constraints
- Unique organisation/year Annual Theme; one objective per quarter; 3–4 KRs on activation; at least one Sub-KR per KR on activation.
- Unique BU/reporting week report.
- Goal belongs to one report; KR_ALIGNED requires exactly one valid Sub-KR; STRETCH requires no Sub-KR.
- Goal must have at least one active task at submission.
- Task state limited to UNDEFINED/DONE/NOT_DONE.
- Monetary amounts use fixed-precision numeric type; no floating-point money.
- Ledger entry type limited to CREDIT/DEBIT; posted entries cannot be updated/deleted.
- Audit rows cannot be updated/deleted by ordinary application roles.
- A quarterly score snapshot records the full calendar week set, explicitly identifies included reportable weeks and excluded ORGANIZATION_HOLIDAY weeks, and preserves the denominator of eligible non-holiday reporting weeks. A non-submitted report in a reportable week contributes zero unless a later authorised amendment is accepted; holiday weeks do not require reports and do not contribute to numerator/denominator. Historical score versions remain immutable.
- An authorised post-lock late-report correction creates a new versioned quarterly score snapshot and append-only amendment record. It preserves the original zero and previously published snapshot, records actor/authorisation/reason/old-new values/rule version/time, and does not reopen normal quarter editing.
- Foreign keys and unique constraints must prevent orphaned strategy/report/finance records.
- Finalised `attendance_records` are immutable at the database level. Attendance amendment requests reference an existing attendance record and capture its source/effective status snapshot, proposed status, mandatory reason, optional evidence metadata, requester, timestamps and lifecycle state.
- A partial unique constraint or equivalent transactional guard prevents more than one PENDING amendment per attendance record. A decision row/event records the approver, APPROVED/REJECTED result, timestamp and decision reason where required.
- Approval is rejected if requester and approver resolve to the same user or if the status snapshot is stale. Approved amendments are append-only and the effective status is resolved from the original record plus approved amendment history; no operation updates/deletes the original roster row.

### 4.2 Score and penalty computation requirements
- Compute the weekly base score as defined in the scoring engine before applying integrity penalties.
- For an APPLY decision, sum all applicable penalty rates as decimal rates and apply the sum once to the original weekly base score: `finalScore = roundTo2Decimals(max(0, baseScore * (1 - sum(appliedPenaltyRates))))`.
- Do not interpret a penalty as percentage-point subtraction and do not compound multiple penalties sequentially.
- A WAIVE decision contributes no applied penalty rate and requires a non-empty reason.
- Final score must never be below 0.00%. Final score precision is two decimal places and must be consistent across API responses, persisted score snapshots, dashboards, reports and exports.
- Use deterministic decimal arithmetic; do not use binary floating-point for authoritative score calculations. Preserve the original base score, individual rates, combined rate, calculation/rule version, final rounded result and audit reference. Historical snapshots must not silently change when penalty configuration changes.
- Quarterly execution score uses all non-holiday calendar reporting weeks in the quarter: `quarterlyScore = sum(weeklyContributionForEachEligibleReportingWeek) / eligibleReportingWeekCountInQuarter`. Each eligible week contributes once. NORMAL and SKIPPED-session weeks are eligible; ORGANIZATION_HOLIDAY weeks are excluded. A non-submitted report in a reportable week contributes `0.00` and `NON_COMPLIANT` unless an authorised exception is approved. A quarter with no eligible reporting weeks returns `N/A`.
- Persist or otherwise preserve stable audit evidence for every missing BU/week zero; do not use a transient unrecorded zero.
- A submitted report awaiting review is not a missing report. Its quarter-end finalisation behaviour is decision-required; do not implement an implicit zero or silently exclude its week.

## 5. State machines
### 5.1 Weekly report
Logical states include OPEN/EDITABLE, SUBMITTED, CONTENT_LOCKED, FINAL_LOCKED, and NOT_SUBMITTED compliance outcome. Submission is an event and must not be confused with lock state. Exact enum implementation must align with current code and `08-STATE-MACHINES.md`.

### 5.2 Task
UNDEFINED → DONE or UNDEFINED → NOT_DONE is allowed after content lock and before final lock for authorised BU Lead. Reversal and all mutation after final lock are denied through ordinary workflow. Integrity correction is a separate privileged workflow with audit and penalty decision.

### 5.3 Finance request
SUBMITTED → UNDER_REVIEW → APPROVED → DISBURSED, or SUBMITTED/UNDER_REVIEW → REJECTED. Approval is not cash release. Invalid transitions are rejected and audited.

### 5.4 Attendance and amendment lifecycle
For a HELD session, the server snapshots active staff and creates one DRAFT attendance row per staff member with status PRESENT. HR may change draft statuses before finalisation. Finalisation makes source rows immutable. A permitted Skip OKR operation atomically sets the session to SKIPPED and every staff member in scope to VIRTUAL_PRESENT. It changes only physical-session attendance. It must not suppress weekly BU reports: each BU report for that week must contain a manually authored performance summary, be explicitly submitted, and pass through normal review. There is no CANCELLED OKR state. VIRTUAL_PRESENT means the physical session was skipped, not physical attendance; no absence violation is generated. Every BU must manually enter a performance summary for the affected week, submit its weekly report, and complete normal review.

An amendment request follows PENDING → APPROVED or PENDING → REJECTED. HR initiates the request at any time, with no fixed deadline; the requester supplies a mandatory reason and may attach optional evidence. A different authorised user with `attendance.amendment.approve`—an Admin or designated HR approver—must decide it. Self-approval is prohibited regardless of the user's other roles. Approval appends a decision/amendment and changes the effective status derived for current operational views; the original source record and historical values remain unchanged. Every decision is audited. Making a reviewer reason mandatory on rejection is a proposed control pending separate approval. Enforce one pending request per attendance record or equivalent serialised concurrency control, and detect stale original/effective values before approval.

## 6. Business time and scheduler
- Timezone: `Africa/Lagos`; UI labels deadlines in WAT.
- Content lock: Tuesday 18:00 WAT.
- Final lock: following Tuesday 11:00 WAT.
- Monday opens weekly reporting period.
- For NORMAL and SKIPPED-session weeks, final lock follows the approved schedule. ORGANIZATION_HOLIDAY periods suppress reporting/failure-to-submit handling; a holiday declaration must not generate missing-report zero/non-compliance.
- Job must claim eligible rows safely, lock/report finalise atomically where possible, update remaining UNDEFINED tasks to NOT_DONE, recalculate derived state, persist score/compliance snapshots, write audit and enqueue notifications.
- Job retries must be idempotent; a second run must not duplicate score snapshots, ledger entries or notifications beyond explicitly supported delivery attempts.
- Monitor job lag, eligible backlog, failures, retry count and last successful run. Alert on missed SLA.
- Test exact boundary instants, delayed execution, concurrent workers, process restart, quarter rollover and clock/timezone handling.

## 7. Authorization and security
- Identity must derive from a verified session/JWT, not caller-supplied role, BU, user ID or RLS context parameters.
- Enforce authorization in API/service logic and database RLS for exposed data paths.
- Test direct UUID access, modified BU filters, forged body fields, role escalation, exports and RPC execution.
- Service-role credentials are server-only and never shipped to browser code.
- Privileged security-definer functions must validate arguments, have minimal grants, fixed safe search path where applicable, and be executable only by intended roles.
- MFA/step-up/session revocation behaviours must follow accepted ADRs; no no-op security control may be presented as successful.
- Rate-limit authentication, OTP, recovery and sensitive write endpoints; log failed auth and administrative security events.
- Validate/sanitize user-provided text; use parameterized queries and safe output rendering.
- Apply secure cookie/session practices, CSRF protections where applicable, TLS, security headers and secret rotation.
- Minimise PII in logs and notifications; apply retention and access controls to exports and audit data.

## 8. Audit, ledger and transactional guarantees
### 8.1 Audit
Critical events include authentication failures/logout, role changes, strategy exceptions, report submission/lock/finalisation, integrity correction, attendance finalisation, violation/payment events, Finance decisions, ledger postings, exports and configuration changes. Store actor/system identity, event timestamp, action, resource, outcome, reason and relevant before/after values. Audit failures must be surfaced to operations; critical mutations must not silently proceed without required audit evidence unless a documented fail-open/fail-closed decision explicitly permits it.

### 8.2 Financial ledger
- Ledger is source of truth; displayed balance is sum(CREDIT) − sum(DEBIT).
- Payment plus ledger credit is one atomic operation.
- Disbursement plus ledger debit and state transition is one atomic operation.
- Check balance and reserve/debit funds under transaction/locking that serializes competing disbursements.
- Use unique external/payment references or idempotency keys to prevent duplicate postings.
- No direct edit/delete of posted ledger rows; reverse with compensating entry.
- Run reconciliation and flag any mismatch between lifecycle records and ledger.

## 9. Performance, availability and scalability
The source package does not define numeric service-level objectives. The following are **proposed targets for owner approval**, not current commitments:
- Standard page/API read p95 ≤ 2 seconds under agreed baseline load.
- Common mutation p95 ≤ 3 seconds excluding external delivery.
- Dashboard queries remain responsive using indexes, bounded date ranges, aggregation and pagination.
- Finalisation backlog drains within 15 minutes of scheduled deadline under expected load.
- No duplicate financial posting under retries/concurrency.
- Establish availability, RPO/RTO, backup retention and restoration objectives with the business owner before production sign-off.

## 10. Reliability and recoverability
- All schema changes are migration-managed, reviewed and idempotent where feasible.
- Backup schedule and restore drills are documented; backup success alone is not proof of recoverability.
- Failed scheduled jobs are retryable and leave enough state to resume safely.
- Notification failure is retried without repeating the business transaction.
- Add health checks for database connectivity, scheduler heartbeat, mail provider, and critical queues.
- Rollback plans must address schema compatibility and irreversible financial/audit writes.

## 11. Logging and observability
Structured logs should include timestamp, environment, severity, event, actor ID where safe, request/correlation ID, route/job, resource IDs, duration and outcome. Never log passwords, OTPs, access tokens, service-role keys, recovery codes or unnecessary PII. Metrics: API latency/error rate, auth failures, lock/finalisation lag, scheduler failures, SMART persistence errors, RLS denials, finance transaction conflicts, ledger reconciliation, notification retries and audit write failures.

## 12. Data migration and retention
- Inventory existing data and schema before migration; take verified backup and record counts/checksums.
- Reconcile legacy role labels and superseded Friday/meeting-dependent locking rules; do not migrate obsolete business semantics into active logic.
- Preserve original identifiers where safe, timestamps, ownership, financial references and historical score interpretation.
- Validate referential integrity, duplicates, missing mappings and orphaned records before cutover.
- Produce a dry-run report, exception list, rollback plan and post-migration verification report.
- Define retention/deletion rules for employee data, notifications, audit records and exports. Audit/ledger retention and lawful privacy obligations need business/legal approval.

## 13. Verification requirements
- Unit tests: scoring, SMART persistence, state transitions, penalty calculations (including additive rates, no sequential compounding, zero floor and two-decimal final rounding), timezone boundaries and validation.
- Integration tests: report lifecycle, strategy activation, finalisation transaction, integrity workflow, payment/ledger, disbursement/ledger, audit and notifications.
- Attendance amendment tests: original finalised roster cannot be updated/deleted; HR can submit at any time with reason; evidence is optional; requester cannot approve own request even with multiple roles; only `attendance.amendment.approve` can decide; rejection is audited and the requester is notified; a separate written approval document is not required, and a mandatory reviewer comment is not enforced until approved; approved amendments change effective status but preserve source values/history; stale and duplicate pending requests are rejected; audit and notifications are emitted.
- RLS/security tests: all roles × all resources × own/other BU × valid/invalid state.
- Concurrency tests: report lease, two report edits, duplicate payment, concurrent disbursements, scheduler workers.
- E2E tests: login/MFA, BU Lead weekly flow, Presenter correction, HR attendance/violation, Finance rejection/approval/disbursement, Executive drill-down.
- Accessibility tests: automated axe zero-impact-violation baseline on login and critical routes plus manual keyboard/screen-reader review.
- Resilience tests: job retry, notification provider outage, database transient failure and restore rehearsal.

## 14. Deployment and environment management
- Separate development, test/staging and production environments with separate credentials and data.
- No production secrets in repository or client bundles; rotate any exposed credential.
- CI should run formatting/lint, type checking, unit/integration tests, RLS/security tests, accessibility E2E, migration validation and build.
- Require review for migrations, permission/policy changes, score changes and workflow-state changes.
- Use feature flags only where flag state is audited and safe; never use flags to bypass authorization.

## 15. Known implementation-sensitive items from ADRs
The source `24-DECISIONS.md` records prior operational decisions including JWT-derived identity/RLS, MFA and session revocation, audit write reliability, SMART evaluation persistence and migration handling. During implementation review, confirm the deployed schema and current code match these accepted decisions. A document is not proof that a live migration or runtime path works; verify with tests and safe environment probes.

## 16. Open technical/business decisions
See `06-DECISION-AND-GAP-REGISTER.md`. The integrity-penalty arithmetic, attendance amendment workflow, quarterly denominator, missing-report zero rule, and audited post-quarter late-report correction are resolved. Remaining quarter-scoring gaps include the treatment of submitted-but-unreviewed reports and lifecycle/partial-quarter edge cases.


### Attendance technical requirements — defaults and skipped-week operation
- Roster generation must happen server-side from an active-staff snapshot and create one unique `(session_id, staff_id)` row with status `PRESENT` for every eligible staff member.
- Implement a privileged `skip_okr_session` service/RPC. It must authenticate the actor, verify `attendance.session.manage`, validate session state, require an idempotency key, and atomically transition the session to SKIPPED and create/set all roster-snapshot rows to VIRTUAL_PRESENT.
- Use a transaction and uniqueness constraint so the session cannot be SKIPPED while only some staff rows are tagged. Retries must not duplicate records.
- A skipped session outcome and its virtual-present rows are immutable under ordinary attendance editing. Correcting an erroneous skip requires a separate authorised, audited exception workflow.
- SKIPPED means no physical session was held and VIRTUAL_PRESENT rows are created for all in-scope staff. Reports/exports must carry the session outcome. No absence violation or penalty is generated for SKIPPED sessions. Every BU must submit a weekly report containing a manually authored performance summary, and the report must be reviewed. Do not implement a CANCELLED OKR state. Model ORGANIZATION_HOLIDAY separately as a reporting-period state, with no report required and no implied VIRTUAL_PRESENT roster.
- Minimum status enum: `PRESENT`, `ABSENT`, `ON_LEAVE`, `EXCUSED`, `ILL`, `VIRTUAL_PRESENT`. Additional statuses are configuration-controlled and must be versioned or snapshotted so historical meaning is stable.


## Organization Holiday requirements

- Model reporting state separately from governance-session outcome: `NORMAL` or `ORGANIZATION_HOLIDAY`; session outcome remains SCHEDULED/HELD/SKIPPED.
- Permit only HR/Admin/SuperAdmin or explicit holiday-management permission to declare the state. Require affected reporting week IDs, reason, confirmation, authenticated actor and audit trail.
- On declaration, notify all BU Leads, suppress report reminders/overdue/missing-report zero/non-compliance for the period and exclude the week(s) from quarterly score numerator and denominator.
- On `SKIPPED`, notify all BU Leads; every BU report requires a manually authored summary comment and explicit submission/review.
- Store appended state events and included/excluded quarter week references. Post-lock changes that alter score eligibility create a new versioned score snapshot; do not overwrite published snapshots or generally reopen the quarter.
- A quarter with no eligible non-holiday week returns N/A with reason `NO_ELIGIBLE_REPORTING_WEEKS`.

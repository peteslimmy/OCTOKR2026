# 4CORE-OKR API Contract

## Standards

Base path: `/api/v1`.

Business endpoints must enforce authentication, permission, scope, lifecycle state, validation, audit, and transactions as applicable.

Do not expose unrestricted generic CRUD for critical operations.

## Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/password/forgot`
- `POST /api/v1/auth/password/reset`

## Organisation/people

- `GET /api/v1/business-units`
- `POST /api/v1/business-units`
- `PATCH /api/v1/business-units/{id}` — name, status and weekly reporting; a change to status or weekly reporting takes a reason and becomes a config request (ADR-068).
- `DELETE /api/v1/business-units/{id}` — `business_units.manage`; refused while the unit still has employees or reports.
- `POST /api/v1/business-units/{id}/type` — `{unitType: BUSINESS_UNIT|DEPARTMENT, reason}`; step-up; `business_units.change_type` (Super Admin only). Refuses an unchanged type, a blank reason or an unknown unit; audited as `BU_TYPE_CHANGED`. `PATCH` refuses a changed `unitType` with `USE_TYPE_CHANGE`.
- `POST /api/v1/business-units/bulk-delete` — `{ids, reason?}`; step-up; each id is attempted separately and returns successes and failures.
- `GET /api/v1/employees`
- `POST /api/v1/employees`
- `PATCH /api/v1/employees/{id}`
- `PATCH /api/v1/employees/{id}/roster` — `{onRoster}`; `users.manage`; audited as `EMPLOYEE_ROSTER_CHANGED`.
- `POST /api/v1/users`
- `PUT /api/v1/users/{id}/roles` — `{roles}`; step-up. Role codes are checked for shape only; the database decides whether each role exists and may be granted (ADR-069).
- `PUT /api/v1/users/{id}/permissions` — `{permission, grant}`; step-up. Only the delegable permissions are accepted.
- `POST /api/v1/users/{id}/suspend`
- `POST /api/v1/users/{id}/reactivate`
- `POST /api/v1/users/{id}/mfa-reset` — `{reason}`; step-up; audited; ends the target's sessions.
- `DELETE /api/v1/users/{id}/delete` — step-up; deletes the application user and the auth identity.
- `POST /api/v1/users/bulk-delete` — `{ids, reason?}`; step-up; each id is attempted separately and returns successes and failures; the caller cannot delete themselves.

## Branding and site content

- `GET|PUT /api/v1/branding` — application name, short name and primary colour. The colour carries white text, so it must keep at least 4.5:1 contrast.
- `PUT|DELETE /api/v1/branding/assets/{kind}` — `kind` is `logo` or `favicon`; base64 raster PNG, JPEG, WebP or ICO only (SVG is refused on purpose), size-capped and signature-checked.
- `GET|PUT /api/v1/site` — landing and sign-in content, validated as a whole; images no longer referenced are pruned afterwards.
- `PUT|DELETE /api/v1/site/images/{slot}` — base64 raster PNG, JPEG or WebP only; returns the new `version`.

## Strategy

- `GET /api/v1/strategy/annual-theme`
- `POST /api/v1/strategy/annual-themes`
- `POST /api/v1/strategy/annual-themes/{id}/change`
- `GET /api/v1/strategy/quarters`
- `POST /api/v1/strategy/quarters` — `{year}`; creates that year's quarters.
- `GET /api/v1/strategy/quarters/{id}`
- `POST /api/v1/strategy/quarters/{id}/activate`
- `GET /api/v1/strategy/objectives/current`
- `POST /api/v1/strategy/objectives`
- `PATCH /api/v1/strategy/objectives/{id}`
- `POST /api/v1/strategy/objectives/{id}/key-results`
- `PATCH /api/v1/strategy/key-results/{id}`
- `POST /api/v1/strategy/key-results/{id}/sub-key-results`
- `PATCH /api/v1/strategy/sub-key-results/{id}`

## Reporting

- `GET /api/v1/reporting-weeks/current`
- `GET /api/v1/weekly-reports/current`
- `GET /api/v1/weekly-reports/{id}`
- `POST /api/v1/weekly-reports`
- `POST /api/v1/weekly-reports/{id}/edit-session`
- `POST /api/v1/weekly-reports/{id}/edit-session/heartbeat`
- `DELETE /api/v1/weekly-reports/{id}/edit-session`
- `POST /api/v1/weekly-reports/{id}/submit`
- `POST /api/v1/weekly-reports/{id}/review` — reviews a submitted report (ADR-081). The report keeps its computed score; the quarter stays `PROVISIONAL` until every submitted report is reviewed. Body: `{comments?}` records a review with optional comments (max 2000 characters); `{rejection_reason}` (mandatory, max 2000) records a rejection instead. A rejection is a review event, not a status: the report stays `NOT_REVIEWED` (still awaiting review, quarter stays `PROVISIONAL`), the score is untouched, it is audited as `REPORT_REJECTED`, and a later review clears it from the report view. A reviewed report cannot be rejected.
- `PUT /api/v1/weekly-reports/{id}/skipped-summary` — `{comment}`; the manually authored summary required for a BU report in a skipped week.
- `DELETE /api/v1/weekly-reports/{id}` — deletes a draft (`NOT_SUBMITTED`, open) report; `weekly_report.create`.

## Goals

- `POST /api/v1/weekly-reports/{reportId}/goals`
- `PATCH /api/v1/goals/{goalId}`
- `POST /api/v1/goals/{goalId}/delete`
- `POST /api/v1/smart-evaluations` — preview only: nothing is persisted. SMART warnings are guidance and never block saving (BR-GOAL-003).

## Tasks

- `POST /api/v1/goals/{goalId}/tasks`
- `PATCH /api/v1/tasks/{taskId}`
- `POST /api/v1/tasks/{taskId}/delete`
- `POST /api/v1/tasks/{taskId}/execution-status`

## Integrity

- `POST /api/v1/integrity-corrections`
- `GET /api/v1/integrity-corrections/preview?taskId=&target=DONE|NOT_DONE` — what the correction would do; nothing is written.

## Presentation

- `GET /api/v1/presentation/current`
- `GET /api/v1/presentation/weekly-reports/{reportId}`
- `GET /api/v1/presentation/last-week?weekId=&buId=` — read-only. Tasks recorded Not Done for that BU in the reporting week before `weekId`. Needs `presentation.view`; runs as the caller, so BU scope and RLS apply. Returns `availability` (`OK`, `NO_PREVIOUS_WEEK`, `HOLIDAY`, `NO_REPORT`), both weeks, `tasks`, `final_locked`, `undefined_tasks`. 422 for malformed or extra parameters, 404 for unknown identifiers, 403 outside scope.

## Imports

- `POST /api/v1/imports/employees/parse` — multipart `file` (.csv or .xlsx). Reads it as data and returns `headers`, `rows`, a suggested column `mapping` and the file `sha256`. Saves nothing. `users.manage`.
- `POST /api/v1/imports/employees/validate` — `{rows, policy, fileSha256?}`; read-only classification of every row (action, issues with class ERROR / CONFLICT / WARNING) and a summary with `canCommit`.
- `POST /api/v1/imports/employees/commit` — `{rows, policy, idempotencyKey, fileName, fileSha256}`; step-up required. Re-validates, then commits all rows atomically. 422 `IMPORT_INVALID` lists the problems and changes nothing; 409 `IDEMPOTENCY_KEY_REUSED` for a different file or policy under the same key; a repeat of the same request returns the first result with `replayed: true`.
- `GET /api/v1/imports/batches` — recent imports.
- The three import routes serve every entity: `employees` (permission `users.manage`) and `business-units` (`business_units.manage`). An unknown entity is 404.

## Holiday amendment requests (ADR-058)

- `POST /api/v1/reporting-weeks/{weekId}/holiday-amendment-request` — ask to declare or reverse a holiday on a CLOSED week. Step-up. Needs `quarter.score.amend`. 409 `HOLIDAY_REQUEST_NOT_NEEDED` for an open week (use `holiday-amendment`), 409 `HOLIDAY_REQUEST_PENDING`.
- `GET /api/v1/holiday-amendment-requests` — scoped to `quarter.score.amend`.
- `POST /api/v1/holiday-amendment-requests/{id}/decision` — `{decision: APPROVE|REJECT, comment?, idempotencyKey}`; step-up. 403 `HOLIDAY_REQUEST_SELF_APPROVAL` for the requester. Approval applies the amendment.
- `POST /api/v1/reporting-weeks/{weekId}/holiday-amendment` on a closed week now answers 409 `TWO_PERSON_APPROVAL_REQUIRED`.

## Attendance/governance

- `GET /api/v1/governance-sessions` — sessions the caller may see.
- `POST /api/v1/governance-sessions`
- `GET /api/v1/governance-sessions/{id}`
- `POST /api/v1/governance-sessions/{id}/attendance` — create the weekly roster from the active staff snapshot, defaulting each staff member to PRESENT.
- `POST /api/v1/governance-sessions/{id}/attendance/finalize` — `{confirm: true}`; closes the roster. Later changes go through an amendment request.
- `POST /api/v1/governance-sessions/{id}/skip-okr` — permissioned, idempotent action to mark the session SKIPPED and atomically tag every staff member in its roster scope VIRTUAL_PRESENT.
- `PATCH /api/v1/attendance-records/{attendanceRecordId}` — `{status, notes?}`; the ordinary attendance change while the roster is still open.
- `POST /api/v1/attendance-records/{attendanceRecordId}/amendment-requests` — HR request with proposed status, mandatory reason, optional evidence references and idempotency key.
- `GET /api/v1/attendance-amendment-requests` — list within authorized HR/Admin scope; support status and date filters.
- `POST /api/v1/attendance-amendment-requests/{requestId}/approve` — independent authorized decision.
- `POST /api/v1/attendance-amendment-requests/{requestId}/reject` — record rejection decision; reviewer comment policy is not yet approved as mandatory.
- `POST /api/v1/reporting-weeks/{weekId}/quote`

## Violations

- `GET /api/v1/violations`
- `POST /api/v1/violations`
- `PATCH /api/v1/violations/{id}`
- `POST /api/v1/violations/{id}/payment`
- `GET /api/v1/violation-types`
- `POST /api/v1/violation-types` — creates a config request (ADR-068).
- `PATCH /api/v1/violation-types/{id}` — creates a config request (ADR-068).

## Finance

- `GET /api/v1/finance/fund`
- `GET /api/v1/finance/ledger`
- `POST /api/v1/disbursement-requests`
- `GET /api/v1/disbursement-requests`
- `POST /api/v1/disbursement-requests/{id}/review` — starts the independent review of a requested disbursement.
- `POST /api/v1/disbursement-requests/{id}/approve`
- `POST /api/v1/disbursement-requests/{id}/reject`
- `POST /api/v1/disbursement-requests/{id}/disburse` — `{reference, idempotencyKey}`; step-up; records the payment, posts the ledger entry and moves the request to DISBURSED.

## Ledger reversal (ADR-059)

- `POST /api/v1/ledger-entries/{id}/reversal-requests` — `{reason, idempotencyKey}`; step-up; `ledger.reversal.request`.
- `GET /api/v1/ledger-reversals` — people who may view the ledger.
- `POST /api/v1/ledger-reversals/{id}/decision` — `{decision, comment?, idempotencyKey}`; step-up; `ledger.reversal.approve`; never the requester.
- `POST /api/v1/ledger-reversals/{id}/execute` — `{idempotencyKey}`; step-up; `ledger.reversal.execute`; never the requester. Posts the compensating entry.
- `POST /api/v1/ledger-entries/{id}/emergency-reversal` — `{reason (10+ characters), idempotencyKey, confirm: true}`; step-up; Super Admin only; alerts.
- Errors: `LEDGER_ENTRY_NOT_REVERSIBLE`, `LEDGER_ENTRY_ALREADY_REVERSED`, `LEDGER_REVERSAL_PENDING`, `LEDGER_REVERSAL_SELF_APPROVAL`, `LEDGER_REVERSAL_NOT_PENDING`, `LEDGER_REVERSAL_NOT_APPROVED`, `INSUFFICIENT_FUNDS`.

## Account recovery (ADR-060)

- `POST /api/v1/auth/mfa/verify` — on enrolment also returns `recoveryCodes` (shown once).
- `POST /api/v1/auth/mfa/recovery-codes` — a new set; step-up; the old set stops working.
- `POST /api/v1/auth/mfa/recover` — `{code}`, for a password-only session. Spends the code, removes the authenticator, ends other sessions. 401 `AUTHENTICATION_FAILED` for any wrong code, 429 when guessing.
- `GET /api/v1/auth/mfa/status` — now includes `recoveryCodesRemaining`.

## Reminders and email (ADR-061)

- `GET|PUT /api/v1/notification-settings` — `reminders.configure`; PUT is step-up. GET returns queue counts and recent problems, never message bodies.
- `GET|PUT /api/v1/notification-preferences` — the caller's own email choice.
- `POST /api/internal/jobs/run` — also delivers the email outbox and returns `reminders_sent` and an `email` result.

## Session-outcome correction (ADR-063)

- `POST /api/v1/governance-sessions/{id}/outcome-corrections` — `{reason, idempotencyKey}` (`attendance.session.outcome.request`); step-up. Asks to reopen a SKIPPED session; changes nothing yet.
- `GET /api/v1/session-corrections` — the queue (requests with status and who asked).
- `POST /api/v1/imports/batches/{id}/void` — `{reason (≥10 chars), confirm: "VOID IMPORT", idempotencyKey}`; Super Admin only; step-up; within 72 hours of the commit; employee and Business Unit imports. Errors: `IMPORT_VOID_BLOCKED` (409, lists why), `IMPORT_VOID_WINDOW_CLOSED`, `IMPORT_VOID_NOT_AVAILABLE`, `REASON_REQUIRED`.
- `POST /api/v1/strategy-imports/{id}/void`, `POST /api/v1/history-imports/{id}/void`, `POST /api/v1/sign-in-imports/{id}/void` — `{reason (≥10 chars), confirm: "VOID IMPORT"}`; Super Admin only; step-up; within 72 hours (ADR-088). Same errors as above. A sign-in commit now also returns `batchId`.
- `POST /api/v1/session-corrections/{id}/decision` — `{decision: APPROVE|REJECT, comment, idempotencyKey} (a rejection needs a comment)` (`attendance.session.outcome.approve`); step-up; never the requester.
- `POST /api/v1/session-corrections/{id}/execute` — (`attendance.session.outcome.correct`); `{idempotencyKey}`; step-up; never the requester. Archives the roster and returns the session to SCHEDULED.
- `POST /api/v1/governance-sessions/{id}/emergency-outcome-correction` — `{reason, idempotencyKey, confirm: true}`, reason ≥ 10 characters (`attendance.session.outcome.emergency`, Super Admin); step-up; audited and alerted.
- Attendance amendments that refer to the roster being replaced are CANCELLED by the correction (status `CANCELLED`, event `CANCELLED`, audited; history kept) instead of blocking it (ADR-086). 409 when a request is already open.

## Strategy change control (ADR-064)

- `GET|POST /api/v1/strategy/change-requests` — list, or ask for a change to an objective, key result or sub-key result in an ACTIVE quarter (`strategy.change.request`).
- `POST /api/v1/strategy/change-requests/{id}/decision` — approve or reject (`strategy.change.approve`); step-up; never the requester. Approval applies the change in the same transaction.
- `GET /api/v1/strategy/history` — applied changes with before and after values.
- Direct `PATCH` of strategy items in an ACTIVE quarter now answers 409 `STRATEGY_CHANGE_REQUIRED`.

## Notification state and refusals (ADR-061, ADR-067)

- `GET /api/v1/notifications` — each item now carries `state` (`PENDING` shows as "Still waiting" while the request it points to is open).
- A 403 `PERMISSION_DENIED` or `BU_SCOPE_DENIED` for a signed-in person writes an `ACCESS_DENIED` audit row (method, route with `:id`, code; no body), at most one per person and route per minute.

## Configuration changes (ADR-068, ADR-069)

- `POST /api/v1/config-changes` — `{topic, target, proposed, reason, idempotencyKey}`. Topics: `VIOLATION_TYPE`, `PENALTY_RATE`, `REMINDER_SETTINGS`, `BU_REPORTING`, `ROLE_CHANGE`, `LOCK_SCHEDULE`, `RETENTION`. The person needs the topic's request permission; the proposal is validated exactly as applying it would be, then stored as PENDING. 409 `CONFIG_CHANGE_PENDING` when one is already waiting for that target; 422 with the setting's own reason when the values are not valid.
- `GET /api/v1/config-changes` — the queue and history (row-level security limits it to people who handle configuration).
- `POST /api/v1/config-changes/{id}/decision` — `{decision: APPROVE|REJECT, comment, idempotencyKey}`; step-up; needs `config.approve` (and `config.protected.approve` when the request is protected); 403 `CONFIG_CHANGE_SELF_APPROVAL` for the requester; a rejection needs a comment. Approval applies the change in the same transaction.
- `POST /api/v1/config-changes/{id}/withdraw` — the requester only.
- `POST /api/v1/config-changes/emergency` — `{topic, target, proposed, reason (≥ 10 characters), idempotencyKey, confirm: true}`; step-up; `config.emergency`.
- The one-step routes `POST /violation-types`, `PATCH /violation-types/{id}`, `POST /admin/penalty-rate`, `PUT /notification-settings` and `PATCH /business-units/{id}` (when status or weekly reporting changes) now create a request and answer `{request_id, status: "PENDING"}`; they take a `reason`.
- `GET /api/v1/roles`, `GET /api/v1/permissions` — roles with their permissions, member count and authenticator requirement; permissions with their protected flag. A role code on `POST /users` and `PUT /users/{id}/roles` is checked for shape only; the database decides whether it exists and may be granted.
- `GET /api/v1/lock-schedule` — the schedule in force, its history, the first week a change would apply to and how many weeks each version governs.

## Integrations (ADR-076)

- `GET /api/v1/integrations` — `integrations.view`. `{kinds, items, encryptionConfigured, environmentEmail, privateHostsAllowed}`. An item never contains a secret, only `secrets_set` (the names of the secrets that are saved), the last test result and, for webhooks, the number waiting and failed.
- `POST /api/v1/integrations/request` — `integrations.configure`, step-up. `{action: CREATE|UPDATE|DELETE, id?, kind?, name?, enabled?, settings?, secrets?, reason}`. Secrets are plain text over HTTPS here and are encrypted before anything is stored; on UPDATE a secret that is absent stays, `null` removes it (not allowed for a required one), a string replaces it. Checked first: kind, every setting against the kind, the secrets, and that every address the server will connect to is public. Answers `{request_id, status: "PENDING", protected: true}`; a Super Admin decides it through `POST /config-changes/{id}/decision`. 422 with the reason for any problem, 503 `INTEGRATIONS_KEY_MISSING` when a secret is sent and the server has no encryption key.
- `POST /api/v1/integrations/test` — `integrations.test`, step-up, 10 per minute. `{id?, kind?, settings?, secrets?, sendMail?}`: values typed in the form are used as typed, a secret left out falls back to the saved one of `id`. Answers `{ok, message, ms}`; a test of a saved integration is stored and audited.
- `POST /api/internal/jobs/run` now also delivers the webhook outbox (`data.webhooks = {claimed, sent, failed}`) and uses the enabled email integration (`data.email.transport` is `smtp:<host>` for an integration).
- Webhook delivery: `POST <url>` with headers `x-okr-event`, `x-okr-delivery`, `x-okr-timestamp` (unix seconds) and, when a signing secret is set, `x-okr-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">`. A receiver should reject timestamps more than five minutes old. Any 2xx counts as delivered.

## Audit log and health (ADR-071, ADR-072)

- `GET /api/v1/audit?action=&type=&outcome=&from=&to=&q=&cursor=&limit=` → `{rows, nextCursor}`; newest first, `limit` at most 500, `cursor` is the previous `nextCursor`; `audit.read`.
- `GET /api/v1/audit/export` — the same filters, CSV, at most 10,000 rows; the export is audited (`AUDIT_EXPORTED`).
- `GET /api/health` — public liveness: `{status: ok|degraded|unavailable}`, no details, 503 when not serving.
- `GET /api/internal/health` — header `x-jobs-secret`; figures and alerts (scheduler silent, failed job steps, stuck or failed email, development clock in production, limits not shared, email not configured).
- `POST /api/internal/jobs/run` accepts `JOBS_SECRET` and, during a rotation, `JOBS_SECRET_PREVIOUS`; each run leaves a heartbeat and, once a day, purges transient data.

## Dashboards

- `GET /api/v1/dashboards/bu`
- `GET /api/v1/dashboards/executive`

## Audit/notifications

- `GET /api/v1/audit`
- `GET /api/v1/notifications`
- `POST /api/v1/notifications/{id}/read`
- `POST /api/v1/notifications/read-all`

## Endpoint rules

### Submit report

Preconditions:

- caller is authorised BU Lead/admin according to policy;
- report belongs to caller's scope;
- report not FINAL_LOCKED;
- at least one Goal;
- all structural validations pass.

### Execution status

Normal BU Lead transition allowed:

- UNDEFINED → DONE
- UNDEFINED → NOT_DONE

### Integrity correction

Only Presenter/Admin/SuperAdmin.

Requires reason.

Uses governed transition and penalty decision.

### Attendance amendments

- Source attendance rows cannot be updated/deleted after roster finalisation.
- Request requires HR `attendance.amendment.request`, a valid finalised attendance record, proposed status and non-empty reason. Evidence is optional. No fixed request deadline applies.
- A submitted request remains PENDING and does not change effective status before a decision.
- Approve/reject requires `attendance.amendment.approve`; the authenticated reviewer must differ from the requester. Resolve identities server-side. Rejection is always audited and the requester is notified. The application decision is sufficient; no separate signed/written approval document is required. A mandatory reviewer rejection comment remains unresolved and must not be enforced until approved.
- Approval appends decision/amendment history and changes effective status without overwriting source roster values. Reject stale snapshots and concurrent pending requests with `409 CONFLICT` or an equivalent documented domain error.
- Every submission and decision is audited; send a notification after commit. Notification delivery failure must not undo a decision.
- Use idempotency keys or deduplication keys for amendment request creation and decision writes.

### Finance approval

Finance permission required; requester != approver; balance validated transactionally.

## Concurrency

Use `409 CONFLICT` for stale report version or conflicting edit state.

## Idempotency

Use idempotency keys for payment, integrity correction, and financial approval operations.

## Standard error codes

- AUTHENTICATION_REQUIRED
- PERMISSION_DENIED
- BU_SCOPE_DENIED
- REPORT_CONTENT_LOCKED
- REPORT_FINAL_LOCKED
- GOAL_MINIMUM_REQUIRED
- GOAL_SUB_KR_REQUIRED
- INVALID_STATE_TRANSITION
- INTEGRITY_REASON_REQUIRED
- PENALTY_DECISION_REQUIRED
- `ATTENDANCE_AMENDMENT_REASON_REQUIRED`
- `ATTENDANCE_AMENDMENT_PERMISSION_DENIED`
- `ATTENDANCE_AMENDMENT_SELF_APPROVAL`
- `ATTENDANCE_AMENDMENT_STALE`
- `ATTENDANCE_AMENDMENT_ALREADY_PENDING`
- `ATTENDANCE_SESSION_NOT_AMENDABLE`
- DISBURSEMENT_SELF_APPROVAL
- DISBURSEMENT_REJECTION_REASON_REQUIRED
- INSUFFICIENT_FUNDS
- CONCURRENT_UPDATE
- VALIDATION_ERROR


### Skip OKR API semantics
- `POST /api/v1/governance-sessions/{id}/skip-okr` requires `attendance.session.manage`, an idempotency key, and an explicit confirmation payload. The server derives the actor from authentication.
- On success, return session outcome `SKIPPED`, number of staff tagged `VIRTUAL_PRESENT`, operation/audit reference, timestamp, and notification status for all BU Leads. Notify every BU Lead and activate the required manual `skipped_session_summary_comment` for each BU report; the comment supplements, not replaces, the required weekly report. The operation affects physical-session attendance only; it must not cancel or waive weekly BU reports. The report workflow must require each BU to submit a manually authored performance summary for the skipped week and route the report for normal review. Do not expose a CANCELLED OKR outcome.
- Operation is all-or-nothing; retry returns the original result without duplicating rows. Reject invalid state, missing permission, already-finalised held roster, or conflicting concurrent session transition with a stable domain error.
- The API must not accept a client-supplied arbitrary staff list for the bulk operation; use the server-captured active staff roster scope.

## Quarterly score calculation and authorised correction contract (ADR-032)

- Quarter-score reads must expose the fixed denominator count, calendar reporting-week references, contributing weekly values, missing-report zero count, current score version, calculation timestamp/rule version and a link/reference to prior versions.
- At weekly final lock, ensure a non-submitted BU/week has durable auditable `0.00` + `NON_COMPLIANT` evidence even if no `weekly_reports` row exists.
- A late report exception must use a distinct server-side controlled amendment path protected by an explicit permission; never treat ordinary quarter/report update endpoints as an unlock mechanism. The authorised action must accept the late report, route it through normal review, require an approval and reason, and record an immutable amendment event.
- On acceptance, create a new quarter-score version using the reviewed late-week score instead of zero while preserving the fixed denominator. Return the prior and new quarterly score/version references. Preserve historical snapshots and the initial non-submission event.
- For a quarter already locked, the correction endpoint must not reopen general quarter editing. API responses and audit events must preserve actor, reason, decision, affected week, original/new weekly values, old/new quarterly values, timestamp and correlation ID.
- A submitted-but-unreviewed report must not be treated as a missing report by the API. It keeps its computed score in state `AWAITING_REVIEW`; the quarter stays `PROVISIONAL` while any submitted report is unreviewed; reviewing and recalculating writes a new FINAL version and never overwrites the provisional snapshot (ADR-081).


### Organization Holiday API semantics

- Provide a permission-gated operation (for example, `POST /api/v1/reporting-weeks/organization-holiday`) to declare one or more identified full reporting weeks as `ORGANIZATION_HOLIDAY`. Require `reporting_week_ids`, a non-empty reason, explicit confirmation and an idempotency key. Derive the actor from the authenticated session; never trust client-supplied actor identity.
- The operation is distinct from `POST .../skip-okr`: it changes the reporting-period state and does not mark a governance session `SKIPPED`, create `VIRTUAL_PRESENT` attendance rows, or activate skipped-session summary comments.
- On success, return the affected week IDs, prior/new reporting state, actor/timestamp, reason reference, audit/event IDs and any score-recalculation job/reference. Notify all BU Leads that reports are not required for the holiday period; suppress weekly submission reminders for those weeks.
- When the holiday is applied, no BU report is required; APIs and scheduler jobs must not create missing-report zero/NON_COMPLIANT evidence for that period. Exclude affected weeks from quarterly numerator and denominator. For a locked quarter, use a controlled audited amendment, preserve original published snapshots and create a new score version if eligibility changes.
- Reject caller attempts to assign holiday state directly via general CRUD endpoints. Operations are authorised, idempotent, audited and concurrency-safe. Holiday state changes after report submission or week/quarter lock must use the explicit amendment pathway.

### Late-report exceptions (implemented, ADR-050)
- `GET /api/v1/late-report-exceptions` — RLS-scoped list with events and the amendment result. BU Leads see only their BU.
- `GET /api/v1/late-report-exceptions/candidates` — finalised weeks with a zero-scored missing report and no live exception (`quarter.score.amend`).
- `POST /api/v1/late-report-exceptions` — `{ businessUnitId, reportingWeekId, reason, idempotencyKey }`; `quarter.score.amend`. Errors: `LATE_EXCEPTION_NOT_APPLICABLE`, `LATE_EXCEPTION_ALREADY_EXISTS`, `FINAL_LOCK_PENDING`, `REASON_REQUIRED`.
- The BU Lead then uses the ordinary report endpoints (`POST /weekly-reports`, goals, tasks, execution status, submit) and a `weekly_report.review` holder reviews it normally.
- `POST /api/v1/late-report-exceptions/{id}/apply` — `{ reason, idempotencyKey }`; `quarter.score.amend`; reviewer must differ (`LATE_AMENDMENT_SEGREGATION`); requires review (`LATE_REPORT_NOT_REVIEWED`). Returns old/new weekly and quarterly scores and the new quarterly version.
- `POST /api/v1/late-report-exceptions/{id}/revoke` — `{ reason }`; withdraws an authorisation or rejects a submitted late report; no score changes.

### Holiday amendment (implemented, ADR-051)
- `POST /api/v1/reporting-weeks/{id}/holiday-amendment` — `{ direction: "DECLARE"|"REVERSE", reason, idempotencyKey, confirm: true }`; `quarter.score.amend`. Returns the amendment id, whether the week/quarter were locked, backfilled zero count and per-BU old/new quarterly score and version. Errors: `INVALID_STATE_TRANSITION`, `LATE_EXCEPTION_PENDING`, `FINAL_LOCK_PENDING`, `REASON_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`.
- `GET /api/v1/holiday-amendments` — append-only history (score-amend / holiday-manage holders).

### Authentication hardening (implemented, ADR-052)
- `POST /api/v1/auth/login` → `{ ok, mfaRequired?, mfaEnrolmentRequired? }`. `mfaRequired: true` means the password was right and a code is still needed; the session is not usable until `/auth/mfa/verify` succeeds.
- `GET /api/v1/auth/mfa/status`, `POST /auth/mfa/enroll` (QR + secret, once), `POST /auth/mfa/verify` `{ code, factorId? }` (finish enrolment, finish sign-in, or step-up), `POST /auth/mfa/disable` `{ code }` (not for roles that require MFA).
- `POST /api/v1/auth/password/forgot` `{ email }` (always the same answer), `GET /auth/confirm?token_hash&type=recovery` (emailed link), `POST /auth/password/reset` `{ password }` (recovery session only), `POST /auth/password/change` `{ currentPassword, newPassword }`.
- `POST /api/v1/users/{id}/mfa-reset` `{ reason }` — `users.manage`, step-up, audited.
- Errors: `MFA_REQUIRED` (401), `MFA_ENROLMENT_REQUIRED` (403), `STEP_UP_REQUIRED` (401), `MFA_REQUIRED_BY_ROLE`, `MFA_ALREADY_ENROLLED`, `MFA_NOT_ENROLLED`, `RECOVERY_REQUIRED`, `PASSWORD_POLICY`, `RATE_LIMITED`.

### Reports (implemented, ADR-053)
- `GET /api/v1/reports` — the catalogue the caller may open, blocked reports with reasons, and the metric definitions.
- `GET /api/v1/reports/{id}?quarterId&buId&from&to` — runs one report under the caller's scope. Parameters are an allowlist (`422` otherwise). Result: `columns`, `rows`, `summary`, `charts`, `notes`, `dataStatus`, `generatedAt`, `scope`, `periodLabel`, `definitionVersion`.
- `GET /api/v1/reports/{id}/export?format=csv|xlsx|pdf[&cols=a,b]` — `reports.export`; same result and scope; audited; `413 EXPORT_TOO_LARGE` above 20,000 rows. `cols` can only narrow.
- `POST /api/v1/reports/{id}/snapshots` — `reports.snapshot` and organisation-wide scope; the server runs the report itself (the client supplies only title, note and filters). `GET /api/v1/report-snapshots`, `GET /api/v1/report-snapshots/{id}` (includes `checksumVerified`).
- `GET|POST /api/v1/saved-reports`, `PATCH|DELETE /api/v1/saved-reports/{id}` — definitions only; owner-only changes; recipients validated.
- `GET /api/v1/reports/insights?quarterId` — rules-engine findings with evidence (`model: null`). `POST /api/v1/reports/assistant` `{ question }` — routes to an approved report.
- Errors: `REPORT_NOT_FOUND`, `REPORT_NOT_AVAILABLE`, `EXPORT_TOO_LARGE`, `SNAPSHOT_SCOPE`.

## Historical reports (ADR-077) — Super Admin only (`history.import`)

- `GET /api/v1/history-imports` — recent uploads with state (`STAGING`, `STAGED`, `COMMITTED`).
- `POST /api/v1/history-imports` — multipart `file` (.xlsx or .csv, up to 10 MB / 20,000 rows). Answers `{staged:false, fileProblems, fileProblemCount, unknownUnits}` (nothing saved) or `{staged:true, batchId, rows, issueCount, issues}`; issues come from the database with the spreadsheet row.
- `POST /api/v1/history-imports/{id}/rehearse` — `{fillGaps}`. Runs the whole import and rolls it back; answers the counts and the recomputed quarterly scores with `rehearsal:true`.
- `POST /api/v1/history-imports/{id}/commit` — step-up. `{fillGaps, confirm:"IMPORT HISTORY"}`. One transaction; repeating it returns the first result with `already_committed:true`. Errors: 409 `HISTORY_ALREADY_IMPORTED`, `HISTORY_BATCH_STATE`; 422 `HISTORY_HAS_ISSUES`.

## Strategy and sign-in imports (ADR-079, ADR-080)

- `POST /api/v1/strategy-imports` — `strategy.import`. Multipart `file`. Answers `{fileName, sha256, rows, quarters, issues, issueCount}`; nothing is saved.
- `POST /api/v1/strategy-imports/commit` — `strategy.import`, step-up. `{rows, fileName, fileSha256, confirm: "IMPORT STRATEGY"}`. One transaction; the same file again returns the first result with `already_imported`. 422 `IMPORT_INVALID` lists up to 50 problems.
- `POST /api/v1/sign-in-imports` — `users.manage`. Multipart `file` with Email and Roles. Answers `{fileName, people, problems, problemCount}`; nothing is saved.
- `POST /api/v1/sign-in-imports/commit` — `users.manage`, step-up. `{people: [{row, email, roles}]}`. Answers `{results: [{row, email, created, message, setupLink}], created}`; a failing row is reported and the rest go ahead.
- `PATCH /api/v1/employees/{id}/roster` — `users.manage`. `{onRoster}`; audited as `EMPLOYEE_ROSTER_CHANGED`.

## Weekly quote workflow (ADR-084)

- `POST /api/v1/reporting-weeks/{id}/quote` — records the week's quote as a draft (`quote.record`); one per week.
- `POST /api/v1/quotes/{id}/submit` (`quote.record`), `/approve`, `/publish`, `/archive` (`quote.approve`). Errors: `INVALID_STATE_TRANSITION`, `QUOTE_SELF_APPROVAL`, `PERMISSION_DENIED`.
- `GET /api/v1/quotes?weekId={uuid}` — the published quote of the week for any signed-in user, or `null`.


## 4COREPAL (module off by default)

- `POST /api/v1/ai/assistant` `{ question (1..2000), conversationId? }` — one question. `403 AI_DISABLED` while the module is off, `403 PERMISSION_DENIED` without `ai.assistant.use`, `404 NOT_FOUND` for a conversation that is not the caller's. A provider failure, a missing provider or a reached spending limit is a normal `200` with `result: { ok: false, reason, message }`. Success returns `result: { ok: true, answer, statements[{kind, text, sources}], sources[{id, label, href, period, kind}], limitations[], retrievedAt, grounded }`.
- `GET /api/v1/ai/conversations` — the caller's own conversations. `GET /api/v1/ai/conversations/{id}` — their messages. Nobody else's, including a Super Admin's.

## OKR Session Notes & Meeting Intelligence (ADR-089 to ADR-093; `40-SESSION-NOTES.md`)

All routes need a signed-in session. Reads run under the caller's row-level security (an invisible record is `404 NOT_FOUND`). Writes are one database function each: permission, unit scope, state, version, audit and notification in one transaction. Mutations that carry `expectedVersion` answer `409 VERSION_CONFLICT` (details = the version now on record) when stale. `key` and `clientKey` (8 to 100 characters) make a repeated request return the first answer (`replayed:true`); the same key for another act is `409 IDEMPOTENCY_KEY_REUSED`. Common errors: `403 PERMISSION_DENIED`, `403 BU_SCOPE_DENIED`, `404 NOT_FOUND`, `409 INVALID_STATE_TRANSITION`, `409 SESSION_READ_ONLY`, `422 VALIDATION_ERROR`, `422 REASON_REQUIRED`, `422 LINK_TARGET_INVALID`, `409 ASSIGNEE_UNAVAILABLE`, `409 EVIDENCE_REQUIRED`, `403 SESSION_ACTION_SELF_VERIFICATION`.

| Method and path (under `/api/v1`) | Needs | Body / query → result |
|---|---|---|
| `GET /okr-sessions` | `session_notes.view` | Filters `q, bu, quarter, week, from, to, type, facilitator, participant, status, noteCategory, decisionStatus, actionStatus, linkType, linkId, limit, offset` → `{total, rows[]}` with counts, minutes status and keyword snippets |
| `POST /okr-sessions` | `session_notes.create` | `{title, typeId, date, weekId?, buId?, attendanceSessionId?, startsAt?, endsAt?, facilitatorId?, description?, agenda?, participants[{userId, role}], key}` → `{id, reference}`. An organisation-wide session (no `buId`) needs `view_all` |
| `GET /okr-sessions/{id}` | visible | Whole workspace (session, participants, notes, decisions, actions, risks, reviews, minutes, attachments, timeline) |
| `PATCH /okr-sessions/{id}` | `session_notes.update` and facilitator, creator or finaliser | `{expectedVersion, title?, typeId?, date?, startsAt?, endsAt?, facilitatorId?, description?, agenda?, attendanceSessionId?, reason?}`; a completed session needs `reason` |
| `POST /okr-sessions/{id}/transition` | update (archive and restore: `session_notes.archive`) | `{to: IN_PROGRESS \| COMPLETED \| ARCHIVED \| RESTORED, reason?, expectedVersion?, key}` → `{status, version, open_actions}` |
| `POST /okr-sessions/{id}/participants` | update and runs the session | `{userId, role?, remove?}` |
| `GET /okr-sessions/{id}/outstanding` | visible | `{actions[], risks[]}` still open from earlier sessions of the unit |
| `POST /okr-sessions/{id}/carry-forward` | update and runs the session | `{items:[{type: ACTION \| RISK, id, outcome, remarks?}], key}` → `{reviewed}` (the same item is reviewed, never copied) |
| `POST /okr-sessions/{id}/notes` | `session_notes.create` | `{category, title?, content, visibility, links[{target_type, target_id}], clientKey, reason?}` → `{id, version}` |
| `PATCH /okr-notes/{id}` | update and author, facilitator, creator or finaliser | `{expectedVersion, category?, title?, content?, visibility?, reason?}` → `{version}` (the autosave call; identical text → `unchanged:true`) |
| `POST /okr-notes/{id}/archive` | update | `{restore?, reason}` |
| `POST /okr-notes/{id}/links` | update | `{targetType, targetId, remove?}`; the target must exist and belong to the session's unit or be organisation-wide |
| `GET /okr-notes/{id}/versions` | can read the note | earlier saved states |
| `POST /okr-sessions/{id}/decisions` | `session_decisions.create` | `{title, description, background?, justification?, decisionDate?, affectedBuId?, involvedUserIds[], expectedOutcome?, followUp?, sourceNoteId?, authorityNote?, links[], clientKey}` → PROPOSED |
| `PATCH /okr-decisions/{id}` | `session_decisions.create` | amend a PROPOSED decision `{expectedVersion, …, reason}` |
| `POST /okr-decisions/{id}/decide` | approve or reject: `session_decisions.approve`; withdraw: its author or an approver (step-up) | `{outcome: APPROVE \| REJECT \| WITHDRAW, reason?, authorityNote?, expectedVersion?, key}` |
| `POST /okr-decisions/{id}/supersede` | `session_decisions.approve` (step-up) | `{title?, description?, …, reason, key}` → `{id, superseded_id}` |
| `GET /okr-decisions` | visible | `bu, quarter, status, from, to` |
| `POST /okr-sessions/{id}/actions` | `session_actions.create` | `{description, assigneeId, buId?, priority, dueDate, sourceNoteId?, sourceDecisionId?, requiresVerification, evidenceRequired, links[], clientKey}`; the assignee must be active; the due date not in the past |
| `PATCH /okr-actions/{id}` | the assignee, whoever set it, `session_actions.assign`, or a BU Lead of the unit with `session_actions.update` | `{expectedVersion, status?, progress?, blockedReason?, completionRemarks?, contextSessionId?, reason?, key?}`; blocking needs the reason, completing the remarks (and evidence if required), reopening or cancelling a reason |
| `POST /okr-actions/{id}/reassign`, `/extend`, `/escalate` | `session_actions.assign` | `{assigneeId, reason}`, `{dueDate, reason}`, `{reason}` |
| `POST /okr-actions/{id}/verify` | `session_actions.verify`, not the person who completed it | `{outcome: VERIFIED \| REJECTED, remarks?}` |
| `GET /okr-actions` | visible (or assigned to you) | `bu, quarter, status, assignee, overdue, from, to` |
| `POST /okr-sessions/{id}/risks`, `PATCH /okr-risks/{id}`, `GET /okr-risks` | `session_risks.manage` (reads: visible) | create `{kind, title, description, buId?, category, severity, businessImpact?, rootCause?, mitigation?, ownerId?, targetDate?, links[], clientKey}`; update `{expectedVersion, status?, severity?, …, resolutionNote?}` |
| `POST /okr-links` | the owner type's permission | `{ownerType: DECISION \| ACTION \| RISK, ownerId, targetType, targetId, remove?}` |
| `GET` and `POST /okr-sessions/{id}/minutes` | update and runs the session | GET `?management=true` → proposed text; POST `{content, audience, aiDrafted?, aiModel?, expectedVersion?, key}` saves the working draft (a new revision after a finalised one) |
| `POST /okr-sessions/{id}/minutes/ai-summary` | update, `ai.assistant.use`, module on | `{management?}` → `{ok:true, text, model}` or `{ok:false, reason, message}`; nothing is saved |
| `GET /okr-minutes/{id}`, `POST …/submit`, `…/review`, `…/finalise` | read: visible; review and finalise: `session_notes.finalise` | submit, review and finalise carry `expectedVersion`; finalise also `key`, step-up, and needs a completed session |
| `GET` and `POST /okr-sessions/{id}/attachments`; `GET /okr-attachments/{id}`; `POST /okr-attachments/{id}/remove` | create (upload); visible (download) | multipart `file` + `metadata {recordType, recordId, purpose}`; type, size and content checks as for evidence; removal needs a reason |
| (uploads) | | `POST …/attachments` also answers `422 MALWARE_DETECTED` (the file was refused and not stored) and `503 SCAN_UNAVAILABLE` (a configured ClamAV scanner could not be reached); notes may contain `@[Name](user:uuid)` mentions |
| `GET /okr-sessions/{id}/export?format=pdf&revision=` | `session_notes.export` | minutes PDF; recorded in the audit log |
| `GET /okr-exports?kind=&format=&bu=&quarter=&from=&to=` | `session_notes.export` | kinds `bu-history, quarterly, decisions, outstanding-actions, overdue-actions, risks, action-completion`; formats `csv, xlsx, pdf`; capped; audited |
| `GET /okr-session-dashboard` | visible | counts from the records the caller may read |
| `GET /okr-link-options?bu=&week=`, `GET /okr-people`, `GET` and `POST /okr-session-types` | `session_notes.view`; a session permission; view, and `session_notes.configure` to change | pickers and configuration |

## Executive Oversight, Commentary & Recommendations (ADR-096 to ADR-103; `41-EXECUTIVE-OVERSIGHT.md`)
Comments: `GET/POST executive-comments`, `GET executive-comments/{id}` and `/history`, `POST …/replies|amend|withdraw|links|attachments`. Recommendations: `GET/POST executive-recommendations`, `GET/PATCH executive-recommendations/{id}`, `GET …/history`, `POST …/publish|withdraw|close|replies|links|attachments`. The addressed unit's record: `POST executive-recommendation-targets/{id}/acknowledge|respond|progress|follow-up|reassign`. Files: `GET executive-attachments/{id}`, `POST …/remove`. Oversight: `GET executive-oversight/dashboard|context|link-options|people|export`, `GET/POST executive-oversight/categories|escalation-rules`.

Conventions: unknown body keys → `422 VALIDATION_ERROR`; the author, role, status, reference and time are never accepted from the body; write routes accept `requestKey` (replay returns the first result with `replayed: true`); stale versions → `409 VERSION_CONFLICT`. Not found and not permitted both return 404 for single records and an empty list for registers. New codes: `DUPLICATE_RECOMMENDATION` (409), `COMMENT_WITHDRAWN` (409), `RECOMMENDATION_CLOSED` (409), `BU_INACTIVE` (409), `RECIPIENT_UNAVAILABLE` (409).
`respond` bodies: `{ decision: ACCEPT|PARTIAL|DECLINE|ALTERNATIVE|CONSIDERING|CLARIFICATION, body? }` — DECLINE without a body is `REASON_REQUIRED`; PARTIAL, ALTERNATIVE and CLARIFICATION without a body are `VALIDATION_ERROR`. `progress` bodies: `{ kind: PROGRESS|IMPLEMENTED, body }`. Exports: `executive-oversight/export?kind=recommendations|comments&format=csv|xlsx|pdf` (+ filters).

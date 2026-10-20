# 4CORE-OKR Acceptance Criteria

## Reporting

### AC-WR-001
GIVEN a weekly report with zero Goals, WHEN Submit Report is selected, THEN submission is rejected with GOAL_MINIMUM_REQUIRED.

### AC-WR-002
GIVEN one valid Goal with Tasks, WHEN Submit Report is selected, THEN submission succeeds if all structural requirements pass.

### AC-WR-003
GIVEN a weak SMART score, WHEN Submit Report is selected, THEN submission succeeds and SMART warnings remain visible.

### AC-WR-004
GIVEN Tuesday time before 18:00 WAT, WHEN BU Lead deletes a Goal, THEN deletion is allowed within scope.

### AC-WR-005
GIVEN Tuesday time at/after 18:00 WAT, WHEN BU Lead attempts to delete a Goal, THEN the operation is rejected.

### AC-WR-006
GIVEN Content Lock, WHEN BU Lead attempts to edit Task description, THEN the operation is rejected.

### AC-WR-007
GIVEN Content Lock, WHEN BU Lead changes UNDEFINED → DONE, THEN status changes if report is not final locked.

### AC-WR-008
GIVEN Final Lock, WHEN a task remains UNDEFINED, THEN status becomes NOT_DONE.

### AC-WR-009
GIVEN Final Lock, WHEN any normal mutation is attempted, THEN the operation is rejected.

### AC-WR-010
GIVEN a SKIPPED physical OKR session, WHEN the normal final-lock time arrives, THEN the weekly report still final-locks and remains subject to reporting compliance. GIVEN a week marked ORGANIZATION_HOLIDAY, THEN the system suppresses report-required handling and does not create a missing-report zero or NON_COMPLIANT solely for no submission.

## Scoring

### AC-SC-001
4 Goals with 3 Done results in 75% base score.

### AC-SC-002
A Goal with 10 Tasks has the same weight as a Goal with 1 Task.

### AC-SC-003
Stretch Goals contribute to the denominator and numerator like other Goals.

### AC-SC-004
No submitted report results in 0% and NON_COMPLIANT.

### AC-SC-005
A submitted report with all Goals Not Done results in 0% but COMPLIANT.

### AC-SC-006
Base 80.00% with one 5% penalty results in 76.00%.

### AC-SC-007
Penalty never reduces score below 0.00%.

### AC-SC-008
Base 80.00% with two 5% penalties results in 72.00%; rates are summed and applied once to the original base score.

### AC-SC-009
Base 3.00% with one 10% penalty results in 2.70%.

### AC-SC-010
A combined applied penalty rate of 100% or greater results in 0.00%, never a negative score.

### AC-SC-011
Final score is rounded to two decimal places in persisted score snapshots and audit evidence; every percentage is displayed to one decimal place in dashboards, reports and exports (ADR-055). Audit evidence retains the base score, individual rates, combined rate and rule version.

## Integrity

### AC-INT-001
Presenter can perform integrity correction.

### AC-INT-002
Admin can perform integrity correction.

### AC-INT-003
SuperAdmin can perform integrity correction.

### AC-INT-004
Every correction requires reason.

### AC-INT-005
DONE → NOT_DONE triggers penalty decision.

### AC-INT-006
NOT_DONE → DONE does not trigger penalty.

### AC-INT-007
Waived penalty requires waiver reason.

### AC-INT-008
SuperAdmin cannot bypass correction workflow.

## Security

### AC-SEC-001
Finance BU Lead cannot retrieve HR weekly report by UUID.

### AC-SEC-002
Changing a BU filter in a request does not bypass RLS.

### AC-SEC-003
Executive can read cross-BU data but cannot edit weekly reports.

### AC-SEC-004
Audit records cannot be updated/deleted through application or exposed DB role.

## Attendance amendments

### AC-ATT-001
Finalising a roster makes source attendance records read-only; direct API/database UPDATE or DELETE is rejected.

### AC-ATT-002
An authorised HR user can submit an amendment request at any time after finalisation; no deadline window blocks submission.

### AC-ATT-003
A request without a non-empty reason is rejected. Supporting evidence is optional.

### AC-ATT-004
Submitting a request does not change effective attendance status before approval.

### AC-ATT-005
Only a different authorised Admin/designated HR approver can decide a request. A requester cannot approve their own request even if they hold both request and approval permissions.

### AC-ATT-006
Rejecting a request creates a durable decision/audit record and informs the requester. A separate written approval document is not required. A mandatory reviewer comment remains unresolved and must not be enforced until approved.

### AC-ATT-007
Approving a request appends an amendment and changes effective status while preserving the original roster/status and previous amendment history.

### AC-ATT-008
At most one request per attendance record is pending; stale status snapshots cannot be approved and must be resubmitted against current effective status.

### AC-ATT-009
Every submission and decision creates a durable audit record with actor, timestamp, original/effective/proposed values, reason, decision, and optional evidence reference. Notification failure does not roll back the decision.

### AC-ATT-010
There is no CANCELLED OKR outcome. SKIPPED sessions create read-only VIRTUAL_PRESENT rows for every staff member in the session roster scope and are not individually amendable; correction of an erroneous session outcome requires an authorised, audited exception workflow. Every BU must still submit a weekly report for the skipped week, manually enter a performance summary for that week, and have the report reviewed.

## Finance

### AC-FIN-001
HR can create a disbursement request when authorised.

### AC-FIN-002
Finance can approve eligible requests.

### AC-FIN-003
Finance cannot approve a request created by the same user.

### AC-FIN-004
Finance rejection requires justification.

### AC-FIN-005
Request exceeding available balance cannot be approved.

### AC-FIN-006
Two concurrent approvals cannot drive the fund negative.

### AC-FIN-007
Violation payment and ledger credit are atomic.

### AC-FIN-008
Disbursement and ledger debit are atomic.

## Strategy

### AC-STR-001
A quarter with fewer than 3 KRs cannot be activated/finalised.

### AC-STR-002
A quarter with more than 4 KRs cannot be activated/finalised.

### AC-STR-003
A KR without a Sub-KR cannot be activated/finalised.

### AC-STR-004
At new-quarter start, previous quarter becomes read-only.


### Attendance operational workflow acceptance criteria
1. Given a new weekly attendance roster, when the roster is created, then every active staff member in the session snapshot is pre-populated as PRESENT by the server.
2. Given a held session in draft, when an authorised HR user changes a staff status, then the configured status is saved and the visible per-status tally is updated.
3. Given a held session, when an authorised user confirms Skip OKR for this week, then the session is SKIPPED and every staff member in the session roster snapshot is VIRTUAL_PRESENT atomically.
4. Given a successful skip, when the user views the week, then the UI clearly states SKIPPED WEEK and VIRTUAL PRESENT, and normal individual status editing is disabled.
5. Given a skip operation that fails, then neither the session state nor any partial set of VIRTUAL_PRESENT rows is committed.
6. Given a repeated request with the same idempotency key, then no duplicate attendance rows are created.
7. Given a SKIPPED session, then no attendance-based absence violation or penalty is generated.
8. Given a skipped OKR week, then every BU is still required to submit its weekly report, the performance summary must be manually entered, and the report must follow the standard review workflow.
9. Given an unauthorised user, when they invoke skip through a direct request, then the server denies it and records the security-relevant outcome.

### AC-SC-012 — Fixed quarterly denominator
The quarterly execution score uses all NORMAL and SKIPPED-session reporting weeks in the quarter and excludes officially declared ORGANIZATION_HOLIDAY weeks. A missing report in a reportable week contributes 0.00 unless an authorised exception applies. The denominator does not shrink because a report is missing, and each eligible week contributes exactly once. A quarter with no eligible weeks returns N/A.

### AC-SC-013 — Missing report compliance distinction
At weekly final lock, a report not submitted scores 0.00 and is NON_COMPLIANT unless an authorised exception applies. A submitted report scoring 0.00 is distinguishable from non-submission. A submitted-but-unreviewed report is not assigned the missing-report zero merely because review is pending; it keeps its score and is reported as awaiting review (AC-SC-016).

### AC-SC-014 — Controlled late-report correction after quarter lock
An authorised late report can be submitted and reviewed after quarter lock under the controlled exception path. On acceptance, the application creates an immutable new quarterly score version using the reviewed weekly score in place of the missing-report zero. It preserves the original zero and prior published quarter snapshot, records reason/authorisation/actor/timestamps/old-new values/recalculation details, and does not reopen the quarter for ordinary edits.

### AC-SC-015 — Reproducible quarterly calculation
A quarterly score snapshot stores its denominator, reporting-week references and values, missing-report zero count, numerator, score result, rule version, calculation timestamp and prior snapshot/reference where applicable. Identical inputs and rule versions produce the same result.

### AC-SC-016 — Unreviewed reports and unfinalised weeks (ADR-081)
A submitted report awaiting review keeps its computed weekly score, is reported with contribution state `AWAITING_REVIEW`, and is not counted as a missing report. While any submitted report is unreviewed the quarterly score is `PROVISIONAL`; reviewing it and recalculating produces a new FINAL version without overwriting the provisional snapshot. Weeks that have not yet reached final lock are included in the denominator, contribute `0.00` as `PENDING` (never as a missing-report zero), and also keep the quarter `PROVISIONAL`. Covered by the DB test `a submitted but unreviewed report keeps its score and holds the quarter PROVISIONAL (ADR-081)`.


## Organization Holiday acceptance criteria

- HR, Admin and Super Admin (or a user granted the explicit permission) can declare selected reporting week(s) `ORGANIZATION_HOLIDAY` with mandatory reason, confirmation and an immutable audit event.
- The action is distinct from Skip OKR; it does not mark the physical session as SKIPPED, create `VIRTUAL_PRESENT`, or activate skipped-session summary comments.
- All BU Leads are notified of the holiday period and that no weekly report is due. Normal report reminders and overdue notifications are suppressed for the affected period.
- No missing-report zero or `NON_COMPLIANT` state is assigned solely for an organisation-holiday week; that week is excluded from the quarter denominator and numerator.
- Normal and SKIPPED-session weeks remain reportable and counted. For a skipped session, all BU Leads are notified and each BU's report requires a manually authored summary comment as well as explicit submission and normal review.
- Post-lock holiday-state changes are controlled/audited; if eligibility changes, a new versioned quarterly score snapshot is created and earlier snapshots remain immutable.
- If there are no eligible reporting weeks in the quarter, the quarterly score is `N/A` with a clear reason, and no division by zero occurs.

- Given a skipped physical session, when all BU Leads are notified, then each BU report has an activated required manual summary-comment field; report submission without that comment is blocked, while the weekly report and normal review remain mandatory.


## Configuration, roles and operations (ADR-068 to 072)

### AC-CFG-001
A governance setting (violation type or fine, integrity penalty rate, reminder and email settings, Business Unit reporting status, roles and their permissions, lock times, retention) changes only when one person asks and a different person approves, or a Super Admin applies it in an emergency with a reason, a fresh authenticator check, an audit entry and an alert.

### AC-CFG-002
A request is validated when it is made with the same rules that applying it uses; an invalid request never reaches an approver and leaves no trace except the refusal.

### AC-RBAC-001
A new role can be created, changed and deleted in the application without a release; no database function, API route or screen depends on the name of a role.

### AC-RBAC-002
A request cannot give a role a permission its requester does not hold; protected permissions and the authenticator requirement need a Super Admin to approve; a change cannot add a conflicting combination; the last holder of `roles.manage`, `config.protected.approve` or `users.manage` cannot be removed; deleting a role moves its holders.

### AC-RBAC-003
The permission matrix of the shipped roles equals `tests/db/fixtures/role-matrix.json`, and the HTTP answers of the guarded endpoints follow it for every seeded person.

### AC-SCHED-001
The lock schedule in force is versioned and immutable; a new version applies only to weeks generated after it was approved; a generated week keeps its times and the version it was generated under.

### AC-OPS-001
Every run of the scheduler leaves a heartbeat; health reports a silent scheduler, failed job steps, stuck or failed email and a development clock on a production database; the public liveness endpoint shows no details.

### AC-OPS-002
Sign-in and authenticator attempts are counted in one place shared by every instance in production, and a restart does not give fresh attempts.

### AC-OPS-003
Read notifications and finished emails older than the configured periods are removed once a day; audit, ledger, score and report records are never removed.

### AC-AUD-001
The audit log can be filtered and paged without loading the whole history, and exported to CSV (at most 10,000 rows), and the export is itself audited.


## Integrations (ADR-076)

### AC-INT-010
Email, an AI provider and webhooks can be added, changed, switched on or off, tested and removed in the application; every change is a request a Super Admin approves (or applies in an emergency).

### AC-INT-011
A secret entered for an integration is encrypted before it is stored and is never returned by any route, shown on any screen, or written to the audit log or a change request in the clear; without an encryption key the application refuses to store one and says why.

### AC-INT-012
An address an integration connects to is refused unless it is https (outside development), carries no credentials and resolves only to public addresses, when the change is asked for and again at every delivery; redirects are not followed.

### AC-INT-013
An enabled SMTP integration carries the application's email in place of the server's own settings; an enabled webhook receives the audit events it asked for, signed, with retries and a give-up, and never receives old or new values or a reason.

### AC-INT-014
Testing an integration sends only fixed harmless content and stores and audits the result.

### AC-HIST-001
Only a role holding `history.import` (Super Admin) can upload, rehearse or commit historical reports; no other role can be given the permission, whoever asks.

### AC-HIST-002
Every problem in a sheet is reported with its spreadsheet row; nothing is written unless the whole file is clean; the same file cannot be committed twice.

### AC-HIST-003
A rehearsal shows the recomputed quarterly scores and leaves no report, week, quarter or score behind.

### AC-HIST-004
A commit produces scores through the ordinary scoring engine, sends no notification, email or webhook, writes an audit record and makes the staged rows immutable.

### AC-GAP-001
A person can be taken off the attendance roster without losing their sign-in; new rosters, including the virtual-present roster of a skipped session, honour it; existing rosters do not change; the change is audited.

### AC-GAP-002
The strategy import refuses an active quarter, a quarter that already has an objective, fewer than 3 or more than 4 key results, gaps in numbering and mixed objectives, and writes nothing unless the whole sheet is valid; the same file cannot be applied twice.

### AC-GAP-003
The sign-in import creates accounts only for active employees without one, only with roles the actor may hand out, with a one-time set-password link and no chosen password.

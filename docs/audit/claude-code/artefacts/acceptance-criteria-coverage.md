# Acceptance-criteria traceability

11 of 82 criteria are cited by at least one test (13%).

| Area | Cited | Total |
|---|---|---|
| AC-ATT | 3 | 10 |
| AC-AUD | 0 | 1 |
| AC-CFG | 0 | 2 |
| AC-FIN | 0 | 8 |
| AC-GAP | 0 | 3 |
| AC-HIST | 0 | 4 |
| AC-INT | 1 | 13 |
| AC-OPS | 0 | 3 |
| AC-RBAC | 0 | 3 |
| AC-SC | 4 | 16 |
| AC-SCHED | 0 | 1 |
| AC-SEC | 2 | 4 |
| AC-STR | 0 | 4 |
| AC-WR | 1 | 10 |

## Cited
- AC-ATT-001: tests/db/attendance.test.ts
- AC-ATT-002: tests/db/attendance.test.ts
- AC-ATT-010: tests/db/attendance.test.ts
- AC-INT-002: tests/db/scoring_edges.test.ts
- AC-SC-002: tests/db/scoring_edges.test.ts
- AC-SC-003: tests/db/scoring_edges.test.ts
- AC-SC-005: tests/db/scoring_edges.test.ts
- AC-SC-014: tests/db/late_report.test.ts
- AC-SEC-001: tests/api/api.test.ts
- AC-SEC-004: tests/db/security.test.ts
- AC-WR-004: tests/db/reporting.test.ts

## Not cited by any test
- AC-ATT-003: A request without a non-empty reason is rejected. Supporting evidence is optional.
- AC-ATT-004: Submitting a request does not change effective attendance status before approval.
- AC-ATT-005: Only a different authorised Admin/designated HR approver can decide a request. A requester cannot approve their own request even if they hol
- AC-ATT-006: Rejecting a request creates a durable decision/audit record and informs the requester. A separate written approval document is not required.
- AC-ATT-007: Approving a request appends an amendment and changes effective status while preserving the original roster/status and previous amendment his
- AC-ATT-008: At most one request per attendance record is pending; stale status snapshots cannot be approved and must be resubmitted against current effe
- AC-ATT-009: Every submission and decision creates a durable audit record with actor, timestamp, original/effective/proposed values, reason, decision, an
- AC-AUD-001: The audit log can be filtered and paged without loading the whole history, and exported to CSV (at most 10,000 rows), and the export is itse
- AC-CFG-001: A governance setting (violation type or fine, integrity penalty rate, reminder and email settings, Business Unit reporting status, roles and
- AC-CFG-002: A request is validated when it is made with the same rules that applying it uses; an invalid request never reaches an approver and leaves no
- AC-FIN-001: HR can create a disbursement request when authorised.
- AC-FIN-002: Finance can approve eligible requests.
- AC-FIN-003: Finance cannot approve a request created by the same user.
- AC-FIN-004: Finance rejection requires justification.
- AC-FIN-005: Request exceeding available balance cannot be approved.
- AC-FIN-006: Two concurrent approvals cannot drive the fund negative.
- AC-FIN-007: Violation payment and ledger credit are atomic.
- AC-FIN-008: Disbursement and ledger debit are atomic.
- AC-GAP-001: A person can be taken off the attendance roster without losing their sign-in; new rosters, including the virtual-present roster of a skipped
- AC-GAP-002: The strategy import refuses an active quarter, a quarter that already has an objective, fewer than 3 or more than 4 key results, gaps in num
- AC-GAP-003: The sign-in import creates accounts only for active employees without one, only with roles the actor may hand out, with a one-time set-passw
- AC-HIST-001: Only a role holding `history.import` (Super Admin) can upload, rehearse or commit historical reports; no other role can be given the permiss
- AC-HIST-002: Every problem in a sheet is reported with its spreadsheet row; nothing is written unless the whole file is clean; the same file cannot be co
- AC-HIST-003: A rehearsal shows the recomputed quarterly scores and leaves no report, week, quarter or score behind.
- AC-HIST-004: A commit produces scores through the ordinary scoring engine, sends no notification, email or webhook, writes an audit record and makes the 
- AC-INT-001: Presenter can perform integrity correction.
- AC-INT-003: SuperAdmin can perform integrity correction.
- AC-INT-004: Every correction requires reason.
- AC-INT-005: DONE → NOT_DONE triggers penalty decision.
- AC-INT-006: NOT_DONE → DONE does not trigger penalty.
- AC-INT-007: Waived penalty requires waiver reason.
- AC-INT-008: SuperAdmin cannot bypass correction workflow.
- AC-INT-010: Email, an AI provider and webhooks can be added, changed, switched on or off, tested and removed in the application; every change is a reque
- AC-INT-011: A secret entered for an integration is encrypted before it is stored and is never returned by any route, shown on any screen, or written to 
- AC-INT-012: An address an integration connects to is refused unless it is https (outside development), carries no credentials and resolves only to publi
- AC-INT-013: An enabled SMTP integration carries the application's email in place of the server's own settings; an enabled webhook receives the audit eve
- AC-INT-014: Testing an integration sends only fixed harmless content and stores and audits the result.
- AC-OPS-001: Every run of the scheduler leaves a heartbeat; health reports a silent scheduler, failed job steps, stuck or failed email and a development 
- AC-OPS-002: Sign-in and authenticator attempts are counted in one place shared by every instance in production, and a restart does not give fresh attemp
- AC-OPS-003: Read notifications and finished emails older than the configured periods are removed once a day; audit, ledger, score and report records are
- AC-RBAC-001: A new role can be created, changed and deleted in the application without a release; no database function, API route or screen depends on th
- AC-RBAC-002: A request cannot give a role a permission its requester does not hold; protected permissions and the authenticator requirement need a Super 
- AC-RBAC-003: The permission matrix of the shipped roles equals `tests/db/fixtures/role-matrix.json`, and the HTTP answers of the guarded endpoints follow
- AC-SC-001: 4 Goals with 3 Done results in 75% base score.
- AC-SC-004: No submitted report results in 0% and NON_COMPLIANT.
- AC-SC-006: Base 80.00% with one 5% penalty results in 76.00%.
- AC-SC-007: Penalty never reduces score below 0.00%.
- AC-SC-008: Base 80.00% with two 5% penalties results in 72.00%; rates are summed and applied once to the original base score.
- AC-SC-009: Base 3.00% with one 10% penalty results in 2.70%.
- AC-SC-010: A combined applied penalty rate of 100% or greater results in 0.00%, never a negative score.
- AC-SC-011: Final score is rounded to two decimal places in persisted score snapshots and audit evidence; every percentage is displayed to one decimal p
- AC-SC-012: The quarterly execution score uses all NORMAL and SKIPPED-session reporting weeks in the quarter and excludes officially declared ORGANIZATI
- AC-SC-013: At weekly final lock, a report not submitted scores 0.00 and is NON_COMPLIANT unless an authorised exception applies. A submitted report sco
- AC-SC-015: A quarterly score snapshot stores its denominator, reporting-week references and values, missing-report zero count, numerator, score result,
- AC-SC-016: A submitted report awaiting review keeps its computed weekly score, is reported with contribution state `AWAITING_REVIEW`, and is not counte
- AC-SCHED-001: The lock schedule in force is versioned and immutable; a new version applies only to weeks generated after it was approved; a generated week
- AC-SEC-002: Changing a BU filter in a request does not bypass RLS.
- AC-SEC-003: Executive can read cross-BU data but cannot edit weekly reports.
- AC-STR-001: A quarter with fewer than 3 KRs cannot be activated/finalised.
- AC-STR-002: A quarter with more than 4 KRs cannot be activated/finalised.
- AC-STR-003: A KR without a Sub-KR cannot be activated/finalised.
- AC-STR-004: At new-quarter start, previous quarter becomes read-only.
- AC-WR-001: GIVEN a weekly report with zero Goals, WHEN Submit Report is selected, THEN submission is rejected with GOAL_MINIMUM_REQUIRED.
- AC-WR-002: GIVEN one valid Goal with Tasks, WHEN Submit Report is selected, THEN submission succeeds if all structural requirements pass.
- AC-WR-003: GIVEN a weak SMART score, WHEN Submit Report is selected, THEN submission succeeds and SMART warnings remain visible.
- AC-WR-005: GIVEN Tuesday time at/after 18:00 WAT, WHEN BU Lead attempts to delete a Goal, THEN the operation is rejected.
- AC-WR-006: GIVEN Content Lock, WHEN BU Lead attempts to edit Task description, THEN the operation is rejected.
- AC-WR-007: GIVEN Content Lock, WHEN BU Lead changes UNDEFINED → DONE, THEN status changes if report is not final locked.
- AC-WR-008: GIVEN Final Lock, WHEN a task remains UNDEFINED, THEN status becomes NOT_DONE.
- AC-WR-009: GIVEN Final Lock, WHEN any normal mutation is attempted, THEN the operation is rejected.
- AC-WR-010: GIVEN a SKIPPED physical OKR session, WHEN the normal final-lock time arrives, THEN the weekly report still final-locks and remains subject 

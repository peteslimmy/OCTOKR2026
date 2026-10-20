# 4CORE-OKR Legacy Parity Assessment (Requirements Traceability)

Date of assessment: 14 October 2026. Responds to ADR-054 item 9 ("Legacy parity assessment").

**Update, 15 October 2026.** The acceptance criteria added since (AC-CFG-001/002, AC-RBAC-001 to 003, AC-SCHED-001, AC-OPS-001 to 003, AC-AUD-001 in `docs/20`) are each covered by an automated test (database, HTTP or browser); the counts in section 2 were taken before them and are not recomputed. The limitation below is unchanged: no legacy application or data exists in the workspace.

## 1. Important limitation: no comparison with the old application was possible

The workspace contains **no legacy application code, no legacy database and no legacy data**. It holds only requirement documents (`../spec`, `../spec2`, `docs/`). A true "old versus new" behavioural comparison therefore **was not performed and cannot be claimed**.

What this document is instead: a **requirements traceability matrix**. For every acceptance criterion in `docs/20-ACCEPTANCE-CRITERIA.md`, and for every legacy behaviour the specification marks as superseded, it records where the new system implements the requirement and which automated test covers it.

To perform a real parity check, one of these is needed:

- read access to the old application (running instance or source code) and to a copy of its database (a masked copy is enough), so that the same weekly reports, scores, attendance records, violations and ledger entries can be run through both systems and the outputs compared; or
- an exported set of legacy outputs (weekly scores, quarterly scores, ledger balances, attendance tallies) for a known period, to use as expected values in regression tests.

Until then, any statement that the new system "matches" the old one would be unsupported. Migration rules for legacy data are in `docs/22-DATA-MIGRATION.md`; no migration has been exercised against real legacy data.

## 2. Summary

| Status | Count |
|---|---|
| Met (implemented and covered by an automated test) | 68 |
| Met, untested (implemented, no automated test found) | 6 |
| Partly | 2 |
| Not built | 0 |
| Not applicable | 0 |
| **Acceptance criteria assessed** | **76** |

Share of criteria Met with automated test coverage: 89.5% (68 of 76). Share Met or Met, untested: 97.4% (74 of 76).

Separately, 9 superseded legacy behaviours were checked (section 5): all 9 are treated as Superseded in the new system. The "Director/Manager approval" and "scoring from task counts" rows rest partly on reading the code rather than on a test that targets the old behaviour.

## 3. Method and its limits

- Sources read: `docs/20-ACCEPTANCE-CRITERIA.md` in full; `docs/00-SOURCE-OF-TRUTH.md` (superseded rules), `docs/24-DECISIONS.md` (ADR-054 onwards) and `docs/25-IMPLEMENTATION-NOTES.md`. Documents 03 and 04 were only skimmed.
- Evidence sought in `supabase/migrations/` (the database enforces most rules), `src/app` and `src/lib`, and the tests in `tests/db`, `tests/api`, `tests/concurrency`, `tests/e2e` and `src/**/__tests__`.
- **Met** means: the rule is implemented and at least one automated test named in the evidence column exercises it. **Met, untested**: implemented, but no test asserting it was found. **Partly**: part of the requirement is missing. **Not found** would be used where no evidence exists; none was needed.
- I did **not run** any test suite and did not start servers. "Covered by a test" means a test with that purpose exists in the repository, not that it passed today. I read test titles and, in places, test bodies; I did not read every assertion. Treat a "Met" as "the test exists and targets this rule".
- Only a handful of tests cite AC identifiers in their titles (for example AC-WR-004/005, AC-SEC-004). The mapping to the other criteria is my reading of the test titles.
- Test file names below are given without the folder where the folder is obvious: `db/` is `tests/db/`, `api/` is `tests/api/`, `e2e/` is `tests/e2e/`, `conc/` is `tests/concurrency/`, `unit/` is `src/**/__tests__/`.

## 4. Traceability matrix

### Reporting

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-WR-001 | Submitting a report with zero Goals is rejected (GOAL_MINIMUM_REQUIRED). | Met | `db/reporting.test.ts` "submission: needs >= 1 goal (GOAL_MINIMUM_REQUIRED)..." | UI message in `weekly/[reportId]/report-editor.tsx`. |
| AC-WR-002 | One valid Goal with Tasks submits successfully. | Met | `db/reporting.test.ts` (same test); `e2e/03-weekly-lifecycle.spec.ts` "the BU Lead drafts two goals and submits the report" | |
| AC-WR-003 | A weak SMART score never blocks submission; warnings stay visible. | Met | `db/reporting.test.ts` ("weak SMART never blocks"); `unit/smart.test.ts`; `components/smart-panel` used by the editor | Visibility of the warning is in the UI; no e2e assertion on it was found. |
| AC-WR-004 | Goal deletion allowed on Tuesday before 18:00 WAT. | Met | `db/reporting.test.ts` "content edits are allowed at 17:59:59 ... (AC-WR-004/005)" | |
| AC-WR-005 | Deletion rejected at or after 18:00 WAT Tuesday. | Met | Same test, at 18:00:00. | |
| AC-WR-006 | Content Lock: Task description edit rejected. | Met | `db/reporting.test.ts` (content-edit rejection at lock; "reports cannot be created ... after content lock") | |
| AC-WR-007 | Content Lock: UNDEFINED to DONE allowed if not final locked. | Met | `db/reporting.test.ts` "execution: only UNDEFINED -> DONE/NOT_DONE, only after content lock..."; `e2e/03` "after content lock ... tasks can be executed" | |
| AC-WR-008 | At Final Lock, UNDEFINED becomes NOT_DONE. | Met | `db/scoring_integrity.test.ts` "UNDEFINED tasks become NOT_DONE at final lock with system history" | |
| AC-WR-009 | Final Lock: normal mutations rejected. | Met | `db/scoring_integrity.test.ts` "final-locked reports are immutable at the database layer, but can be reviewed" | |
| AC-WR-010 | Skipped session still final-locks and stays subject to compliance; organisation-holiday week suppresses report-required handling with no zero or NON_COMPLIANT. | Met | `db/attendance.test.ts` "creates no absence violation, does not waive weekly reporting..."; `db/reporting.test.ts` "a SKIPPED session requires a manually authored summary..." and "holiday: ... no zero/NON_COMPLIANT, excluded from quarter" | |

### Scoring

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-SC-001 | 4 Goals, 3 Done gives 75% base. | Met | `unit/scoring.test.ts` ("4 goals, 3 done" = 75.00); `db/scoring_integrity.test.ts` "scores equal-weight goals (4 goals, 3 done = 75.00)" | |
| AC-SC-002 | A Goal with 10 Tasks weighs the same as one with 1 Task. | Met, untested | `calc_base_score` and goal status derivation in `migrations/..0004_scoring_integrity_jobs.sql` count goals only | The title "equal-weight goals" suggests it; no test with unequal task counts was found. |
| AC-SC-003 | Stretch Goals count in numerator and denominator like other Goals. | Met, untested | `migrations/..0004` counts goals without a stretch exclusion; `db/reporting.test.ts` creates stretch goals | No scoring test asserting a stretch goal in the score was found. |
| AC-SC-004 | No submitted report gives 0% and NON_COMPLIANT. | Met | `db/scoring_integrity.test.ts` "non-submission => 0.00 + NON_COMPLIANT, with durable evidence even when no report row exists; idempotent re-run" | |
| AC-SC-005 | Submitted report with all Goals Not Done scores 0% but COMPLIANT. | Met, untested | Compliance rows in `migrations/..0004`; test above separates non-submission from submission | No test with a submitted all-Not-Done report was found. |
| AC-SC-006 | Base 80.00 with one 5% penalty gives 76.00. | Met | `unit/scoring.test.ts` "80 with one 5% = 76" | |
| AC-SC-007 | Penalty never goes below 0.00. | Met | `unit/scoring.test.ts` "combined >= 100% floors at 0"; `db/scoring_integrity.test.ts` "final score never goes below 0.00" | |
| AC-SC-008 | Two 5% penalties on 80.00 give 72.00 (summed, applied once). | Met | `unit/scoring.test.ts` "80 with two 5% = 72 (not compounded)"; `db/scoring_integrity.test.ts` "APPLY: ... = 72.00" | |
| AC-SC-009 | Base 3.00 with one 10% penalty gives 2.70. | Met | `unit/scoring.test.ts` "3 with one 10% = 2.70" | |
| AC-SC-010 | Combined rate of 100% or more gives 0.00. | Met | `unit/scoring.test.ts`; `db/scoring_integrity.test.ts` (floor test) | |
| AC-SC-011 | Final score rounded to two decimals in snapshots, dashboards, reports and exports; audit keeps base, rates, combined rate, rule version. | Partly | Snapshots: `numeric(5,2)` in `quarterly_score_snapshots`; `calc_final_score` rounds to 2 dp; `unit/scoring.test.ts` "rounds half up to 2dp" | ADR-055 (owner instruction) displays percentages to **one** decimal and exports keep the unrounded value, which differs from "two decimals ... in dashboards, reports and exports". Storage matches; display and export intentionally do not. The spec text should be amended or the owner should confirm. |
| AC-SC-012 | Fixed quarterly denominator (normal and skipped weeks; holidays excluded; missing report counts 0.00; no eligible weeks gives N/A). | Met | `unit/scoring.test.ts` "averages over a fixed denominator including missing zeros", "excludes organisation-holiday weeks", "returns N/A ..."; `db/scoring_integrity.test.ts` "missing weeks count as 0.00 in a fixed denominator", "a quarter with no eligible weeks reports N/A" | |
| AC-SC-013 | Missing report at final lock is 0.00 and NON_COMPLIANT; submitted 0.00 is distinguishable; submitted-but-unreviewed is not given the missing-report zero. | Met | `db/scoring_integrity.test.ts` (non-submission test); `migrations/..0004` counts unreviewed reports and keeps the quarter PROVISIONAL (`awaiting_review`); `db/scoring_integrity.test.ts` "snapshots are versioned and PROVISIONAL" | The "separately approved" quarter-finalisation rule is not in the acceptance document; implementation keeps the quarter PROVISIONAL until reviewed (see `docs/25`). |
| AC-SC-014 | Late report after quarter lock via controlled exception creates a new immutable quarterly version, keeps the original zero and prior snapshot, records details, does not reopen the quarter. | Met | `db/late_report.test.ts` "full flow after quarter lock: authorise, file, submit, review, apply creates new versions and keeps originals"; `e2e/04-score-amendments.spec.ts` | |
| AC-SC-015 | Quarterly snapshot stores denominator, week references and values, missing-zero count, numerator, score, rule version, timestamp and prior snapshot; same inputs give the same result. | Met | `quarterly_score_snapshots` columns (`denominator_count`, `week_contributions`, `missing_report_zero_count`, `numerator`, `rule_version`, `calculated_at`, `prior_snapshot_id`); `db/scoring_integrity.test.ts` (idempotent re-run, versioned snapshots); `db/reports.test.ts` "quarterly results are the latest snapshot version" | Snapshot is skipped when inputs are unchanged. |

### Integrity

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-INT-001 | Presenter can perform integrity correction. | Met | `integrity_correction.create` granted to PRESENTER in `migrations/..0001_foundation.sql`; `db/scoring_integrity.test.ts` uses the presenter for corrections | |
| AC-INT-002 | Admin can perform integrity correction. | Met, untested | Permission granted to ADMIN in `..0001_foundation.sql` | Tests use the presenter; an Admin call was not found. |
| AC-INT-003 | SuperAdmin can perform integrity correction. | Met, untested | Permission granted to SUPER_ADMIN in `..0001_foundation.sql` | As above. |
| AC-INT-004 | Every correction requires a reason. | Met | `db/scoring_integrity.test.ts` "requires reason ..." (INTEGRITY_REASON_REQUIRED) | |
| AC-INT-005 | DONE to NOT_DONE triggers a penalty decision. | Met | Same test (PENALTY_DECISION_REQUIRED); "APPLY: ..." | |
| AC-INT-006 | NOT_DONE to DONE triggers no penalty. | Met | `db/scoring_integrity.test.ts` "APPLY: ..." (upward correction "ic-up" with no decision) | |
| AC-INT-007 | Waived penalty requires a waiver reason. | Met | `db/scoring_integrity.test.ts` (WAIVER_REASON_REQUIRED); "WAIVE records reason and creates no penalty" | |
| AC-INT-008 | SuperAdmin cannot bypass the correction workflow. | Met | `db/scoring_integrity.test.ts` "direct task UPDATE bypassing the integrity workflow is blocked by the database"; `db/security.test.ts` "authenticated users have no table INSERT/UPDATE/DELETE grants" | No SuperAdmin-specific bypass test; the block is at database level for all roles. |

### Security

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-SEC-001 | Finance BU Lead cannot read the HR report by UUID. | Met | `db/security.test.ts` "SEC-RLS-001/002 ..."; `api/api.test.ts` "a BU Lead cannot read or touch another BU's report by UUID" | |
| AC-SEC-002 | Changing a BU filter does not bypass RLS. | Met | `db/security.test.ts` (same test); `db/last_week.test.ts` "cannot be widened by parameters"; `e2e/10-drilldown.spec.ts` | |
| AC-SEC-003 | Executive reads cross-BU data but cannot edit weekly reports. | Met | `db/security.test.ts` "SEC-RLS-004/005 ..."; `api/api.test.ts` "Executive reads organisation data but any write is denied" | |
| AC-SEC-004 | Audit records cannot be updated or deleted by the application or exposed DB role. | Met | `db/security.test.ts` "AC-SEC-004: audit rows cannot be updated or deleted by anyone, including a superuser session" | |

### Attendance amendments

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-ATT-001 | A finalised roster is read-only; direct UPDATE or DELETE is rejected. | Met | `db/attendance.test.ts` "HR toggles exceptions in DRAFT ...; finalisation ... freezes the roster"; `db/session_correction.test.ts` "leaves roster rows immutable for everything else" | |
| AC-ATT-002 | HR can request an amendment at any time after finalisation. | Met | `db/attendance.test.ts` "HR can request any time with a mandatory reason ..." | |
| AC-ATT-003 | A request needs a non-empty reason; evidence optional. | Met | Same test; `evidence_refs` is optional in `migrations/..0001_attendance.sql` | |
| AC-ATT-004 | Submitting does not change effective status. | Met | Same test ("effective status is unchanged until an independent approval") | |
| AC-ATT-005 | Only a different authorised approver can decide; self-approval impossible. | Met | `db/attendance.test.ts` "self-approval is impossible even when the requester holds both permissions" | |
| AC-ATT-006 | Rejection creates a durable decision record and informs the requester; mandatory reviewer comment not enforced. | Met | Same test (rejection audited and notifies); `ATTENDANCE_AMENDMENT_REJECTED` notification in `migrations/..0001_attendance.sql` | Reviewer comment remains an open owner decision; correctly not enforced. |
| AC-ATT-007 | Approval appends an amendment, changes effective status, preserves original and history. | Met | `db/attendance.test.ts` "HR can request any time ..." (source never changes) | |
| AC-ATT-008 | One pending request per record; stale snapshots cannot be approved. | Met | `db/attendance.test.ts` "a stale snapshot is not applied: ... STALE_REJECTED"; `conc/concurrency.test.ts` "simultaneous amendment requests for one record leave exactly one PENDING request" | |
| AC-ATT-009 | Every submission and decision is audited with actor, time, values, reason, decision, evidence reference; notification failure does not roll back. | Met | `db/attendance.test.ts` (request and decision tests); `notify_users` calls in `migrations/..0001_attendance.sql` | The "notification failure does not roll back" part has no dedicated test that I found. |
| AC-ATT-010 | No CANCELLED outcome; SKIPPED creates read-only VIRTUAL_PRESENT rows; correction only via audited exception; BUs still report. | Met | `db/attendance.test.ts` "atomically marks the session SKIPPED ..." and "skip-generated rows are not individually amendable"; `db/session_correction.test.ts` (whole file); `docs/25` item 1 (cancel not implemented) | ADR-054 still says session-outcome correction is "not built"; `migrations/20261019000007_session_outcome_correction.sql` and its tests show it is. That ADR note is out of date. |

### Finance

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-FIN-001 | HR can create a disbursement request. | Met | `disbursement.create` for HR in `..0001_foundation.sql`; `db/finance.test.ts` "HR requests, Finance decides ..." | |
| AC-FIN-002 | Finance can approve eligible requests. | Met | Same test; `api/finance-governance.api.test.ts` "runs the full flow ..." | |
| AC-FIN-003 | Finance cannot approve a request it created. | Met | `db/finance.test.ts` ("the requester can never approve, even holding both roles") | |
| AC-FIN-004 | Rejection requires justification. | Met | Same test ("rejection needs a reason") | |
| AC-FIN-005 | A request above the available balance cannot be approved. | Met | `db/finance.test.ts` "approved-but-unreleased requests are committed: a second approval that would overdraw the fund is refused" | |
| AC-FIN-006 | Two concurrent approvals cannot make the fund negative. | Met | `conc/concurrency.test.ts` "two simultaneous approvals that together exceed the fund: exactly one succeeds" | |
| AC-FIN-007 | Violation payment and ledger credit are atomic. | Met | `db/finance.test.ts` "payment, violation state and ledger CREDIT commit together" and "a payment failure leaves no payment..."; `conc/concurrency.test.ts` "concurrent payments for one violation" | |
| AC-FIN-008 | Disbursement and ledger debit are atomic. | Met | `db/finance.test.ts` "approval is not disbursement: only DISBURSE posts the ledger DEBIT, atomically"; `conc/concurrency.test.ts` "many simultaneous releases ... exactly one DEBIT" | The debit posts at release, not approval (`docs/25` item 2). |

### Strategy

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-STR-001 | Fewer than 3 KRs: quarter cannot be activated. | Met | `db/strategy.test.ts` "a quarter cannot be activated with <3 KRs, >4 KRs, or a KR without a Sub-KR" | |
| AC-STR-002 | More than 4 KRs: cannot be activated. | Met | Same test; `db/strategy_change.test.ts` "adds key results ... up to four" | |
| AC-STR-003 | A KR without a Sub-KR cannot be activated. | Met | Same test | |
| AC-STR-004 | At new-quarter start the previous quarter is read-only. | Met | `db/strategy.test.ts` "past quarter becomes read-only when the next quarter starts, even before the job runs" | |

### Attendance operational workflow (numbered list in the acceptance document)

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-OP-1 | New roster pre-populates every active staff member as PRESENT on the server. | Met | `db/attendance.test.ts` "snapshots every ACTIVE employee as PRESENT on the server, excludes inactive staff ..." | |
| AC-OP-2 | HR can change a status in a draft; per-status tally updates. | Met | `db/attendance.test.ts` "HR toggles exceptions in DRAFT ..." | Tally display is in `governance/sessions/[sessionId]/roster-workspace.tsx`; the data side is tested. |
| AC-OP-3 | Confirmed Skip OKR marks session SKIPPED and all staff VIRTUAL_PRESENT atomically. | Met | `db/attendance.test.ts` "atomically marks the session SKIPPED ..."; `api/finance-governance.api.test.ts` ("Skip needs permission, confirmation and a key") | |
| AC-OP-4 | UI states SKIPPED WEEK and VIRTUAL PRESENT; individual editing disabled. | Met, untested | Labels in `governance/page.tsx`, `dashboard/page.tsx`, `roster-workspace.tsx`; server rejects manual VIRTUAL_PRESENT (`db/attendance.test.ts`) | No e2e test of the skipped-week screen found. |
| AC-OP-5 | A failed skip commits nothing. | Met | `db/attendance.test.ts` "is all-or-nothing: a failure part-way leaves no SKIPPED session and no partial rows" | |
| AC-OP-6 | Same idempotency key creates no duplicate rows. | Met | `db/attendance.test.ts` (idempotent skip); `conc/concurrency.test.ts` "simultaneous Skip OKR requests never produce a mixed or duplicated roster" | |
| AC-OP-7 | A SKIPPED session generates no absence violation or penalty. | Met | `db/attendance.test.ts` "creates no absence violation ..." | |
| AC-OP-8 | A skipped week still needs every BU report, a manual summary, and normal review. | Met | `db/attendance.test.ts` (same test); `db/reporting.test.ts` "a SKIPPED session requires a manually authored summary before submit, and does not waive the report" | |
| AC-OP-9 | Unauthorised skip is denied and the security-relevant outcome is recorded. | Partly | Denial: `api/finance-governance.api.test.ts` (403 for BU Lead); `db/attendance.test.ts` (needs the permission) | I found no code that records a denied skip attempt as an audit or security event (`src/lib/api/handler.ts` returns PERMISSION_DENIED without writing one). Denial is met; recording is not found. |

### Organization Holiday (bulleted criteria)

| ID | Requirement | Status | Evidence | Note |
|---|---|---|---|---|
| AC-HOL-1 | Authorised users declare week(s) ORGANIZATION_HOLIDAY with reason, confirmation and an immutable audit event. | Met | `db/reporting.test.ts` "holiday: permission-gated, reason required, idempotent, audited ..."; `api/holiday-request.api.test.ts` | |
| AC-HOL-2 | Distinct from Skip OKR: no SKIPPED session, no VIRTUAL_PRESENT, no summary field. | Met | `db/attendance.test.ts` "is refused for an Organization Holiday week (different state, never conflated)" | |
| AC-HOL-3 | BU Leads are notified; reminders and overdue notices are suppressed. | Met | `db/reporting.test.ts` (notifies BU Leads); `db/reminders_email.test.ts` "are suppressed for holiday weeks, after the lock, when disabled ..." | |
| AC-HOL-4 | No missing-report zero or NON_COMPLIANT; week excluded from the quarter. | Met | `db/reporting.test.ts` (holiday test); `unit/scoring.test.ts`; `db/reports.test.ts`/`db/holiday_amendment.test.ts` "holiday weeks are not listed as non-compliant" | |
| AC-HOL-5 | Normal and skipped weeks stay reportable and counted. | Met | `db/scoring_integrity.test.ts` (fixed denominator); `db/reporting.test.ts` (skipped-week test) | |
| AC-HOL-6 | Post-lock holiday changes are controlled and audited; a new versioned quarterly snapshot is created; earlier snapshots stay immutable. | Met | `db/holiday_amendment.test.ts` (all four tests); `db/holiday_two_person.test.ts`; `e2e/04-score-amendments.spec.ts` | Two-person rule for closed weeks per ADR-058. |
| AC-HOL-7 | No eligible weeks: score is N/A with a reason, no division by zero. | Met | `unit/scoring.test.ts`; `db/scoring_integrity.test.ts` "a quarter with no eligible weeks reports N/A" | |
| AC-HOL-8 | After a skipped session, each BU report has a required manual summary; submission without it is blocked; review stays mandatory. | Met | `db/reporting.test.ts` "a SKIPPED session requires a manually authored summary before submit" | |

## 5. Explicitly superseded legacy behaviour

Source: `docs/00-SOURCE-OF-TRUTH.md` ("Superseded legacy rules") plus the no-CANCELLED rule. Because the legacy application is not available, this section confirms only that the new system does **not** contain the old behaviour. It does not describe how the old system behaved.

| Superseded legacy behaviour | How the new system treats it | Evidence |
|---|---|---|
| Older Manager / Member / Viewer role model | Eight fixed roles: SUPER_ADMIN, ADMIN, BU_LEAD, PRESENTER, EXECUTIVE, DIRECTOR, HR, FINANCE, with permission-based access. No Manager, Member or Viewer role exists. | `migrations/..0001_foundation.sql` (roles insert); `db/security.test.ts`; `api/api.test.ts` RBAC tests |
| Older Friday final-lock schedule | Content lock and final lock follow the specified Tuesday 18:00 WAT times, driven by the database clock. | `db/reporting.test.ts` (AC-WR-004/005 at 17:59:59 and 18:00:00); `db/admin_read.test.ts` "read_active_weeks follows the database clock" |
| Meeting-dependent reporting locks | Locks depend on time only, not on whether a session was held. A skipped session still final-locks. | `db/reporting.test.ts`; `db/attendance.test.ts` "does not waive weekly reporting" |
| Director/Manager weekly report approval workflow | Reports are submitted, final-locked and then reviewed by a Presenter; no approval gate blocks submission or lock. Note: a DIRECTOR role exists; its permissions were not audited here. | `db/scoring_integrity.test.ts` (review after final lock); `e2e/03-weekly-lifecycle.spec.ts` |
| Scoring directly from task counts | Score is by Goal count (equal weight per Goal), then penalties applied once. | `unit/scoring.test.ts`; `db/scoring_integrity.test.ts` (AC-SC-002 untested, see matrix) |
| Multi-currency financial behaviour | NGN only, enforced by a CHECK constraint; money is `numeric(19,2)`. | `migrations/..0001_foundation.sql` and `..0002_violations_finance.sql` (`currency_code = 'NGN'`) |
| Per-BU copies of organisation-wide Objectives/KRs/Sub-KRs | Strategy tables have no Business Unit column; goals in a BU's report link to the single organisation Sub-KR. | `migrations/..0002_strategy_calendar.sql`; `db/reporting.test.ts` "aligned needs a Sub-KR of the report's quarter" |
| A privileged administrator silently changing an integrity record | Direct table writes are denied to all users; corrections go through an audited workflow with reason; locked rows and the ledger reject updates; audit rows are immutable. | `db/scoring_integrity.test.ts` ("direct task UPDATE bypassing the integrity workflow is blocked by the database"); `db/security.test.ts`; `db/ledger_reversal.test.ts` |
| CANCELLED OKR session outcome (old API listed a `/cancel` route) | Not implemented. Only SCHEDULED, HELD and SKIPPED exist. | `docs/25-IMPLEMENTATION-NOTES.md` item 1; `db/attendance.test.ts` |

Also noted in `docs/00-SOURCE-OF-TRUTH.md`: payroll is outside 4CORE-OKR. No payroll code was found.

## 6. Gaps and risks

### Partly

| ID | What is missing | Recommended next step |
|---|---|---|
| AC-SC-011 | Spec says two decimals everywhere; ADR-055 shows one decimal and exports are unrounded. Storage is two decimals. | Owner to confirm ADR-055 supersedes AC-SC-011 for display and export, then edit `docs/20` and `docs/07` so the acceptance text matches. |
| AC-OP-9 | Denied skip attempts return 403 but no audit or security event for the denial was found. | Decide whether denials should be logged centrally (for example in `src/lib/api/handler.ts` for all PERMISSION_DENIED) and add a test; or amend the criterion. |

### Met, untested

| ID | Gap | Recommended next step |
|---|---|---|
| AC-SC-002 | No test with goals of unequal task counts. | Add a scoring test: one Goal with 10 Tasks and one with 1 Task, assert equal weight. |
| AC-SC-003 | No test that a stretch Goal affects numerator and denominator. | Add a scoring test with a stretch Goal. |
| AC-SC-005 | No test of a submitted report with all Goals Not Done. | Add a test asserting 0.00 and COMPLIANT. |
| AC-INT-002 | Only the Presenter is exercised. | Run the correction test for ADMIN. |
| AC-INT-003 | As above. | Run the correction test for SUPER_ADMIN. |
| AC-OP-4 | No e2e check of the "SKIPPED WEEK / VIRTUAL PRESENT" screen and disabled editing. | Add a Playwright test on the roster workspace after a skip. |

### Other risks not tied to a single criterion

- **No legacy comparison** (section 1). This is the main limit of the assessment.
- **Test results not verified in this pass.** Nothing was run; confirm the latest green run of `tests/db`, `tests/api`, `tests/concurrency` and `tests/e2e` before relying on the "Met" counts.
- **Stale decision record (resolved 2026-10-20).** ADR-054 items 3 and 9 have since been updated in `docs/24-DECISIONS.md`; the correction and parity statuses now read as built/done.
- **ATT-009 notification failure rollback** has no dedicated test.
- **Open owner decisions** in `docs/25-IMPLEMENTATION-NOTES.md` (for example the MFA role list, item 29; the attendance reviewer comment) remain unconfirmed and affect criteria wording.
- **Requirements outside the acceptance document** (functional requirements in `docs/03`, business rules in `docs/04`, UI spec in `docs/13`) were only skimmed and are not traced here. A fuller matrix would add rows for those.
- **ADR-054 items 1, 4 and 8** (executive dashboard rework, single calendar configuration object, hosting, scheduler and email provider) are recorded as not or partly done and sit outside the acceptance criteria.

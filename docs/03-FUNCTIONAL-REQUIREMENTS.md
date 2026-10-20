# 4CORE-OKR Functional Requirements

## Identity and access

### FR-ID-001
The system shall identify each staff member by a unique email address.

### FR-ID-002
Every staff member shall belong to one BU for current operational scope.

### FR-ID-003
Not every employee needs an application login. Attendance-only employees may exist without a user account.

### FR-ID-004
The system shall support SuperAdmin, Admin, BU Lead, Presenter, Executive, Director, HR, and Finance roles.

## Strategy

### FR-STR-001
The system shall maintain exactly one Annual Theme per organisation/year.

### FR-STR-002
SuperAdmin may perform an exceptional Annual Theme change only with a mandatory justification and audit history.

### FR-STR-003
Each quarter shall have exactly one Quarterly Objective.

### FR-STR-004
Each quarter shall contain 3–4 KRs.

### FR-STR-005
Each KR shall have at least one Sub-KR.

### FR-STR-006
Strategy is organisation-wide and not duplicated per BU.

### FR-STR-007
When a new quarter starts, the previous quarter's Objective, KRs, Sub-KRs and scores shall automatically become locked/read-only.

## Weekly report

### FR-WR-001
There shall be one weekly report per BU/reporting week.

### FR-WR-002
The report shall represent the BU commitment, not an individual's personal commitment.

### FR-WR-003
A BU with multiple BU Leads shall share one BU weekly report.

### FR-WR-004
Only one BU Lead may hold the active edit lease for a report at a time.

### FR-WR-005
Every BU must have at least one weekly Goal before submission.

### FR-WR-006
There is no fixed maximum number of Goals.

### FR-WR-007
The report shall have an explicit Submit Report action.

### FR-WR-008
Submission does not immediately lock content.

### FR-WR-009
Before Tuesday 18:00 WAT, a BU Lead may create/edit/delete Goals and Tasks and change mappings/classification.

### FR-WR-010
At Tuesday 18:00 WAT, Goal/Task content becomes immutable.

### FR-WR-011
After content lock, BU Lead execution changes are limited to UNDEFINED → DONE or UNDEFINED → NOT_DONE.

### FR-WR-012
At the following Tuesday 11:00 WAT, the report becomes FINAL_LOCKED.

### FR-WR-013
At final lock, remaining UNDEFINED tasks automatically become NOT_DONE.

### FR-WR-014
For NORMAL and SKIPPED-session weeks, the final lock must occur on the defined schedule. An officially declared ORGANIZATION_HOLIDAY suspends reporting obligations and must not trigger a missing-report zero or non-compliance finding.

### FR-WR-015 (Agreed — Organisation Holiday)
The system shall allow HR, Admin or Super Admin (or a user with the explicit holiday-management permission) to mark selected full reporting week(s) `ORGANIZATION_HOLIDAY`. The action requires a reason, confirmation and an append-only audit event.

### FR-WR-016 (Agreed — Holiday reporting treatment)
No BU report is required for an ORGANIZATION_HOLIDAY week. The system shall suppress weekly report reminders, overdue status and missing-report zero/non-compliance arising solely from non-submission during the holiday. It shall notify all BU Leads that the affected reporting week(s) are holidays.

### FR-WR-017 (Agreed — Skip notification and comment)
When a physical OKR session is skipped, the system shall notify all BU Leads and activate a required, manually authored performance-summary comment for each BU's weekly report. The comment supplements and never replaces explicit weekly report submission or normal review.


## Goals and SMART

### FR-GOAL-001
Every weekly Goal shall be treated as a SMART Goal.

### FR-GOAL-002
SMART evaluation shall score 0–100%.

### FR-GOAL-003
SMART weakness shall produce warnings/suggestions but shall not block submission.

### FR-GOAL-004
A KR-aligned Goal must reference exactly one Sub-KR.

### FR-GOAL-005
A Stretch Goal has no Sub-KR and is explicitly classified as Stretch.

### FR-GOAL-006
Every Goal must have at least one Task.

## Tasks

### FR-TASK-001
Task state values are limited to UNDEFINED, DONE, NOT_DONE.

### FR-TASK-002
A newly created Task starts as UNDEFINED.

### FR-TASK-003
Goal status is derived from Task states and is not freely editable.

## Scoring

### FR-SCORE-001
Every Goal has equal weekly score weight.

### FR-SCORE-002
Weekly base score = Done Goals / Total Goals × 100.

### FR-SCORE-003
Task count does not increase a Goal's score weight.

### FR-SCORE-004
Stretch Goals contribute to weekly score.

### FR-SCORE-005 (Agreed — Finding 3, Decision 1)
Quarterly execution score is the arithmetic mean of weekly BU contributions using **all non-holiday calendar reporting weeks in the quarter** as the denominator. NORMAL and SKIPPED-session weeks are included; ORGANIZATION_HOLIDAY weeks are excluded from numerator and denominator. A missing report in a reportable week contributes 0.00 unless an authorised exception applies.

### FR-SCORE-006 (Agreed — Finding 3, Decision 2)
A report not submitted by weekly final lock contributes 0.00 and `NON_COMPLIANT`, unless an authorised exception applies. This zero is included as zero in the quarterly numerator and the reportable week remains in the denominator; it does not apply to ORGANIZATION_HOLIDAY weeks. A submitted report with a score of 0.00 remains distinct from non-submission.

### FR-SCORE-007 (Agreed — authorised late-report exception)
An authorised exception may permit a late report to be submitted and reviewed, including after quarter lock. If accepted and reviewed, its calculated weekly score may replace the missing-report zero only through a controlled amendment. Do not overwrite the original zero snapshot or previously published quarterly score snapshot; preserve both and record a new versioned quarterly score with reason, approval, timestamps, affected week, old/new values and recalculation details. The historical quarter remains generally locked; an amendment does not reopen ordinary quarter editing.

If a quarter has no eligible non-holiday reporting weeks, the quarterly score shall be `N/A` with reason `NO_ELIGIBLE_REPORTING_WEEKS`; the system shall not divide by zero or fabricate a 0.00 score.

### FR-SCORE-008 (Resolved — ADR-081)
A submitted report that has not completed review is not a missing report; it keeps its computed weekly score and is shown as `AWAITING_REVIEW`. The quarter stays `PROVISIONAL` until the quarter is locked, every eligible week is finalised and every submitted report is reviewed. Review does not block the calendar-driven quarter lock, and at final lock any task still `UNDEFINED` becomes `NOT_DONE` before scoring.

## Integrity

### FR-INT-001
Only Presenter, Admin, and SuperAdmin may perform integrity corrections.

### FR-INT-002
Every integrity correction requires a mandatory reason.

### FR-INT-003
DONE → NOT_DONE triggers the penalty decision workflow.

### FR-INT-004
NOT_DONE → DONE does not trigger a penalty.

### FR-INT-005
Penalty is a percentage of the BU weekly base score.

### FR-INT-006
Penalty may be applied or waived; waiver requires a reason.

### FR-INT-007
SuperAdmin cannot bypass the integrity workflow.

## Attendance and amendments

### FR-ATT-001
HR/Admin shall create and manage Tuesday attendance sessions.

### FR-ATT-002
Attendance supports legitimate approved exceptions.

### FR-ATT-003
Attendance session status does not control weekly report locking.

### FR-ATT-004
A finalised source roster is immutable. HR may request an amendment at any time with a mandatory reason and optional evidence; a different authorised Admin/designated HR approver must decide, and self-approval is prohibited.

### FR-ATT-005
Approval appends an amendment and changes effective status without overwriting the original. A rejection decision must be recorded and the requester notified. A separate written approval document is not required; the approval/rejection action and actor identity are captured in the application audit trail. Whether a rejection comment is mandatory remains open unless separately approved. Requests and decisions are audited and the requester is notified.

### FR-ATT-006 (Agreed)
Resolved: each active staff member defaults to PRESENT when the weekly roster is generated. HR can change statuses before finalisation. A permitted user can invoke Skip OKR for this week, which atomically marks the session SKIPPED and all rostered staff VIRTUAL_PRESENT; see the attendance workflow below.

## Violations

### FR-VIO-001
HR/Admin may create violations against employees.

### FR-VIO-002
Violation records shall include BU, type, criticality, fine amount, and actor/audit metadata.

### FR-VIO-003
All financial values are NGN.

## Finance

### FR-FIN-001
Violation payments shall create controlled ledger inflows.

### FR-FIN-002
HR/Admin shall submit disbursement requests.

### FR-FIN-003
Finance shall approve or reject disbursement requests.

### FR-FIN-004
Finance rejection shall require justification.

### FR-FIN-005
A requester cannot approve their own request.

### FR-FIN-006
Approved/disbursed financial operations shall not exceed available funds.

### FR-FIN-007
Financial ledger history is immutable/append-only.

## Audit

### FR-AUD-001
Critical business operations shall create audit events.

### FR-AUD-002
Audit records cannot be edited or deleted through normal operations.


### Attendance workflow clarification (binding)
- At weekly roster creation, prepopulate every active staff member as `PRESENT`.
- After a held OKR session, users with `attendance.session.manage` can toggle a staff member to `ABSENT`, `ON_LEAVE`, `EXCUSED`, `ILL`, or another configured attendance status. Show per-status totals and finalisation confirmation.
- A permitted user can select `Skip OKR for this week`. After confirmation, one atomic operation marks the session `SKIPPED` and all staff in the session roster snapshot `VIRTUAL_PRESENT`. This is a bulk operation; do not require one toggle per staff member. Make the skipped-week status visible in lists, reports and exports.
- `VIRTUAL_PRESENT` means the physical OKR session was skipped and must not be interpreted as physical attendance. A skipped session creates no absence violation or attendance penalty. There is no `CANCELLED` OKR outcome. A skipped week remains a mandatory reporting week for every BU.
- Finalised held rosters remain immutable; corrections use the previously agreed independent amendment workflow. A skip action is audited and must not be silently reversed; any correction to an erroneous session outcome requires a separately authorised, audited operation.

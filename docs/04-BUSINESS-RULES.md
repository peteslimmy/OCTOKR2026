# 4CORE-OKR Business Rules Catalogue

## Organisation

### BR-ORG-001
4CORE-OKR currently supports one organisation.

### BR-ORG-002
Every employee belongs to one BU for current operational scope.

### BR-ORG-003
All financial amounts are NGN.

### BR-ORG-004
Business time is Africa/Lagos (WAT).

## Strategy

### BR-STR-001
Exactly one Annual Theme exists per organisation/year.

### BR-STR-002
Annual Theme changes are exceptional, SuperAdmin-only, reason-required, and auditable.

### BR-STR-003
Each quarter has exactly one Objective.

### BR-STR-004
Each quarter has 3–4 KRs.

### BR-STR-005
Every KR has ≥1 Sub-KR.

### BR-STR-006
All BU Goals can reference the same organisation-wide Sub-KRs.

### BR-STR-007
A quarter automatically locks when the next quarter begins.

## Weekly report

### BR-WR-001
One report per BU per reporting week.

### BR-WR-002
Report ownership is BU-level, not user-level.

### BR-WR-003
A BU needs at least one Goal to submit.

### BR-WR-004
There is no maximum Goal count.

### BR-WR-005
Submission is explicit through Submit Report.

### BR-WR-006
Submission does not immediately lock the report.

### BR-WR-007
Before Tuesday 18:00 WAT the BU Lead can change report content.

### BR-WR-008
At Tuesday 18:00 WAT content is locked.

### BR-WR-009
After content lock the BU Lead cannot create/edit/delete Goal/Task content.

### BR-WR-010
After content lock the BU Lead may only perform UNDEFINED → DONE or UNDEFINED → NOT_DONE.

### BR-WR-011
At following Tuesday 11:00 WAT report becomes immutable.

### BR-WR-012
Final lock is time-driven, not meeting-driven.


### BR-WR-013
Every BU must submit its weekly report in each NORMAL or SKIPPED-session reporting week. Skip does not waive reporting or review.

### BR-WR-014
When a session is SKIPPED, notify all BU Leads and activate a required manual performance-summary comment for each BU's report. The comment supplements and does not replace the submitted weekly report.

### BR-WR-015
An authorised user may mark a reporting week `ORGANIZATION_HOLIDAY`. No BU report is required for the affected week(s), and no missing-report zero, overdue-report status, or non-compliance penalty may be generated solely because the week is an organisation holiday.

### BR-WR-016
`ORGANIZATION_HOLIDAY` is a reporting-period state, separate from governance-session outcome `SKIPPED`. Never infer a skipped-session `VIRTUAL_PRESENT` roster from an organisation-holiday declaration.

### BR-WR-017
An `ORGANIZATION_HOLIDAY` week is excluded from the quarterly score numerator and denominator. NORMAL and SKIPPED-session weeks remain included. Missing reports from reportable weeks remain zero-valued unless an authorised exception applies.

### BR-WR-018
Holiday declarations and changes must be permission-checked and audited, including actor, timestamp, affected week(s), reason and prior/new state. A post-lock change affecting a score requires a controlled amendment and versioned score recalculation; historical snapshots are immutable.

## Goal rules

### BR-GOAL-001
Every Goal is a SMART Goal.

### BR-GOAL-002
SMART score is 0–100%.

### BR-GOAL-003
SMART warnings never block submission.

### BR-GOAL-004
KR-aligned Goals must have one Sub-KR.

### BR-GOAL-005
Stretch Goals have no Sub-KR.

### BR-GOAL-006
Every Goal requires at least one Task.

## Task rules

### BR-TASK-001
Task states are UNDEFINED, DONE, NOT_DONE only.

### BR-TASK-002
New Task = UNDEFINED.

### BR-TASK-003
Goal DONE iff all active Tasks are DONE.

### BR-TASK-004
At final lock all remaining UNDEFINED Tasks become NOT_DONE.

## Scoring rules

### BR-SCORE-001
All Goals have equal weight.

### BR-SCORE-002
Task count does not determine Goal weight.

### BR-SCORE-003
Weekly base score = Done Goals / Total Goals × 100.

### BR-SCORE-004
Stretch Goals count equally.

### BR-SCORE-005
At weekly final lock, no submitted report means a final weekly score of 0.00 and `NON_COMPLIANT`, unless an authorised exception applies. A submitted report with score 0.00 remains distinct from non-submission. A submitted report awaiting review is not a missing report and must not be assigned zero solely because review is pending; quarter-finalisation treatment for that state remains a decision-required item.

### BR-SCORE-006
Submitted 0% and non-submitted 0% are distinct business states.

### BR-SCORE-007
Quarterly execution score is the arithmetic mean of BU weekly contributions across **all non-holiday calendar reporting weeks in the quarter**. NORMAL and SKIPPED-session weeks are included; weeks declared `ORGANIZATION_HOLIDAY` are excluded from numerator and denominator because reports are not required. A missing report in any reportable week contributes 0.00 unless an authorised exception is applied; missing reports do not shrink the denominator. An authorised late-report exception may replace the original zero after submission and review, including after quarter lock, through a controlled score amendment and new versioned quarterly snapshot; the prior zero and published quarter snapshot remain immutable and the quarter is not generally reopened. If no eligible reporting weeks exist, the quarterly score is `N/A`.

## Integrity rules

### BR-INT-001
Presenter, Admin, SuperAdmin can perform integrity corrections.

### BR-INT-002
Integrity correction always requires task selection, reason, confirmation, penalty decision, audit.

### BR-INT-003
DONE → NOT_DONE creates penalty opportunity.

### BR-INT-004
NOT_DONE → DONE creates no penalty.

### BR-INT-005
Each applied integrity penalty is a percentage of the original weekly base score. Add all applicable applied penalty rates, then apply the combined rate once to the original base score. Do not subtract percentage points or compound sequentially.

### BR-INT-006
Final score cannot be below 0.00% and is rounded to two decimal places. Preserve the original base score, individual penalty rates, combined rate, formula/rule version and final score snapshot for audit.

### BR-INT-007
Penalty waiver requires reason.

## Attendance/violations

### BR-ATT-001
Attendance is independent of report locks.

### BR-ATT-002
Approved absence reasons must remain distinguishable from unexcused absence.

### BR-ATT-003
Saving a roster finalises it. A finalised source attendance record cannot be edited or deleted, and the database enforces this rather than the interface. If a genuine error is found, HR may submit an attendance amendment request at any time; no fixed correction window applies. Each request requires a non-empty reason; supporting evidence is optional. An authorised independent Admin or designated HR approver must approve/reject. The requester cannot approve their own request, regardless of other roles. Approval appends an amendment and changes effective attendance status without overwriting the original source record. The request, decision, original/effective/proposed statuses, identities, timestamps, evidence references and audit correlation remain retrievable. Requiring a separate reviewer reason for rejection is a proposed control pending approval. Only one pending request per attendance record is allowed (or equivalent serialised protection), and stale status snapshots cannot be approved. There is no CANCELLED OKR session state; when a physical session will not take place during a working/reportable week, the state is SKIPPED. A SKIPPED OKR week is a distinct outcome: an authorised user invokes “Skip OKR for this week”, and the system atomically marks the session SKIPPED and creates/sets every staff member in the session roster to VIRTUAL_PRESENT. No absence violation or attendance penalty is generated for a SKIPPED session. The generated VIRTUAL_PRESENT rows are system-controlled; the action is audited. A held session uses the normal HR marking flow. These rules are accepted in ADR-031.

### BR-ATT-004
An attendee whose status HR never records is PRESENT, matching the database column default. This is a separate unresolved policy decision: the business owner must confirm whether to retain this default or require explicit status selection before roster finalisation. The browser and database must not silently apply different defaults.

### BR-VIO-001
HR/Admin records violations.

### BR-VIO-002
Violation amount/criticality are management-controlled.

## Finance

### BR-FIN-001
Violation payments create ledger credits.

### BR-FIN-002
HR/Admin creates fund disbursement requests.

### BR-FIN-003
Finance approves or rejects.

### BR-FIN-004
Requester cannot approve own request.

### BR-FIN-005
Rejection requires justification.

### BR-FIN-006
Fund cannot become negative.

### BR-FIN-007
Approval and actual disbursement are separate states.

### BR-FIN-008
Financial transactions are atomic.

### BR-FIN-009
Ledger entries are append-only.


### Attendance operational workflow — business-owner clarification (binding)
- The weekly roster is created with every active staff member pre-populated as `PRESENT`. HR does not need to select PRESENT individually.
- After the OKR session, an authorised HR user (or another user explicitly granted `attendance.session.manage`) reviews the roster and toggles any status that differs from PRESENT. The initial controlled statuses are `PRESENT`, `ABSENT`, `ON_LEAVE`, `EXCUSED`, `ILL`, and `VIRTUAL_PRESENT`; the status catalogue may include additional approved statuses through controlled configuration.
- Before finalisation, the interface shows status counts and asks the user to confirm the roster. Finalisation makes the source roster immutable. Post-finalisation corrections follow the already agreed amendment workflow: HR initiates, an independent authorised Admin/designated HR approver decides, self-approval is prohibited, request reason is mandatory, evidence is optional, and no fixed deadline applies.
- If the OKR session will not take place, a permitted user selects `Skip OKR for this week` and confirms. The operation is atomic and idempotent: it marks the session `SKIPPED` and sets every staff member in the session's active-staff roster snapshot to `VIRTUAL_PRESENT`. The roster clearly identifies this as a skipped week, not physical attendance. The action records actor, timestamp, session/week, staff roster scope and outcome.
- A skipped week must not require HR to toggle every staff member individually. It must not create absence violations or attendance-based penalties. The generated virtual-present entries are read-only as a bulk result of the skipped-session decision; an incorrect skip must be escalated through an authorised, audited session-outcome correction rather than silently changing individual rows.
- There is no `CANCELLED` OKR outcome or cancellation workflow. The only exceptional weekly-session outcome is `SKIPPED`, meaning no physical session was held. The reporting week remains active for all BU reporting, submission, review, scoring and compliance processes.


## Weekly operating-state rules

### BR-GOV-ORGHOL-001
Only HR, Admin, Super Admin, or a user with the explicit holiday-management permission may declare `ORGANIZATION_HOLIDAY` for reporting week(s).

### BR-GOV-ORGHOL-002
A holiday declaration must identify the affected reporting week(s) and require confirmation; a reason and full audit event are required for each declaration or change.

### BR-GOV-ORGHOL-003
The holiday action informs BU Leads that no report is due and suppresses normal reporting reminders for the declared period. The Skip OKR action separately notifies every BU Lead that a report and manual summary comment remain required.

# 4CORE-OKR — Business Requirements Document (BRD)

**Revision note (2026-10-13):** Confirmed weekly operating states: NORMAL (weekly report required), SKIPPED physical OKR session (weekly report and manually authored summary comment still required; all BU Leads notified), and ORGANIZATION_HOLIDAY (no report due; report reminders/missing-report penalties suppressed; the affected week is excluded from quarterly scoring). Quarterly scoring includes all non-holiday reporting weeks; missing-report zero and authorised late-correction/versioning rules remain in force for reportable weeks. A submitted-but-unreviewed report remains a separate open decision.

**Version:** 1.0 | **Status:** Consolidated baseline for review | **Business timezone:** Africa/Lagos (WAT) | **Currency:** NGN (₦)

## 1. Purpose and authority
This BRD consolidates the business intent in the source package. It is a master business-level document and must be read with the existing detailed specifications retained in the package. It does not silently override accepted ADRs or the source-of-truth hierarchy. Where the package does not define a business policy, the item is marked **Decision Required** rather than invented.

### 1.1 Authority and classification
- **Baseline requirement:** explicitly supported by `00-SOURCE-OF-TRUTH.md`, `04-BUSINESS-RULES.md`, or the corresponding functional/decision document.
- **Proposed enhancement:** recommended for a stronger enterprise product, not approved until the business owner accepts it.
- **Assumption:** a planning premise used to structure the specification; validate before implementation.
- **Decision Required:** a business choice is missing, ambiguous, or needs explicit approval.

## 2. Business context and problem statement
4CORE-OKR is intended to replace fragmented spreadsheet-based weekly reporting with a consistent, auditable system linking organisation strategy to Business Unit (BU) execution. It must create a dependable record of commitments, task outcomes, strategic alignment, compliance with reporting deadlines, governance attendance, violations, and the handling of violation-fund money. Management needs comparable BU-level visibility without allowing operational users to manipulate historical results or see data outside their authorised scope.

## 3. Business objectives
| ID | Objective | Intended outcome / measure |
|---|---|---|
| BO-001 | Centralise weekly reporting | Every BU's weekly commitment and final outcome can be reviewed from one system. |
| BO-002 | Improve strategic traceability | Each normal goal maps to exactly one organisation-wide Sub-KR; Stretch Goals are explicit exceptions. |
| BO-003 | Make execution scoring consistent | Identical inputs produce deterministic scores; task volume does not distort goal weighting. |
| BO-004 | Enforce time-based accountability | Content lock and final lock occur at the specified WAT times regardless of meeting status. |
| BO-005 | Protect integrity of historical records | Corrections are reasoned, audited, and cannot bypass the integrity workflow. |
| BO-006 | Improve leadership visibility | Management can review BU ranking, trends, strategic coverage, non-compliance, and exceptions. |
| BO-007 | Digitise governance processes | Attendance, violations, quotes, violation payments, fund ledger, and disbursement decisions are recorded consistently. |
| BO-008 | Strengthen financial control | Ledger remains authoritative and append-only; no negative balance or self-approval. |
| BO-009 | Protect organisational data | Server-side authorization prevents cross-BU disclosure and unauthorised mutation. |

## 4. Stakeholders and business roles
- **SuperAdmin:** highest-level application governance; manages exceptional strategic changes and administration but cannot bypass integrity controls.
- **Admin:** operational configuration and authorised cross-BU administration.
- **BU Lead:** coordinates the shared weekly report for their assigned BU; report ownership is BU-level, not personal.
- **Presenter:** operates presentation mode and may execute the defined integrity correction workflow; is not a verifier.
- **Executive / Director:** management visibility and analysis; read-only unless a specific permission is separately approved.
- **HR:** attendance sessions, attendance records, violations, payment events and disbursement requests where permitted.
- **Finance:** reviews and approves/rejects disbursement requests, separate from requester duties.
- **Staff/attendee:** may be recorded for attendance without having an application login.
- **System scheduler:** applies deterministic time-based locks and finalisation operations.

A user's effective access is determined by **permission + resource scope + business state + role context**, not role label alone.

## 5. Scope
### 5.1 In scope
1. Organisation and BU directory; staff records and application identities.
2. Role and permission administration.
3. Annual Theme and quarterly Objective/KR/Sub-KR strategy.
4. Weekly BU report, SMART goal assessment, tasks, Sub-KR mapping and Stretch Goals.
5. Submit workflow, timed content lock, task execution, final lock and compliance state.
6. Weekly and quarterly scoring; strategic execution views.
7. Presenter mode and integrity correction/penalty workflow.
8. Weekly attendance with PRESENT-by-default rosters, exception marking, explicit Skip OKR handling, immutable saved records, and a separate organisation-holiday reporting state.
9. Violation records, violation payments, violation-fund ledger and disbursement requests.
10. Dashboards, reports, notifications, audit, security, observability, data migration and QA.

### 5.2 Out of scope unless separately approved
- Payroll processing and payroll calculation.
- Multi-currency accounting.
- Multiple organisations / multi-tenant commercial SaaS behaviour.
- Per-BU copies of organisation-wide Objectives, KRs or Sub-KRs.
- Replacing or silently redefining approved scoring and locking rules.
- Meeting-dependent finalisation.

## 6. Business processes and rules
### 6.1 Strategy planning
- One Annual Theme per organisation per year.
- One Quarterly Objective per quarter.
- Each quarter must contain 3–4 KRs; every KR must have at least one Sub-KR.
- Strategy is organisation-wide and reused by every BU, not copied into BU-specific strategy trees.
- On the start of a new quarter, prior-quarter strategy and score records become read-only.
- Annual Theme changes are exceptional, SuperAdmin-only, require justification, and preserve before/after values and audit history.

### 6.2 Weekly commitments and execution
- Exactly one report per BU per reporting week; multiple BU Leads share it, with a single active edit lease at a time.
- A BU must have at least one goal to submit; there is no fixed maximum.
- Every goal has at least one task and is evaluated by the SMART checker (0–100%). SMART warnings do not block submission.
- Every normal goal maps to exactly one Sub-KR. A Stretch Goal is the explicit exception and has no Sub-KR.
- Explicit submission does not immediately lock content.
- Monday opens the reporting week. Tuesday 18:00 WAT locks goal/task content. After that, a BU Lead may only change task status from UNDEFINED to DONE or NOT_DONE until final lock.
- Following Tuesday 11:00 WAT, the report final-locks on schedule regardless of whether the physical OKR session is held or skipped, or whether the week falls on a holiday. Remaining UNDEFINED tasks become NOT_DONE.

### 6.3 Scoring and compliance
- All goals have equal weight; task count never increases a goal's weight.
- Weekly base score = DONE goals / total goals × 100.
- Stretch Goals count equally in the weekly denominator and numerator.
- A report not submitted by weekly final lock yields 0.00 and `NON_COMPLIANT`, unless an authorised exception applies. A submitted report with 0.00 can still be COMPLIANT; these states must not be conflated.
- Quarterly execution is the arithmetic mean over **all non-holiday calendar reporting weeks in the quarter**. Normal and SKIPPED-session weeks count; `ORGANIZATION_HOLIDAY` weeks are excluded because no report is due. A missing report in a reportable week contributes 0.00 unless an authorised exception is approved; the denominator does not shrink for missing reports.
- An authorised late report may be accepted and reviewed after quarter lock; if approved, it replaces the missing-report zero only in a new versioned quarterly score snapshot. Preserve the original zero and published score, with reason/approval/audit evidence. Do not generally reopen the quarter.
- A submitted report awaiting review is not a missing report; its exact treatment at quarter finalisation remains an open decision. The quarterly metric measures execution of goals mapped to Sub-KRs, not proof that a business outcome KR was attained.
- Integrity penalties are percentages of the original weekly base score. Add all applicable penalty rates first, then apply the combined rate once. Example: an 80.00% base score with one 5% penalty produces 76.00%; with two 5% penalties it produces 72.00%. Final score is floored at 0.00% and rounded to two decimal places. The business owner confirmed this rule for Finding 1; see the decision register.

### 6.4 Integrity corrections
- Presenter, Admin and SuperAdmin may initiate corrections but none may bypass the workflow.
- Each correction records the selected task, current/proposed status, reason, confirmation, penalty decision, and audit history.
- DONE → NOT_DONE triggers a penalty decision; NOT_DONE → DONE carries no penalty.
- Penalty decision is APPLY or WAIVE. A waiver requires a reason. The correction actor is not a verifier. Preserve the base score, each applied rate, combined rate, formula result, final rounded score and rule/configuration version in the audit snapshot.

### 6.5 Attendance and violations
- Attendance is independent of weekly-report locks.
- Approved absence reasons must remain distinguishable from unexcused absence.
- Saving a roster finalises it. The original roster and attendance records remain immutable: no in-place edit or deletion is permitted after finalisation.
- HR may request an attendance amendment at any time; there is no fixed request deadline. Every request requires a reason and independent approval by an authorised Admin or designated HR approver. The requester cannot approve their own request.
- Supporting evidence is optional. The system must preserve the original value, proposed value, reason, requester, timestamps, decision, approver and effective outcome. Rejections and pending requests remain auditable. An approved amendment is appended and changes the effective attendance status without overwriting the original record.
- Every active staff member defaults to PRESENT when the weekly roster is created. HR or another authorised user marks exceptions after the OKR session. If the physical OKR session is skipped, a permitted user invokes Skip OKR for this week; all staff are automatically tagged VIRTUAL_PRESENT and the week/session is recorded as SKIPPED. Every BU must still submit its weekly report, manually enter a performance-summary comment in the report for the affected week, and have that report reviewed. The system notifies all BU Leads. There is no CANCELLED OKR outcome. Every BU remains accountable for weekly report submission and review even when the physical session is skipped; the performance summary must be manually entered by the BU. A separately declared ORGANIZATION_HOLIDAY suspends the report obligation for affected week(s) and excludes those weeks from quarterly scoring.
- HR/Admin records violations. Fine/criticality are management-controlled.
- Violation payments generate ledger credits atomically with payment state changes.

### 6.6 Violation fund
- HR/Admin creates a disbursement request with amount, purpose, justification and source fund.
- Finance approves or rejects; rejection requires a reason. Requester cannot approve their own request.
- Approval and actual disbursement are separate lifecycle states.
- Ledger is authoritative, append-only and denominated in NGN. Corrections use reversals/compensating entries.
- Balance = sum of credits minus sum of debits. No operation may drive balance below zero. Financial operations must be transactional and concurrency-safe.

## 7. Business information and reporting needs
Leadership requires: current-week BU status and ranking; weekly and quarterly execution trends; Sub-KR-linked goal execution; submission compliance; unsubmitted reports; SMART quality; integrity corrections and penalties; attendance and violations; fund inflows/outflows and balance; pending Finance decisions; and audit evidence for critical actions.

## 8. Business controls and non-functional expectations
- One canonical WAT clock governs deadlines; timestamps must be stored consistently and displayed in Africa/Lagos.
- Critical actions must have an attributable audit record with actor (or explicit system actor), timestamp, resource, action, reason where required, and relevant before/after data.
- Cross-BU data access is denied by default and must be enforced server-side and at the database layer where applicable.
- Financial transactions are atomic; historical ledger and audit records are append-only.
- Interface must be responsive, accessible, understandable and polished; failures explain what happened and the next safe action.
- System behaviour must be deterministic, testable and observable; no production-critical business rule may exist only in client code.

## 9. Business acceptance measures
1. Reporting states and lock times are applied consistently to all BUs.
2. Every finalised report has a reproducible score and compliance state.
3. No unexplained score change; all integrity corrections are traceable.
4. No cross-BU disclosure through UI, API, export or direct identifier manipulation.
5. No negative violation-fund balance and no self-approval.
6. No update/delete of audit and ledger history through ordinary application paths.
7. Management can drill from organisation-wide summaries to authorised source records.

## 10. Business decisions requiring approval
See `06-DECISION-AND-GAP-REGISTER.md`. The penalty arithmetic, fixed quarterly denominator, missing-report zero treatment, authorised post-lock correction path, and attendance amendment workflow are agreed. Remaining quarterly score questions include submitted-but-unreviewed reports and partial-quarter/BU lifecycle edge cases. The distinction between Finance approval and actual disbursement remains open.


### Attendance operational model (business-owner clarification)
The weekly roster defaults every active staff member to PRESENT. After the OKR session, HR or another user with the attendance-management permission toggles exceptions such as ABSENT, ON_LEAVE, EXCUSED or ILL. When the physical weekly OKR session will not hold, an authorised user selects `Skip OKR for this week`; the system marks the week/session SKIPPED and all staff VIRTUAL_PRESENT atomically. VIRTUAL_PRESENT communicates that no physical session was held, not physical attendance. Every BU must manually enter a performance summary for the affected week, submit its weekly report, and have it reviewed. There is no CANCELLED OKR outcome. The original finalised roster remains immutable; later corrections use the independently approved amendment workflow agreed for Finding 2.

# 4CORE-OKR Domain Model

## Organisation domain

### Organisation
Root entity for the single current organisation.

### BusinessUnit
Operational tenant/security boundary.

### Employee
Organisation staff identity. Unique business identifier = email.

### User
Application login identity. Optional relative to Employee.

## Strategy domain

### AnnualTheme
One per organisation/year.

### Quarter
One of Q1–Q4. Locks automatically on next-quarter start.

### QuarterlyObjective
Exactly one per quarter.

### KeyResult
3–4 per quarter.

### SubKeyResult
At least one per KR.

## Weekly execution domain

### ReportingWeek
Calendar/reporting period with authoritative lock timestamps and a separate `reporting_state` (`NORMAL` or `ORGANIZATION_HOLIDAY`). A holiday state suspends report submission obligations and excludes the week from quarterly scoring; the governance-session outcome is modelled separately.

### ReportingWeekStateEvent
Append-only declaration/change event for `ORGANIZATION_HOLIDAY`, recording actor, timestamp, reporting week(s), reason, prior/new state and correlation/audit reference.

### SkippedSessionSummaryComment
Required BU-authored summary comment attached to the BU's weekly report when governance-session outcome is `SKIPPED`; it does not replace the weekly report.

### WeeklyReport
One per BU/week. Represents BU commitment. For a SKIPPED physical-session week, it contains a required manually authored `skipped_session_summary_comment`; the report is still explicitly submitted and reviewed.

### SmartGoal
Belongs to WeeklyReport. Goal type = KR_ALIGNED or STRETCH.

### SmartEvaluation
SMART dimension scores/warnings/suggestions.

### Task
Belongs to SmartGoal. Status = UNDEFINED/DONE/NOT_DONE.

### TaskStatusHistory
Append-only record of execution changes.

## Scoring domain

### WeeklyScoreSnapshot
Immutable final result for a report.

### WeeklyCompliance
COMPLIANT or NON_COMPLIANT.

### QuarterlyExecutionScore
Versioned arithmetic-mean snapshot for one BU and quarter, calculated against all non-holiday calendar reporting weeks in the quarter (NORMAL and SKIPPED-session weeks only). Every reporting week has one contributing value: the final weekly score or 0.00 for a non-submitted report unless an authorised exception has replaced that zero through an audited amendment. Preserve prior versions. A submitted-but-unreviewed report is distinct from a missing report; its quarter-finalisation treatment remains a decision-required edge case.

### QuarterlyScoreAmendment
Append-only authorised correction for a missing-report zero. References the quarter/BU, reporting week, original zero snapshot, late report and completed review, approval identity/reason/timestamp, old and new weekly values, prior quarterly snapshot, recalculated quarterly snapshot/version, and correlation/audit references. It does not reopen the quarter or mutate historical snapshots.

### IntegrityCorrection
Governed correction event with penalty decision.

### IntegrityPenaltyConfiguration
Versioned penalty rates.

## Governance domain

### GovernanceSession
Tuesday attendance/presentation session.

### AttendanceRecord
Immutable source attendance state captured when a held roster is finalised, or generated as VIRTUAL_PRESENT by the atomic SKIPPED-session operation. Source value remains unchanged permanently. Each staff row belongs to a session roster snapshot.

### AttendanceAmendmentRequest
HR-initiated request to correct an eligible finalised held-session AttendanceRecord; includes source/effective status snapshot, proposed status, mandatory reason, optional evidence references, requester and timestamp. Can be submitted at any time; only one request may be pending for a record.

### AttendanceAmendmentDecision / AttendanceAmendment
Append-only approval/rejection event and, when approved, the amendment that determines effective attendance status. Records reviewer, timestamp, decision, reason as applicable and reference to the request. Requester and reviewer must be different users.

### WeeklyQuote
Quote + speaker + BU + week.

## Violation domain

### ViolationType
Configurable type/criticality/fine defaults.

### Violation
Staff violation record.

### ViolationPayment
Payment or payroll-deduction event recorded in 4CORE.

## Finance domain

### ViolationFund
Organisation's violation-fund container.

### FinancialLedgerEntry
Append-only credit/debit record.

### DisbursementRequest
HR/Admin request to use funds.

### DisbursementDecision
Finance approval/rejection.

### Disbursement
Actual money-release event.

## Cross-cutting

### AuditLog
Immutable event trail.

### Notification
Persistent in-app notification.

### Configuration
System/business configuration where appropriate.


### Attendance session skip operation
A domain operation that atomically changes a scheduled session to `SKIPPED` and creates/sets `VIRTUAL_PRESENT` records for every active staff member in the session's captured roster scope. It stores actor, timestamp, week/session, roster scope/count and operation reference. It is idempotent and cannot suppress, cancel or waive weekly BU reporting. Every BU report for a skipped week must include a manually authored performance summary and proceed through normal review. There is no CANCELLED OKR outcome. It is idempotent and cannot create duplicate rows on retry. There is no CANCELLED OKR session state.

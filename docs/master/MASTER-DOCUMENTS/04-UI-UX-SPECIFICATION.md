# 4CORE-OKR — UI/UX Specification

**Revision note (2026-10-13):** Confirmed weekly operating states: NORMAL (weekly report required), SKIPPED physical OKR session (weekly report and manually authored summary comment still required; all BU Leads notified), and ORGANIZATION_HOLIDAY (no report due; report reminders/missing-report penalties suppressed; the affected week is excluded from quarterly scoring). Quarterly scoring includes all non-holiday reporting weeks; missing-report zero and authorised late-correction/versioning rules remain in force for reportable weeks. A submitted-but-unreviewed report remains a separate open decision.

**Version:** 1.0 | **Experience goal:** premium, modern, management-grade, accessible and operationally clear

## 1. Design intent
Design a calm, high-signal enterprise application. Prioritise information hierarchy, tables, timelines, comparison charts and drill-down over a wall of generic counter cards. The interface should help each role answer: What needs attention? What is the current state? What can I do? Why is something locked? What evidence supports the score?

## 2. Experience principles
- **Role-specific workspace:** users see relevant actions without exposing unauthorised records.
- **Hierarchy before decoration:** Organisation → Annual Theme → Quarterly Objective → KR → Sub-KR → BU → weekly Goal → Task.
- **Status is explicit:** Draft/Submitted/Content Locked/Final Locked, compliant/non-compliant, approved/rejected/disbursed are visually distinct and text-labelled.
- **Deadline visibility:** show WAT time, date and countdown; do not rely on colour alone.
- **Progressive disclosure:** show essential data first; use drawers/dialogs for detail and confirmation.
- **Accessible by default:** keyboard operability, visible focus, semantic structure, meaningful labels, WCAG AA contrast and reduced motion.
- **Safe destructive actions:** explain permanence, affected records and recovery limits before confirmation.

## 3. Application shell and navigation
### 3.1 Global shell
- Left navigation with role-aware modules; collapsible on smaller screens.
- Top bar: current reporting week/quarter, selected BU where applicable, notifications, user/account menu.
- Main content uses exactly one `<main>` landmark and sequential heading levels.
- Breadcrumbs for deep strategy/finance drill-down.
- Consistent page title, concise context, primary action and optional secondary actions.
- Use skeleton rows/blocks while loading; meaningful empty state when no data exists; toast feedback after action.

### 3.2 Navigation map
- Home / Role Dashboard
- My BU / Weekly Reports
- Strategy: Annual Theme, Quarterly Objective, KRs, Sub-KRs
- Presentation Mode
- Integrity Corrections
- Attendance Sessions
- Violations & Payments
- Violation Fund / Disbursement Requests / Ledger
- Reports & Analytics
- Notifications
- Administration: Users & BUs, Roles & Permissions, configuration
- Audit & Security (authorised roles only)

Navigation may hide irrelevant items but cannot be the only access-control layer.

## 4. Screen specifications
### UX-01 Login and security
**Purpose:** secure entry and clear session state. Provide labelled email/password inputs as applicable, validation, loading state, accessible error messages and recovery route. MFA challenge must explain the required second factor and recovery path. Security settings include MFA enrollment/verification, session list/revocation and step-up confirmation for sensitive actions consistent with accepted ADRs. Never reveal whether a non-existent account exists through distinguishable public error messages.

### UX-02 Role dashboard
**Purpose:** give each role a prioritised operational view.
- **BU Lead:** current report state, deadlines/countdowns, goal/task completion, strategic coverage, recent weekly trend and clear resume/create action.
- **Executive/Director:** organisation execution trend, ranked BU table, Sub-KR hierarchy, non-compliant BUs, integrity exceptions and finance summary.
- **HR:** next/recent session, roster status, violation queue, payments and disbursement requests.
- **Finance:** available ledger balance, pending requests, request ageing, inflow/outflow trend, recent decisions and reconciliation status.
- **Admin/SuperAdmin:** operational health, reporting exceptions, strategy completeness, user/BU administration and audit/security events.
Use charts only where comparisons or trends add meaning. Every chart needs title, time range, units, accessible text/table equivalent and click-through context.

### UX-03 Strategy overview
Show annual theme at the top, then quarter selector and objective. Render KRs as ordered groups with Sub-KRs nested underneath. Show completeness/validation status and whether the quarter is active, locked or historical. Strategy editors show cardinality validation (3–4 KRs; at least one Sub-KR per KR). Historical quarters are read-only with clear explanation. Annual Theme exceptional change requires a reason and before/after confirmation.

### UX-04 Weekly report list
Table columns: reporting week, BU, submission state, review state, lifecycle state, base/final score, compliance, updated time, deadline status. Show `0.00` plus `NON_COMPLIANT` for a missing report at final lock unless an authorised exception applies; distinguish it from a submitted score of `0.00` and from a submitted report awaiting review. Show when a quarter score is provisional under the approved review rule. Default filter should surface current week and exceptions. Sort/filter controls must be keyboard accessible. Use server-side pagination for large histories. Do not infer compliant status from a numeric score.

### UX-05 Weekly report editor
Header: BU, reporting week, submission state, content-lock deadline/countdown and final-lock deadline/countdown. Show edit lease owner/status when another BU Lead holds the lease. Primary action: Submit Report; content editing remains possible until Tuesday 18:00 WAT after submission.
- Goal list supports add/edit/delete before content lock.
- Goal card: title, KR_ALIGNED/STRETCH badge, Sub-KR when applicable, SMART score, warnings, task count, derived status.
- Task list: task description and state. Before lock, task CRUD is available. After content lock, only UNDEFINED → DONE/NOT_DONE controls are available. Final lock removes all mutation controls.
- Empty state: “No weekly goals yet. Add at least one SMART Goal before submitting your report.”
- Locked banner: “Content Locked — goal and task definitions can no longer be changed.”
- Finalised banner: “Report Finalised — this historical record is immutable.”
- Submit validation lists all structural blockers together; SMART warnings are informational and never blockers.

### UX-06 Goal editor and SMART checker
A focused form with goal statement, classification, Sub-KR selection when KR_ALIGNED, and task entry. The SMART panel shows overall score and five dimensions (Specific, Measurable, Achievable, Relevant, Time-bound), warnings and specific improvement suggestions. Explain that the score is guidance, not an approval gate. Preserve user input on recoverable failure. If SMART persistence fails, show a clear error and do not claim save succeeded.

### UX-07 Presenter mode
Full-screen-friendly, high-contrast layout with week selector, BU selector, previous/next BU controls, objective/KR/Sub-KR path, goal cards, task states, score and compliance. Hide admin CRUD clutter. Keyboard navigation and safe exit are required. Integrity correction is a contextual action visible only to authorised actors.

### UX-08 Integrity correction dialog
Show task identifier/description, current state, proposed state, affected report/BU/week, reason field, confirmation step and calculated impact. DONE → NOT_DONE reveals penalty decision APPLY/WAIVE; WAIVE reveals mandatory waiver reason. Before confirmation, show the original weekly base score, each applicable penalty rate, combined rate, formula, zero-floor behaviour and final score rounded to two decimal places. Make clear that rates are added together and applied once to the original base score. On success, show audit reference and notification status if available. Do not permit an unreasoned or silent correction.

### UX-09 Attendance session, finalised roster and amendments
Session setup: week/date, session state, facilitator/notes if applicable. For a held session, roster has one row per active employee pre-populated as PRESENT; HR changes exceptions to ABSENT, ON_LEAVE, EXCUSED, ILL or another configured status. Display live counts by status. Before finalisation, show confirmation that source attendance values cannot be edited in place. After save, remove Save controls and display “Attendance saved — original roster is immutable.” For an authorised HR user, provide a separate “Request attendance correction” action on an eligible finalised attendance record; it must never reopen the roster editor.

The amendment form shows employee, session, original/effective attendance status, proposed status, mandatory reason, optional evidence attachment and a clear statement that the status will not change until approval. Submitting creates a pending request and displays its reference/status. The approver queue is available only to users with `attendance.amendment.approve`; show the requester, dates, original/effective and proposed status, reason, evidence, and any existing amendment history. Approve and Reject are distinct actions. The rejection dialog should capture a reviewer reason; making that reason mandatory is a proposed control pending separate approval. Hide/deny both actions for the requester even if they otherwise hold approver privileges. After a decision, show the current effective status and a chronological, read-only history while retaining the original roster value. Do not offer a CANCELLED OKR session state. SKIPPED sessions display read-only VIRTUAL_PRESENT rows and a skipped-week indicator.

### UX-10 Violations and payment
List/table includes employee, session, violation type, criticality, amount, status and payment state. Detail screen shows timeline and related ledger entry. Controlled dropdowns source violation type/criticality. Any authorised override of fine requires a reason. Payment action confirms amount and reference and guards against duplicate submission.

### UX-11 Violation fund and finance queue
Finance summary places available balance and reconciliation state above a transaction table. Request list includes requester, amount, purpose, age, state and action required. Request detail separates request, Finance decision and actual disbursement. Reject dialog requires justification. Approve/disburse actions show current available balance and warn if concurrent state changed. Requester identity is displayed to support segregation-of-duties review. Ledger detail is read-only; corrections are reversal transactions, not edit/delete.

### UX-12 Reports and analytics
Provide a hierarchy view for strategy execution and a comparison table for BUs. Filters: quarter, week range, BU, compliance, goal type and Sub-KR as authorised. Each metric has a definition tooltip or detail panel. Distinguish weekly base score, individual and combined penalty rates, final score (two decimal places), quarterly average and outcome attainment. Quarterly score detail must display the fixed calendar-week denominator, per-week contributing values, missing-report zero count, skipped-week indicator, calculation timestamp/version and whether the score is provisional or final under the approved review rule. For an authorised late-report amendment, show the previous and current quarterly score versions, the corrected week, original zero, replacement score, authorisation/reason and audit reference; do not suggest that the quarter was reopened. Export controls disclose data scope and format and enforce the same permissions as on-screen data.

### UX-13 Notifications
Inbox grouped by unread/recent, category and date. Each notification has a concise title, context, timestamp and deep link to an authorised screen. Delivery failure is not displayed as if the business action failed. Optional preferences are a proposed enhancement until approved.

### UX-14 User/BU/role administration
Searchable tables with status, BU, role and last activity where permitted. Forms validate email uniqueness and prevent privilege escalation by unauthorised admins. Role changes show the permissions being granted/removed and require confirmation. Deactivation should preserve history. Secret values are never rendered after save.

### UX-15 Audit and security events
Search by date, actor, action, resource and outcome. Display timestamp, actor/system identity, reason, correlation/reference ID and safe before/after values. Include quarterly score versions and post-lock score amendments, linking the original zero snapshot, late report/review, approval, old/new quarterly score and recalculation evidence. Read-only UI; no edit/delete controls. Sensitive fields should be redacted.

## 5. Design system requirements
- Use a consistent token system for spacing, typography, colour, radii, elevation and motion; do not scatter literal values throughout components.
- Typography must distinguish page title, section heading, body, metadata and numeric emphasis without excessive font-size variation.
- Use restrained brand accent, neutral surfaces, clear dividers and semantic status colours with text/icon labels.
- Tables: sticky header where helpful, row hover/focus, aligned numeric columns, responsive overflow strategy, empty/loading/error states and pagination.
- Forms: persistent labels, inline validation, clear required markers, logical tab order and save/cancel hierarchy.
- Dialogs: focus trap, accessible title/description, Escape behaviour where safe, and explicit confirmation for irreversible actions.
- Charts: include units, legends, time range, empty state and data table equivalent; never rely on colour alone.
- Motion: route entrance may use the existing 200ms fade/rise; no exit delay; honour `prefers-reduced-motion` globally.

## 6. Accessibility and responsive behaviour
- Target WCAG 2.2 AA; body and muted text meet 4.5:1 contrast, UI/focus indicators 3:1.
- Exactly one main landmark per page; heading levels sequential.
- All actions work with keyboard; focus is visible and not obscured.
- Controls have programmatic labels and status is announced appropriately.
- At narrow widths, tables may scroll or become structured rows; do not hide critical compliance/financial fields.
- Support zoom/reflow and touch targets suitable for mobile use.
- Automated axe checks run on login and critical authenticated routes; zero violations of any impact is the current acceptance baseline.

## 7. Interaction and state rules
- Skeletons for loading; empty states for valid zero-data; errors for failed operations; no endless spinners for table fetches.
- Toast API is consistent; errors remain visible longer than successes per existing design specification.
- Forms preserve entered data after transient errors when safe.
- Lock state must be reflected immediately in UI and enforced again by server.
- Stale write/lease expiry prompts reload or reacquisition instead of overwriting newer content.
- Disable duplicate submit/payment/disbursement actions while in flight, but backend idempotency is still required.

## 8. UI acceptance checklist
1. Every FRD module has an identifiable screen or interaction path.
2. Every role sees only permitted actions and resources.
3. Locked and finalised states are explicit and have no misleading controls.
4. Score and compliance semantics are clearly differentiated.
5. Destructive/irreversible actions have confirmation and reason fields where required.
6. Keyboard, contrast, focus, semantic landmarks, reduced motion and responsive reflow pass automated/manual checks.
7. Empty/loading/error states are defined for every data-heavy screen.
8. UI never claims a save/financial transaction succeeded before the server confirms it.


### UX-09A Skip OKR for this week
Show a dedicated action labelled `Skip OKR for this week` to users with `attendance.session.manage`. It must not look like a normal per-person status toggle. On click, show a confirmation dialog explaining that the physical session will be marked SKIPPED and every staff member will be tagged VIRTUAL_PRESENT. State clearly that every BU must still manually enter a performance summary, submit its weekly report, and complete normal review. Do not offer a Cancel Session action or CANCELLED status. After success, show a prominent `SKIPPED WEEK · VIRTUAL PRESENT` banner, the week, actor/time, and count affected. Lock the generated roster from per-person editing. Use text/tooltip in addition to colour: VIRTUAL_PRESENT means “OKR session skipped; not a physical-attendance assertion.” Distinguish this action from Cancel session.

For held sessions, make PRESENT the preselected state for every active staff member. HR should only change exceptions. Keep status controls accessible by keyboard and screen reader, show live status totals, flag unsaved changes, and require explicit finalisation confirmation.

### UX-09B Skipped-week BU performance summary
For every BU, the weekly report workspace must remain open and required for a skipped OKR week. Display a clearly labelled, mandatory manual-entry field such as “Performance summary for skipped OKR week”, with guidance to summarise the BU's actual performance/results during the week. Do not pre-populate the field with AI-generated prose or treat an automatically generated summary as user submission. The BU must submit the report through the normal Submit Report workflow, and the report must enter the normal review process. Show the skipped-session banner separately from report submission/review status so users cannot mistake VIRTUAL_PRESENT for a completed report.

### UX-12A Quarterly score detail and controlled amendment
Show the quarter and BU, all non-holiday calendar reporting weeks, fixed denominator, contributing weekly score per week, missing-report zeros, excluded ORGANIZATION_HOLIDAY weeks/count, quarter numerator/average, score version, calculation timestamp and audit reference. Identify `SKIPPED` physical-session weeks independently of reporting/compliance state. A submitted-but-unreviewed report must have a distinct status from non-submission; final/provisional display must follow the rule approved for that state. Where a user has the specific authorised score-amendment permission, provide a separate request/review path for a late report; collect the reason and approval, require normal report review, and preview the score impact. After success, show a new version and link to the preserved original zero and prior quarterly snapshot. Never expose ordinary edit controls for the locked quarter.


### UX-09B Organisation Holiday control
Show a separate permission-gated action labelled `Organization Holiday` beside the weekly calendar/OKR-session controls. It must not look like `Skip OKR for this week` and must not be presented as a cancellation. The user selects the affected reporting week(s), reviews the date range, enters a mandatory reason and confirms. The confirmation explicitly states that no BU weekly report is required for the selected weeks, ordinary report reminders and missing-report penalties are suppressed, and those weeks will be excluded from quarterly scoring. After success, display an `ORGANIZATION HOLIDAY · REPORT NOT REQUIRED` state, actor/time and period. Notify all BU Leads. Do not mark staff VIRTUAL_PRESENT just because the organisation holiday is declared.

For a SKIPPED physical session, notify all BU Leads and activate a required manual summary-comment field in each BU's report. The comment must be authored by the BU Lead, is associated with the reporting week/BU and must be present before report submission can succeed. It supplements and does not replace the weekly report. Show session state separately from report submission/review state.

# 4CORE-OKR Source of Truth

## Purpose

This document defines the authority hierarchy for all 4CORE-OKR implementation work. The project contains historical documents and an existing application that may contain obsolete rules. The coding agent must not assume that current behaviour is correct.

## Authority hierarchy

When two sources conflict, use this order:

1. `docs/00-SOURCE-OF-TRUTH.md`
2. `docs/04-BUSINESS-RULES.md`
3. `docs/03-FUNCTIONAL-REQUIREMENTS.md`
4. `docs/02-PRODUCT-REQUIREMENTS.md`
5. `docs/07-SCORING-ENGINE.md`
6. `docs/08-STATE-MACHINES.md`
7. `docs/09-DOMAIN-MODEL.md`
8. `docs/10-DATABASE-SPEC.md`
9. `docs/11-RLS-SECURITY.md`
10. `docs/12-API-CONTRACT.md`
11. `docs/13-UI-UX-SPEC.md`
12. Existing source code and legacy documents.

If a lower-ranked source conflicts with a higher-ranked source, the lower-ranked rule is **SUPERSEDED**.

## Current authoritative product model

### Organisation

- One organisation.
- Multiple Business Units.
- Each BU is an operational tenant/security boundary.
- All currency is Nigerian Naira (NGN/₦).
- Business timezone is Africa/Lagos / WAT.

### Strategy

- Exactly one Annual Theme per organisation per year.
- One Quarterly Objective per quarter.
- 3–4 KRs per quarter.
- Every KR has at least one Sub-KR.
- Objectives/KRs/Sub-KRs are organisation-wide, not copied per BU.
- Past quarter Objective/KR/Sub-KR/score automatically locks when a new quarter starts.

### Weekly execution

- One weekly report per BU per reporting week.
- The report represents the BU commitment.
- BU Lead is the person operating the report, not the owner of a personal commitment.
- Every BU must submit at least one goal.
- There is no fixed maximum number of goals.
- Every goal is a SMART goal.
- SMART checker scores 0–100%, provides warnings/suggestions, and never blocks submission solely for SMART weakness.
- Every normal goal maps to exactly one Sub-KR.
- A Stretch Goal is the explicit exception when no available Sub-KR applies.
- Every goal has one or more tasks.
- Tasks have only UNDEFINED, DONE, NOT_DONE states.
- Goal status is derived from tasks.

### Weekly lifecycle

- Monday: reporting week opens.
- BU Lead may create/edit/delete goal/task content before Tuesday 18:00 WAT.
- Tuesday 18:00 WAT: content lock.
- After content lock, BU Lead may only execute allowed task status changes: UNDEFINED → DONE or UNDEFINED → NOT_DONE.
- Following Tuesday 11:00 WAT: final lock.
- At final lock all remaining UNDEFINED tasks become NOT_DONE.
- Normal and SKIPPED-session reporting weeks use the defined reporting lock schedule. An officially declared `ORGANIZATION_HOLIDAY` reporting week has no report due and must not receive a missing-report zero or non-compliance finding; it is excluded from the quarterly denominator. Scheduler jobs must respect the reporting-week state.
- An explicit Submit Report action exists. Submission does not immediately lock content.

### Weekly operating states: normal, skipped session, and organisation holiday

- **NORMAL:** The physical OKR session follows the normal workflow and every BU must submit a weekly report.
- **SKIPPED physical session:** A permissioned HR/Admin/SuperAdmin user (or another identity granted the explicit permission) chooses `Skip OKR for this week`. Notify all BU Leads immediately. Activate a required manual summary-comment field for each BU Lead/report. Each BU must submit its regular weekly report, include the manually authored summary for the affected week, and complete normal review. The comment supplements and does not replace the report.
- **ORGANIZATION_HOLIDAY:** An authorised HR, Admin or Super Admin declares one or more affected reporting weeks as an organisation holiday because the organisation is closed and no work/reporting is expected. Reports are not required for those periods; suppress report-due reminders and missing-report/non-compliance/zero-score treatment. Notify all BU Leads of the holiday designation. Exclude the affected reporting weeks from quarterly score denominator and numerator. Do not infer VIRTUAL_PRESENT or create an attendance roster merely from the holiday designation; attendance-session state remains a distinct workflow.
- A reporting week has a reporting obligation state separate from the physical session outcome. `SKIPPED` is a governance-session outcome; `ORGANIZATION_HOLIDAY` is a reporting-period state. Neither may be represented as a generic cancellation.
- Record who declared/changed a holiday period, when, affected reporting week(s), reason and audit correlation. Do not silently overwrite prior declarations. Retroactive or post-lock changes require a controlled audited amendment and new quarterly score snapshot/version if the eligible denominator or a prior score changes.

### Scoring

- Every goal has equal weight.
- Task count does not give a goal extra weight.
- Weekly base score = DONE goals / total goals × 100.
- Stretch Goals contribute to weekly score and quarterly execution.
- At weekly final lock, a report that was not submitted scores 0.00 and is `NON_COMPLIANT`, unless an authorised exception applies. A submitted report scoring 0.00 remains distinct from non-submission.
- The quarterly denominator is all non-holiday calendar reporting weeks in the quarter. Normal weeks and SKIPPED physical-session weeks count; `ORGANIZATION_HOLIDAY` weeks are excluded. Missing-report weeks that remain reportable contribute 0.00 unless an authorised exception is approved. If no eligible reporting weeks exist in a quarter, report the quarterly score as `N/A` rather than dividing by zero.
- A skipped physical OKR session does not remove a reporting week or exempt a BU from manual performance-summary entry, submission, review, scoring or compliance.
- An authorised late-report exception can permit the report to be submitted and reviewed after the initial final lock or quarter lock. An accepted score correction replaces the zero in a new, versioned quarterly score snapshot; original zero and published score snapshots remain immutable. A locked quarter is not generally reopened.
- A submitted report awaiting review is not a missing report and must not be automatically assigned zero solely because review is pending. The rule for handling such reports at quarter finalisation remains pending a separate decision.
- Current scope measures goal execution against Sub-KRs; it does not claim that weekly goal completion equals KR business-outcome attainment.

### Integrity

- Presenter, Admin, and SuperAdmin can perform integrity corrections.
- Presenter is not a verifier.
- DONE → NOT_DONE triggers the integrity workflow and potential penalty.
- NOT_DONE → DONE carries no penalty.
- Every correction requires a reason.
- Penalty decision is APPLY or WAIVE.
- Waiver requires a reason.
- Penalty is a percentage of the BU weekly base score.
- Final score cannot fall below 0%.
- SuperAdmin cannot bypass the correction workflow.

### Governance

- HR/Admin manages attendance sessions and violations.
- Attendance is independent of reporting locks.
- Finalised attendance roster/records cannot be edited or deleted. HR can request an amendment at any time with a mandatory reason and optional evidence; an independent authorised Admin/designated HR approver decides, and self-approval is forbidden. Approved amendment history changes effective status without overwriting the original record. See ADR-031.
- Quote of the Week is recorded with the speaker and BU.

### Finance

- HR/Admin raises disbursement requests from violation funds.
- Finance BU approves/rejects.
- Finance rejection requires justification.
- Requester cannot approve their own request.
- Ledger is authoritative and append-only.
- Financial operations are atomic.
- Balance can never go negative.
- Payroll is outside 4CORE-OKR.

## Superseded legacy rules

The following legacy concepts must not be reintroduced unless an explicit new ADR changes the product:

- older role models that introduce operational Manager/Member/Viewer behaviour inconsistent with the current role model;
- older Friday final-lock schedules;
- meeting-dependent reporting locks;
- older Director/Manager weekly report approval workflows;
- older scoring models based directly on task counts;
- multi-currency financial behaviour;
- per-BU copies of organisation-wide Objectives/KRs/Sub-KRs;
- any workflow that lets a privileged administrator silently change an integrity record.

## Rule for ambiguity

If implementation requires a business decision that is genuinely absent from these specifications:

1. Do not invent a production rule silently.
2. Record the ambiguity.
3. Use the safest non-destructive implementation available.
4. Add an ADR only after the business decision is made.


## Business-owner clarification: weekly attendance
Every active staff member is pre-populated as PRESENT in the weekly roster. After the OKR session, HR or another permitted user toggles exceptions such as ABSENT, ON_LEAVE, EXCUSED or ILL. If the physical OKR session will not hold, a user with attendance-management permission can choose Skip OKR for this week; the system marks the week/session SKIPPED and every staff member VIRTUAL_PRESENT atomically. VIRTUAL_PRESENT means that no physical session was held, not physical attendance. Skipping does not waive reporting: every BU must manually enter a performance summary for the affected week, submit its weekly report, and have the report reviewed through the normal workflow. There is no CANCELLED OKR outcome. The existing immutable-roster and independently approved post-finalisation amendment rules remain in force.

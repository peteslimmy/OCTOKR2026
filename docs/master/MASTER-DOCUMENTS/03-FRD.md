# 4CORE-OKR — Functional Requirements Document (FRD)

**Revision note (2026-10-13):** Confirmed weekly operating states: NORMAL (weekly report required), SKIPPED physical OKR session (weekly report and manually authored summary comment still required; all BU Leads notified), and ORGANIZATION_HOLIDAY (no report due; report reminders/missing-report penalties suppressed; the affected week is excluded from quarterly scoring). Quarterly scoring includes all non-holiday reporting weeks; missing-report zero and authorised late-correction/versioning rules remain in force for reportable weeks. A submitted-but-unreviewed report remains a separate open decision.

**Version:** 1.0 | **Requirement style:** uniquely identified, testable, role/state aware

## 1. Reading this document
Each requirement is normative unless marked **Proposed** or **Decision Required**. Enforcement belongs on the server and database for security- or integrity-critical rules. A disabled button is not an authorization control. Use the existing detailed source files for implementation-specific contracts and accepted ADRs; this FRD consolidates them into a module-oriented functional catalogue.

## 2. Identity, users, BUs and authorization
- **FR-ID-001:** Every application user shall resolve to one unique staff identity and unique email.
- **FR-ID-002:** Each staff member belongs to one BU in current scope; membership is resolved server-side and cannot be supplied as an untrusted client override.
- **FR-ID-003:** Staff records may exist without login accounts for attendance use.
- **FR-ID-004:** Roles supported: SUPER_ADMIN, ADMIN, BU_LEAD, PRESENTER, EXECUTIVE, DIRECTOR, HR, FINANCE.
- **FR-ID-005:** Every protected action shall validate permission, resource scope, resource state and role context.
- **FR-ID-006:** BU Leads can operate only their assigned BU's report and related goal/task data.
- **FR-ID-007:** Executive/Director access is read-only unless an explicitly approved permission grants otherwise.
- **FR-ID-008:** Admin/SuperAdmin privileges do not bypass integrity correction, audit or ledger constraints.
- **FR-ID-009:** User/role/BU changes and account deactivation shall be audited.
- **FR-ID-010 (Proposed):** Maintain effective-dated membership and role history so historic results can be interpreted after transfers.

## 3. Strategy planning
- **FR-STR-001:** Enforce at most/exactly one Annual Theme per organisation/year according to annual planning state; duplicate active themes are rejected.
- **FR-STR-002:** Annual Theme exceptional change is SuperAdmin-only, requires non-empty justification, captures old/new values, actor, timestamp and audit event.
- **FR-STR-003:** Exactly one Quarterly Objective is allowed per quarter.
- **FR-STR-004:** Quarter cannot be activated/finalised unless it contains 3–4 KRs.
- **FR-STR-005:** Each KR must contain at least one Sub-KR before activation/finalisation.
- **FR-STR-006:** Objectives/KRs/Sub-KRs are organisation-wide entities referenced by BU goals; do not clone per BU.
- **FR-STR-007:** Starting a new quarter automatically makes prior quarter Objective/KRs/Sub-KRs/scores read-only.
- **FR-STR-008:** Historical strategy remains queryable and preserves relationships used by prior reports.
- **FR-STR-009:** Strategy CRUD must validate uniqueness, parent relationship, quarter/year and referential integrity.
- **FR-STR-010 (Decision Required):** Define whether activated strategy may be amended within a quarter, and if so, versioning and retroactive-mapping semantics.

## 4. Weekly reporting lifecycle
- **FR-WR-001:** A unique constraint shall enforce one report per BU per reporting week.
- **FR-WR-002:** Report is owned by the BU, not an individual; report history remains available if BU Lead changes.
- **FR-WR-003:** Report creation may be lazy on first access or explicit, but duplicate creation attempts must resolve to the same report.
- **FR-WR-004:** Multiple BU Leads share one report; only one may hold active edit lease at a time.
- **FR-WR-005:** Lease acquisition, renewal, expiry and takeover must be concurrency-safe and visibly communicated.
- **FR-WR-006:** Report must contain at least one valid goal to submit; there is no maximum goal count.
- **FR-WR-007:** Provide explicit Submit Report action and a confirmation/review state.
- **FR-WR-008:** Submission is a recorded business event and does not immediately lock content.
- **FR-WR-009:** Before Tuesday 18:00 WAT, authorised BU Lead can create/edit/delete goal/task content and change goal mapping/classification.
- **FR-WR-010:** At Tuesday 18:00 WAT, content becomes immutable regardless of submission state.
- **FR-WR-011:** After content lock and before final lock, BU Lead can only transition task status from UNDEFINED to DONE or NOT_DONE; no reversal or task/goal content edit.
- **FR-WR-012:** At the following Tuesday 11:00 WAT, report enters FINAL_LOCKED regardless of meeting state.
- **FR-WR-013:** Finalisation converts every remaining UNDEFINED task to NOT_DONE, recalculates goal status, scores, compliance, and score snapshot in one transaction or recoverable idempotent sequence.
- **FR-WR-014:** Final lock rejects all ordinary mutations, including direct API calls.
- **FR-WR-015 (Agreed):** A report not submitted by final lock produces score `0.00` and `NON_COMPLIANT`, unless an authorised exception applies; submitted report with score `0.00` remains a distinct state. Maintain stable audit evidence even where no weekly report row exists.
- **FR-WR-019 (Agreed):** A skipped physical OKR session does not waive reporting. Notify all BU Leads; activate a mandatory manual performance-summary comment for each BU report; every BU must submit its weekly report and complete normal review; the reviewed score counts normally in the quarter.
- **FR-WR-020 (Agreed):** A controlled authorised exception may allow a late report to be submitted and reviewed after weekly final lock or quarter lock. An accepted late score replaces the missing-report zero only in a new versioned quarterly score snapshot; preserve old snapshots and do not generally reopen the quarter.
- **FR-WR-021 (Agreed — Organisation Holiday):** HR, Admin or Super Admin (or a user with explicit holiday-management permission) can mark one or more affected reporting weeks `ORGANIZATION_HOLIDAY`. The action requires confirmation, mandatory reason and audit evidence. No weekly BU report is required for those weeks; suppress report reminders, missing-report zero and non-compliance arising solely from non-submission in the holiday period.
- **FR-WR-022 (Agreed — Quarterly holiday denominator):** Quarterly scoring includes all NORMAL and SKIPPED-session reporting weeks and excludes `ORGANIZATION_HOLIDAY` weeks from the numerator and denominator. A reportable week with no submission still contributes 0.00 unless an authorised exception applies.
- **FR-WR-023 (Agreed — Skip notification and summary):** The Skip OKR action notifies every BU Lead and activates a required manually authored performance-summary comment for each BU's weekly report. The comment does not replace explicit report submission or the normal review process.
- **FR-WR-024 (Proposed control):** Holiday state changes are append-only audited; a post-lock change that alters scoring eligibility must create a new quarterly score snapshot/version and preserve published history.
- **FR-WR-016:** Scheduler job is idempotent, retryable, observable and safe to run more than once.
- **FR-WR-017:** All deadline calculations use Africa/Lagos local rules; persist unambiguous timestamps and test exact-boundary behaviour.
- **FR-WR-018 (Proposed):** Display a report change/version history to BU Leads and administrators.

## 5. Goals, tasks and SMART evaluation
- **FR-GOAL-001:** Goal title/description and required metadata must be validated before save.
- **FR-GOAL-002:** Every goal must have at least one task before submission.
- **FR-GOAL-003:** Goal type is KR_ALIGNED or STRETCH.
- **FR-GOAL-004:** KR_ALIGNED goal references exactly one valid Sub-KR in the applicable quarter.
- **FR-GOAL-005:** STRETCH goal has no Sub-KR and is explicitly labelled as a strategic exception.
- **FR-GOAL-006:** A goal cannot be saved in a state that violates type/mapping constraints.
- **FR-GOAL-007:** Goal deletion before content lock follows the specified soft-delete/dependent-task policy and is audited; deleted items are excluded from scoring according to approved policy.
- **FR-TASK-001:** New tasks begin UNDEFINED.
- **FR-TASK-002:** Task states are only UNDEFINED, DONE, NOT_DONE.
- **FR-TASK-003:** Goal state is derived: DONE iff all active tasks are DONE; otherwise not done at finalisation. UI must not permit arbitrary manual goal-state editing.
- **FR-TASK-004:** Task status mutation is validated against actor permission and report lifecycle state.
- **FR-SMART-001:** Evaluate Specific, Measurable, Achievable, Relevant and Time-bound dimensions with dimension and overall scores from 0–100%.
- **FR-SMART-002:** Return warnings and actionable suggestions; SMART weakness never blocks submission by itself.
- **FR-SMART-003:** Persist evaluation tied to goal and evaluation version/timestamp; persistence failure must be surfaced and must not be silently reported as success.
- **FR-SMART-004:** Display the stored/current evaluation consistently; scores are numeric values, not incorrectly read as nested objects.
- **FR-SMART-005 (Proposed):** Store evaluation engine/version and input snapshot for reproducibility when the evaluation model changes.

## 6. Scoring and quarterly aggregation
- **FR-SC-001:** Weekly base score = DONE active goals / total active goals × 100.
- **FR-SC-002:** Each goal has equal weight; task count is not a weight.
- **FR-SC-003:** Stretch goals contribute equally to numerator/denominator.
- **FR-SC-004:** No report score is 0 with NON_COMPLIANT state; do not infer compliance from score alone.
- **FR-SC-005:** Store calculation inputs and final score snapshot at finalisation.
- **FR-SC-006:** Integrity penalties cannot reduce the final score below 0.00%.
- **FR-SC-007 (Agreed — Finding 3, Decision 1):** Quarterly score is the arithmetic mean of weekly BU values over all non-holiday calendar reporting weeks in the quarter. NORMAL and SKIPPED-session weeks are included; ORGANIZATION_HOLIDAY weeks are excluded. The denominator does not shrink when a report is missing from a reportable week.
- **FR-SC-008:** Dashboard shall distinguish execution proxy (goal completion) from actual KR outcome attainment.
- **FR-SC-009 (Agreed):** Calculate the final weekly score as `max(0, baseScore × (1 − totalAppliedPenaltyRate))`, where the total applied rate is the sum of all applicable applied penalty rates expressed as a decimal. Do not subtract percentage points and do not compound penalties sequentially.
- **FR-SC-010 (Agreed — Finding 3, Decision 2):** A report not submitted by final lock contributes `0.00` and `NON_COMPLIANT` to its weekly and quarterly evidence unless an authorised exception applies. The zero remains in the fixed denominator.
- **FR-SC-011:** Expose score explanation: done goals, total eligible goals, base score, each applied penalty, combined rate, calculation, rounding and final score. Display scores to two decimal places.
- **FR-SC-012 (Agreed):** A late report accepted and reviewed under an authorised exception may replace the missing-report zero in a new quarterly score version, including after quarter lock. Preserve the original zero and previously published quarterly score snapshot, authorisation/reason, review details, old/new values and recalculation inputs. Do not reopen ordinary quarter editing.
- **FR-SC-013 (Decision Required):** Define quarter finalisation when a report has been submitted but remains unreviewed. Do not classify pending review as non-submission or assign zero solely because review is pending.
- **FR-SC-014 (Decision Required):** Define partial-quarter and BU lifecycle edge cases (BU created, activated, suspended or closed mid-quarter; calendar weeks spanning quarter boundaries) without changing the agreed all-calendar-weeks denominator for normal full-quarter scoring.

## 7. Integrity corrections
- **FR-INT-001:** Only Presenter, Admin, SuperAdmin with `integrity_correction.create` may initiate a correction.
- **FR-INT-002:** Correction requires task, existing state, proposed state, reason and explicit confirmation.
- **FR-INT-003:** DONE → NOT_DONE creates a mandatory penalty decision step.
- **FR-INT-004:** NOT_DONE → DONE does not incur a penalty.
- **FR-INT-005:** Penalty decision is APPLY or WAIVE; waiver requires a non-empty reason.
- **FR-INT-006:** Record actor, timestamp, old/new state, reason, each penalty rate, combined applied rate, base score, calculation formula/version, decision, waiver reason, final score rounded to two decimal places and resulting score snapshot.
- **FR-INT-007:** SuperAdmin uses the same workflow; no direct state override or silent edit.
- **FR-INT-008:** Correction on finalised data follows an append-only correction record and recalculation/version strategy; preserve prior score snapshot.
- **FR-INT-009 (Agreed):** Add all applicable applied penalty rates, then apply the combined rate once to the original weekly base score. Do not sequentially compound penalties. Round the final score to two decimal places and apply a zero floor. Other adjustments are not defined in the baseline; any future adjustment must be separately approved and specified.

## 8. Presentation mode
- **FR-PRES-001:** Presenter can select reporting week and BU and navigate previous/next BU.
- **FR-PRES-002:** Show Objective/KR/Sub-KR, goals, tasks, statuses, score and compliance state.
- **FR-PRES-003:** Hide administrative CRUD controls not needed for presentation.
- **FR-PRES-004:** Expose integrity correction only to authorised users and through the complete correction flow.
- **FR-PRES-005 (Proposed):** Provide keyboard navigation and full-screen presentation with a safe exit.

## 9. Attendance and amendments
- **FR-ATT-001:** HR/Admin or another user with `attendance.session.manage` may create/manage weekly OKR sessions and attendance rosters.
- **FR-ATT-002 (Agreed):** On roster creation, the server snapshots all active staff eligible for the session and pre-populates each staff member with `PRESENT`. PRESENT is the default status; HR is not required to select it individually.
- **FR-ATT-003 (Agreed):** After a held OKR session, an authorised user can toggle a staff member from PRESENT to `ABSENT`, `ON_LEAVE`, `EXCUSED`, `ILL`, or another controlled/configured status before finalisation. The UI shows a live tally by status.
- **FR-ATT-004:** Before finalising a held-session roster, show status totals and require explicit confirmation that source attendance rows become immutable.
- **FR-ATT-005:** Finalised source attendance records cannot be updated/deleted through UI, API or database paths. Post-finalisation corrections use the agreed independent amendment workflow.
- **FR-ATT-006 (Agreed):** A permitted user can select `Skip OKR for this week`. After confirmation, one atomic, idempotent server operation sets the session outcome to `SKIPPED` and sets every staff member in the session roster snapshot to `VIRTUAL_PRESENT`. This is a bulk action, not a per-person edit.
- **FR-ATT-REPORT-001 (Agreed):** A skipped physical OKR session does not excuse or suppress the weekly report. Every BU must submit its report for that week, manually enter a performance summary describing the BU's performance during the affected week, and complete the normal report review workflow. The summary must be authored by the BU; automatic generation alone does not satisfy this requirement.
- **FR-ATT-007 (Agreed):** `VIRTUAL_PRESENT` explicitly means the physical OKR session was skipped; it must not be represented as physical attendance. Reports and exports show the SKIPPED session outcome. No absence violation or attendance penalty is generated for a SKIPPED session. All BUs remain subject to weekly report submission and review, and each report for a skipped week must contain a manually authored performance summary.
- **FR-ATT-008 (Agreed):** There is no `CANCELLED` OKR outcome or workflow. The only non-held session outcome is `SKIPPED`, which creates VIRTUAL_PRESENT rows for every staff member in scope while keeping weekly BU reporting, submission, review and scoring requirements active. Each BU must manually author a performance summary for the affected week; system-generated text alone cannot satisfy the requirement. Each BU must manually author a performance summary for the affected week; system-generated text alone cannot satisfy the requirement.
- **FR-ATT-009 (Agreed):** Skip action requires `attendance.session.manage`, server-side authorisation, explicit confirmation, idempotency, atomic persistence and an audit event recording actor/time/session/week/staff count/result. Partial completion is prohibited.
- **FR-ATT-010 (Agreed):** HR users with `attendance.amendment.request` may request correction to an eligible finalised held-session record at any time. Request reason is mandatory; supporting evidence is optional.
- **FR-ATT-011 (Agreed):** Only a different user with `attendance.amendment.approve` may approve/reject an amendment. An authorised Admin or designated HR approver may hold the permission. Self-approval is prohibited regardless of other roles.
- **FR-ATT-012:** Approval appends an amendment and changes effective status without updating/deleting the original source attendance row. Request, decision, old/new/effective status, reason, optional evidence references, identities and timestamps remain auditable.
- **FR-ATT-013:** There is no CANCELLED OKR outcome. Skip-generated VIRTUAL_PRESENT rows are not individually editable; an erroneous session outcome must use a separately authorised, audited exception workflow.
- **FR-ATT-014:** Rejection must be recorded and the requester notified. A separate signed/written approval document is not required; the in-app decision and audit event are the official record. A mandatory rejection comment is not approved and must not be enforced until separately decided.
- **FR-ATT-015:** Enforce at most one pending amendment per attendance record, or equivalent transaction-safe concurrency. Reject stale requests if the effective status changed after submission.

## 10. Violations and payments
- **FR-VIO-001:** HR/Admin can create violation against staff, session, violation type and criticality.
- **FR-VIO-002:** Fine/criticality are sourced from controlled configuration or explicit authorised override with reason.
- **FR-VIO-003:** Validate amount, employee, dates, status and duplicate references.
- **FR-VIO-004:** Payment/deduction event updates violation state and appends ledger CREDIT atomically.
- **FR-VIO-005:** Idempotency protection prevents duplicate payment posting on retry.
- **FR-VIO-006:** Preserve payment references and audit history; corrections use reversal entries.

## 11. Fund and disbursement
- **FR-FIN-001:** HR/Admin creates a request with amount, purpose, justification, requester and source fund.
- **FR-FIN-002:** Validate positive amount, currency NGN, required justification and fund source.
- **FR-FIN-003:** Finance can approve/reject only requests within assigned permission and workflow state.
- **FR-FIN-004:** Requester cannot approve own request, even with multiple roles.
- **FR-FIN-005:** Rejection requires justification.
- **FR-FIN-006:** Approval is distinct from disbursement; model SUBMITTED → UNDER_REVIEW → APPROVED → DISBURSED or REJECTED.
- **FR-FIN-007:** Before disbursement, check available balance transactionally; concurrent requests must not overdraw fund.
- **FR-FIN-008:** Disbursement and ledger DEBIT commit atomically; retry must not duplicate debit.
- **FR-FIN-009:** Ledger is append-only; corrections use compensating transactions.
- **FR-FIN-010:** Balance equals sum of credits less debits; provide reconciliation.
- **FR-FIN-011:** Store decision maker, decision timestamp, reason, disbursement reference and audit record.
- **FR-FIN-012 (Proposed):** Separate maker/checker roles and approval limits by amount, subject to business approval.

## 12. Dashboards, reports and exports
- **FR-DASH-001:** Executive dashboard includes BU ranking, quarter trend, Sub-KR execution, non-compliance, integrity exceptions and finance summary.
- **FR-DASH-002:** HR dashboard includes sessions, attendance, violations, quotes and fund context permitted to HR.
- **FR-DASH-003:** Finance dashboard includes current balance, inflows/outflows, pending decisions and approval history.
- **FR-DASH-004:** BU Lead dashboard prioritises own BU's active report, deadlines, tasks and prior performance.
- **FR-DASH-005:** Filters must be applied server-side where they affect data scope; client filters never grant access.
- **FR-DASH-006:** Drill-down links preserve the selected week/quarter/BU context and enforce permissions on destination.
- **FR-DASH-007:** Exports obey identical row/field authorization as the UI and are audited for sensitive datasets.
- **FR-DASH-008 (Proposed):** Saved views and scheduled report delivery, after privacy and recipient controls are approved.

## 13. Notifications
- **FR-NOT-001:** Generate notifications for report submission, lock reminders, non-submission, finalisation, integrity corrections, attendance/violation events and Finance decisions.
- **FR-NOT-002:** Notification delivery failure must not roll back an otherwise committed business transaction; retry must be observable.
- **FR-NOT-003:** Do not include sensitive information in email subject/body beyond recipient's authorised scope.
- **FR-NOT-004 (Proposed):** User preferences, digest options and delivery channel controls.

## 14. Audit and administration
- **FR-AUD-001:** Audit critical authentication, user/role changes, strategy changes, report submit/lock/finalise, integrity corrections, attendance finalisation, violations, payments, finance decisions, ledger entries and exports.
- **FR-AUD-002:** Audit records include actor/system identity, timestamp, action, resource, outcome, reason where required and safe before/after values.
- **FR-AUD-003:** Ordinary app/database roles cannot update/delete audit records.
- **FR-AUD-004:** Audit read access is restricted and monitored.
- **FR-ADM-001:** Admin screens must use validated, permission-scoped CRUD and display immutable status.
- **FR-ADM-002:** System configuration changes are versioned/audited; secrets are never stored or returned as ordinary configuration values.
- **FR-ADM-003 (Proposed):** Add a configuration catalogue distinguishing safe business settings from security-critical settings requiring deployment/approval.

## 15. Error handling and consistency
- **FR-ERR-001:** Every failed operation returns stable machine-readable error code and safe user-facing message.
- **FR-ERR-002:** Do not swallow failures for required data such as SMART evaluation persistence, audit-critical state changes, financial posting or finalisation.
- **FR-ERR-003:** Use transactions for multi-record financial operations and finalisation where possible; otherwise use idempotent workflow/outbox patterns.
- **FR-ERR-004:** Optimistic concurrency/version checks prevent stale edits from overwriting newer data.
- **FR-ERR-005 (Proposed):** Add correlation ID to API response/logs and expose support reference to users.

## 16. Functional acceptance baseline
Use `20-ACCEPTANCE-CRITERIA.md` plus tests for each requirement. Any implementation that passes the happy path but fails direct API, concurrency, boundary-time, retry, cross-BU, or immutable-history tests is not compliant.


## Organisation Holiday behaviour

The organisation-holiday declaration is a reporting calendar state, not a governance-session outcome. It must be visibly distinct from `Skip OKR for this week`; no `VIRTUAL_PRESENT` attendance rows are created merely by declaring a holiday. Notify BU Leads that no report is due, suppress ordinary report reminders, and exclude affected weeks from quarterly scoring. A quarter with no eligible reporting weeks displays `N/A` rather than dividing by zero.

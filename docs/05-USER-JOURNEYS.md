# 4CORE-OKR User Journeys

## UJ-01 — SuperAdmin Creates Annual Theme

**Actor:** SuperAdmin

1. Log in.
2. Open Strategy.
3. Open Annual Theme.
4. Select year.
5. Enter Theme.
6. Review.
7. Save.
8. System creates Theme and audit entry.
9. Theme becomes the year's strategic umbrella.

### Exceptional change
1. Open existing Theme.
2. Choose Change Theme.
3. Enter new Theme.
4. Enter mandatory justification.
5. Confirm.
6. System stores old/new values.
7. Audit entry is created.

## UJ-02 — Admin Creates Quarterly Objective

1. Open current planned quarter.
2. Create Objective.
3. Save.
4. Create 3–4 KRs.
5. Create at least one Sub-KR per KR.
6. Validate quarter.
7. Activate/finalise.

## UJ-03 — BU Lead Creates Weekly Report

1. Monday: open My BU.
2. Open current week.
3. Create report.
4. Confirm BU is automatically derived from identity.
5. Add first Goal.
6. Run SMART checker.
7. Map to Sub-KR or Stretch.
8. Add Tasks.
9. Repeat for additional Goals.
10. Review report.
11. Submit Report.
12. Continue editing until Tuesday 18:00 if required.

## UJ-04 — BU Lead Deletes Goal Before Content Lock

1. Open editable weekly report.
2. Select Goal.
3. Choose Delete.
4. Confirm.
5. System soft-deletes Goal and dependent Tasks according to deletion policy.
6. Audit event recorded.

## UJ-05 — BU Lead Attempts Edit After Content Lock

1. Open report after 18:00 WAT.
2. Goal is read-only.
3. Attempt API mutation directly.
4. Backend rejects operation.
5. UI explains Content Locked.

## UJ-06 — BU Lead Executes Tasks

1. Open current report.
2. Review Task.
3. Set UNDEFINED → DONE or UNDEFINED → NOT_DONE.
4. System derives Goal status.
5. Score preview updates if permitted.

## UJ-07 — Final Lock

1. Scheduler identifies report due for finalisation.
2. System locks report transactionally.
3. Undefined tasks become Not Done.
4. Goal states recalculate.
5. Score snapshot created.
6. Compliance determined.
7. Audit created.
8. Notifications generated.

## UJ-08 — Non-submission

1. BU fails to submit.
2. Finalisation window is reached.
3. System records NOT_SUBMITTED.
4. Score = 0%.
5. Compliance = NON_COMPLIANT.
6. Management dashboard shows exception.

## UJ-09 — Presenter Presentation

1. Presenter opens Presentation Mode.
2. Selects week.
3. Selects BU.
4. Views Objective/KR/Sub-KR mapping.
5. Presents Goals and Tasks.
6. Moves to next BU.

## UJ-10 — Presenter Integrity Correction

1. Presenter identifies DONE task that should be NOT_DONE.
2. Select task.
3. Start Integrity Correction.
4. Enter mandatory reason.
5. Confirm.
6. Task becomes NOT_DONE.
7. System calculates penalty.
8. Presenter applies or waives.
9. Waiver reason required when waived.
10. Audit and notification generated.

## UJ-11 — HR Attendance and correction

1. HR opens Attendance and creates the Tuesday session.
2. Records the attendance state for each staff member and any legitimate exception.
3. Reviews the roster tally and confirms finalisation.
4. The system finalises the source roster, makes source records read-only, and writes an audit event.
5. If an error is discovered after finalisation, HR opens the affected attendance record and selects **Request correction** (not Edit roster).
6. HR selects the proposed status and enters a mandatory reason; supporting evidence may be attached. The system creates a pending request and does not change effective attendance yet.
7. An authorised Admin or designated HR approver other than the requester reviews the original/effective status, proposed status, reason and evidence. The requester cannot approve their own request.
8. The approver approves or rejects the request. The application records the decision and actor; no separate signed/written approval document is required. A mandatory rejection comment remains an open policy choice.
9. On approval, the system appends the amendment/decision and updates effective status while preserving original values. On rejection, effective status remains unchanged.
10. The system audits the full request and decision, notifies the requester of the outcome, and displays a read-only history.

## UJ-12 — HR Violation

1. Open Governance/Violations.
2. Select employee.
3. Select session and violation type.
4. Set criticality.
5. Confirm fine.
6. Save.
7. Audit created.

## UJ-13 — HR Records Payment

1. Open violation.
2. Record payment or salary-deduction event.
3. System atomically records payment, violation state and ledger credit.
4. Audit created.

## UJ-14 — HR Raises Disbursement Request

1. Open Violation Fund.
2. Create request.
3. Enter amount, purpose, justification.
4. Submit.
5. Finance receives notification.

## UJ-15 — Finance Approves

1. Open approval queue.
2. Review request.
3. Verify balance.
4. Confirm requester is not self.
5. Approve.
6. System records approval/disbursement/ledger debit atomically.
7. Audit and notifications generated.

## UJ-16 — Finance Rejects

1. Open request.
2. Select Reject.
3. Enter mandatory justification.
4. Confirm.
5. Status = REJECTED.
6. Requester notified.
7. Audit created.

## UJ-17 — Executive Review

1. Executive opens dashboard.
2. Sees Objective/KRs.
3. Sees BU rankings.
4. Drills into Sub-KR execution.
5. Views exceptions.
6. Cannot edit.

## UJ-18 — Quarter Rollover

1. New quarter begins.
2. System locks previous quarter.
3. Historical data remains viewable.
4. New quarter becomes active.
5. Header reflects current quarter.


### Weekly attendance — held session
1. An authorised HR user opens the attendance workspace for the week.
2. The system displays all active staff in the roster, each pre-populated as `PRESENT`.
3. After the OKR session, HR toggles only exceptions to `ABSENT`, `ON_LEAVE`, `EXCUSED`, `ILL`, or another configured status.
4. The screen updates status counts and highlights any non-default statuses.
5. HR reviews the roster and confirms finalisation. The source roster becomes immutable. Later corrections use the independent amendment workflow.

### Weekly attendance — OKR skipped
1. An authorised user opens the week and selects `Skip OKR for this week`.
2. The system explains that the session will be marked `SKIPPED` and all staff will be tagged `VIRTUAL_PRESENT`.
3. After confirmation, the server commits the session outcome and all virtual-present rows atomically.
4. The UI displays a clear `SKIPPED WEEK · VIRTUAL PRESENT` indicator and read-only roster. No absence violation is generated. The skip action also prompts each BU to complete and submit its weekly report, including a manually authored performance summary for the affected week; submitted reports continue through the normal review process. There is no separate cancelled-session path.


## Organization Holiday workflow

1. An authorised HR/Admin/SuperAdmin opens the reporting calendar and selects the full reporting week(s) affected by the organisation-wide closure.
2. The user selects `Organization Holiday`, enters a mandatory reason, reviews the affected dates, and confirms.
3. The system sets the reporting state to `ORGANIZATION_HOLIDAY`, appends an audit event and notifies all BU Leads that no weekly report is due for the specified week(s).
4. The system suppresses report-due/overdue notices and missing-report penalties/zeroes for the affected weeks. Quarterly scoring excludes the holiday weeks.
5. If a holiday declaration must be corrected after reporting/quarter lock, an authorised controlled amendment preserves prior state and score snapshots and produces a new score version where required.

## Skip OKR workflow

1. An authorised user selects `Skip OKR for this week` because the physical session will not take place, but the organisation is otherwise operating.
2. The system marks the governance session `SKIPPED`, creates read-only `VIRTUAL_PRESENT` rows for all in-scope staff, and notifies every BU Lead.
3. Each BU Lead sees the required manual performance-summary comment field activated in the BU's weekly report, enters the summary, and submits the normal weekly report for review.
4. The week remains reportable and included in quarterly denominator. Missing submission follows the approved zero/non-compliance rule.

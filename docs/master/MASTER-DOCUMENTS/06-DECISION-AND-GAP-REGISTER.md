# 06 — Decision, Gap and Traceability Register

**Revision note (2026-10-13):** Updated for 4CORE-OKR Finding 3 Decisions 1–2: quarterly scoring uses all non-holiday calendar reporting weeks in the quarter, excludes `ORGANIZATION_HOLIDAY` weeks, and includes NORMAL and SKIPPED-session weeks; a missing report in a reportable week scores 0.00 and is `NON_COMPLIANT` unless an authorised exception applies; an approved late report may replace the zero through a controlled, audited, versioned score amendment, including after quarter lock, without generally reopening the quarter. A submitted-but-unreviewed report is distinct from a missing report; its quarter-end treatment remains an open decision. The Finding 2 attendance and skipped-week reporting rules remain in force; the Organization Holiday state and revised denominator are now recorded as DEC-021 / ADR-033.

**Purpose:** track unresolved decisions, resolved business decisions, proposed enhancements, implementation risks and requirement traceability. Resolved decisions are binding across the master documents and retained technical specifications.

## A. Decisions requiring business-owner approval

### Resolved decisions

| ID | Topic | Agreed decision | Status |
|---|---|---|---|
| DEC-001 | Integrity penalty formula | Apply the sum of all applicable penalty rates once to the original weekly base score: `finalScore = max(0, baseScore × (1 − sum(appliedRates)))`. Penalties are not percentage-point deductions and are not sequentially compounded. Final score is rounded to two decimal places. Preserve inputs and rule version for audit. | **Resolved — Business owner confirmed 2026-10-12** |
| DEC-002 | Attendance amendment workflow | Finalised source roster remains immutable. HR can submit an amendment at any time with a mandatory request reason and optional evidence; a different authorised Admin/designated HR approver must decide; self-approval is prohibited. Approval appends an amendment that changes effective status without overwriting the original. All outcomes are audited. No separate signed/written approval document is required; the in-app decision is the official record. | **Resolved — Business owner confirmed 2026-10-12** |
| DEC-017 | Weekly attendance defaults and skipped OKR | New weekly roster defaults all active staff to PRESENT; HR toggles exceptions after the physical session. A permitted user can invoke Skip OKR for this week; the week/session becomes SKIPPED and every staff member in scope is tagged VIRTUAL_PRESENT atomically. Skipping does not waive reporting: every BU must submit a weekly report with a manually authored performance summary and the report must be reviewed. There is no CANCELLED OKR outcome. CANCELLED creates no attendance rows. VIRTUAL_PRESENT is a skipped-week marker and creates no absence violation. | **Resolved — Business owner clarified 2026-10-12** |
| DEC-019 | Quarterly aggregation, missing-report zero and late corrections | Use all non-holiday calendar reporting weeks in the quarter as the denominator; exclude officially declared Organization Holiday weeks. A missing report in a reportable week contributes 0.00 + NON_COMPLIANT unless an authorised exception applies. An authorised late report accepted and reviewed may replace the zero only in a new versioned quarter-score snapshot, including after quarter lock; preserve original zero and published snapshots. | **Resolved — Business owner confirmed 2026-10-13** |
| DEC-021 | Organization Holiday operating state and score denominator | HR/Admin/SuperAdmin can declare one or more reporting weeks `ORGANIZATION_HOLIDAY`; no BU report is due; suppress reminders and missing-report penalties; notify BU Leads; exclude these weeks from quarterly scoring. Skip remains distinct: report and manually authored summary comment are still required. | **Resolved — Business owner confirmed 2026-10-13** |
| DEC-010 | Penalty stacking | Add applicable applied rates before calculation; apply the combined rate once to the original base score. Enforce a 0.00% floor and two-decimal final score precision. | **Resolved — Business owner confirmed 2026-10-12** |

### Open decisions and residual implementation gaps

| ID | Priority | Topic | Evidence / conflict | Recommended resolution | Owner / status |
|---|---|---|---|---|---|
| DEC-001 | P0 | Penalty arithmetic | Resolved: penalty is a percentage of the original weekly base score; add applicable rates before applying once. Final score is floored at 0.00% and rounded to two decimal places. Example: 80.00% with a 5% penalty = 76.00%. | Implement the approved formula and verify worked examples in automated tests. | Business owner — **Resolved 2026-10-12** |
| DEC-003 | P0 | Unrecorded attendance | Resolved: each active staff member is pre-populated as PRESENT when the weekly roster is created; HR toggles exceptions after the session. | Implement server-side default and tests; PRESENT is the operational default, while the session/roster audit must preserve who finalised it. | Business owner — **Resolved 2026-10-12** |
| DEC-004 | P0 | Quarterly BU lifecycle and calendar edge cases | Core denominator is resolved: all non-holiday calendar reporting weeks in the quarter. Remaining cases: BU activated/created or closed mid-quarter, reporting weeks that straddle quarter boundaries, and quarter finalisation where a report is submitted but not reviewed. | Keep the fixed denominator for normal full-quarter scoring. Obtain explicit rules for lifecycle/partial-quarter cases and pending-review state before implementation of those edges; do not silently exclude weeks. | Business owner — **Partially resolved; residual questions open** |
| DEC-005 | P1 | Durable evidence for a missing-report zero | Business rule is resolved: a report not submitted by final lock contributes 0.00 + NON_COMPLIANT unless an authorised exception applies. A missing report may not have a `weekly_reports` row, so the score/compliance state must remain stable and auditable. | Choose an explicit missing-week snapshot or equivalent immutable score/compliance evidence at final lock. A transient unlogged query-time zero is not sufficient. | Product/Engineering — Open implementation detail |
| DEC-020 | P0 | Submitted report awaiting review at quarter finalisation | A submitted-but-unreviewed report is not a missing report; the business owner has not decided whether quarter remains provisional and how/when final scoring occurs. | Recommend keeping quarter score provisional until review is complete; do not assign zero solely for pending review and do not publish as final until the rule is approved. | Business owner — Open |
| DEC-022 | P2 | Partial-week or retrospective Organization Holiday declaration | The agreed denominator excludes identified Organization Holiday reporting weeks. The rule currently assumes whole reporting weeks; treatment for a holiday that covers only part of a reporting week or is declared retroactively needs explicit handling if required. | Keep v1 limited to explicitly selected full reporting weeks. Any partial or retrospective declaration that changes a locked score must use an audited amendment and versioned recalculation. | Business owner — **Open boundary; full-week approach adopted** |
| DEC-006 | P1 | Quarter rollover vs strategy creation | Previous quarter locks when next quarter begins; sequence for future quarter planning/activation is not fully specified. | Define whether future quarter can be drafted in advance and exact activation trigger; keep prior quarter read-only. | Product owner — Open |
| DEC-007 | P1 | Strategy edits after activation | No complete rule for editing Objective/KR/Sub-KR after quarter activation or what happens to existing mappings. | Recommend versioned amendments; preserve historical snapshots and require reason/approval for material changes. | Business owner — Open |
| DEC-008 | P1 | Edit lease expiry/takeover | One active BU Lead edit lease is required, but lease duration, heartbeat, abandoned-session expiry and admin takeover rules need exact values. | Define configurable TTL, heartbeat, visible lease owner, safe takeover and stale-write/version checks. | Product/Engineering — Open |
| DEC-009 | P1 | Financial approval vs disbursement | Approval and actual disbursement are separate; exact actor allowed to mark disbursed and evidence required are not fully specified. | Require Finance approval, then a separate authorised disbursement confirmation with reference/evidence; do not auto-debit on approval unless explicitly chosen. | Finance — Open |
| DEC-010 | P1 | Penalty stacking | Resolved: sum all applicable applied penalty rates and apply the combined rate once to the original weekly base score; no sequential compounding. Final score floor is 0.00%; round final score to two decimal places. The system must retain each penalty and the combined rate for audit. | Implement formula and tests. Repeated-correction eligibility beyond the stated applicable-rate rule remains governed by the integrity-correction workflow; do not invent extra penalties. | Business owner — **Resolved 2026-10-12** |
| DEC-011 | P1 | Attendance session outcomes | Resolved: SKIPPED is the only non-held OKR outcome. It creates VIRTUAL_PRESENT rows for every staff member in scope, with an audited atomic bulk action and no absence violation. Every BU still submits a weekly report with a manually authored performance summary, and reports remain subject to review. | Implement SKIPPED semantics; do not implement CANCELLED OKR status/workflow; VIRTUAL_PRESENT is not physical attendance. | Business owner — **Resolved 2026-10-12** |
| DEC-012 | P1 | Fine configuration | Fine/criticality are management-controlled but versioning and whether historical violations retain original amount are not specified. | Version configuration; snapshot applied fine/criticality on violation creation; changes affect future records only. | HR/Finance — Open |
| DEC-013 | P2 | Retention and privacy | Retention periods for employee, attendance, violation, audit and export records are absent. | Approve retention schedule and access/erasure handling consistent with applicable obligations. | Legal/HR/Security — Open |
| DEC-014 | P2 | Service-level objectives | Numeric performance, availability, RPO and RTO targets are absent. | Approve load assumptions, p95 targets, availability target, RPO/RTO and support hours. | Product/Operations — Open |
| DEC-015 | P2 | Notifications channels | Event list exists, but provider, retries, delivery guarantees, preferences and digest behaviour are incomplete. | Define provider and delivery expectations; make business transaction independent from delivery; approve preferences as enhancement. | Product/Operations — Open |
| DEC-016 | P2 | Attendance amendment rejection rationale | The business owner confirmed that a request reason is mandatory and that no separate signed/written approval document is required. They have not explicitly decided whether an in-app rejection comment is mandatory. | Do not enforce a mandatory rejection comment until the business owner decides; always audit the rejection action and notify the requester. | Business owner/HR — Open |

## B. Product enhancement proposals (not approved requirements)
1. Effective-dated BU membership and role history.
2. Report version history and explicit change log before content lock.
3. Versioned strategy amendments with impact analysis.
4. SMART evaluator version/input snapshot for reproducibility.
5. Finance maker-checker controls and approval thresholds by amount.
6. User notification preferences and digest options.
7. Correlation IDs and support reference IDs in error responses.
8. Controlled settings console for safe business configuration, with versioning and audit; secrets and security-critical policy remain protected.
9. Scheduled reports and saved views, with recipient authorization checks.
10. Reconciliation exception queue and exportable finance reconciliation evidence.

## C. High-risk consistency checks
- Confirm the scoring engine uses a 0–100 scale everywhere; ADR-030 notes historical 0–10 database constraints were corrected.
- Confirm all weekly score calculation paths use the agreed additive penalty-rate formula and consistently round the final weekly score to two decimal places; test zero-floor behaviour.
- Confirm quarterly calculations include all NORMAL and SKIPPED-session weeks, exclude declared ORGANIZATION_HOLIDAY weeks, and include missing-report zeros for reportable weeks unless an authorised exception applies; test score versioning and post-quarter correction without quarter reopening.
- Confirm SMART evaluation persistence errors are surfaced and goal creation cannot silently succeed without its evaluation when evaluation is required.
- Confirm RLS identity derives from verified JWT/user lookup, not caller-supplied role/BU context; ADR-025 describes `set_rls_context` as a no-op over HTTP.
- Confirm current MFA/session revocation paths implement accepted ADRs; prior ADRs record no-op session operations that were remediated.
- Confirm audit insert failure handling is monitored and that the business/security action's success semantics are deliberate.
- Confirm financial transactions use fixed-precision numeric, append-only ledger, idempotency and concurrency-safe balance checks.
- Confirm exact lock boundary semantics (at 18:00:00 and 11:00:00 WAT), scheduler retries and duplicate prevention.
- Confirm finalised source attendance records cannot be updated/deleted and that amendment approval changes only the effective status/history, not the source roster.
- Confirm attendance amendments require HR request permission, independent designated Admin/HR approval, mandatory request reason, optional evidence, no self-approval, and complete audit/notification trail.
- DEC-016 remains open: whether an in-app reviewer comment must be mandatory when rejecting an amendment. A separate signed/written approval document is not required.

## D. Requirement traceability map

| Business objective | PRD modules | FRD requirements | SRS / verification |
|---|---|---|---|
| BO-001 Centralise reporting | P-04, P-05 | FR-WR-001–018, FR-GOAL-001–007, FR-TASK-001–004 | Unique BU/week constraint; report E2E; concurrency tests |
| BO-002 Strategic traceability | P-03, P-05 | FR-STR-001–010, FR-GOAL-003–005 | Strategy constraints; activation tests; mapping validation |
| BO-003 Fair scoring | P-06, P-08 | FR-SC-001–011, FR-INT-001–009 | Unit/property tests; approved worked examples |
| BO-004 Time accountability | P-04, P-16 | FR-WR-009–017 | WAT boundary, retry, scheduler outage and idempotency tests |
| BO-005 Historical integrity | P-08, P-14 | FR-INT-001–009, FR-AUD-001–004 | Append-only audit, correction workflow and direct API tests |
| BO-006 Management visibility | P-06, P-12 | FR-DASH-001–008 | Role-specific dashboard/E2E and export authorization tests |
| BO-007 Governance workflows | P-09, P-10, P-13 | FR-ATT-001–014, FR-VIO-001–006, FR-NOT-001–004 | Attendance/violation/payment integration tests; amendment approval and immutable-history tests |
| BO-008 Financial control | P-11 | FR-FIN-001–012 | Atomic ledger, concurrency, idempotency, reconciliation tests |
| BO-009 Data protection | P-02, P-14, P-16 | FR-ID-004–009, FR-AUD-001–004 | RLS matrix, privilege escalation and export tests |

## E. Recommended acceptance gates
- Resolved attendance decisions (PRESENT-by-default roster and SKIPPED → VIRTUAL_PRESENT semantics), Organization Holiday reporting state, and Finding 3 quarterly scoring/missing-report rules are reflected across BRD/PRD/FRD/UI-UX/SRS and supporting tests. P0 decision DEC-020 (submitted-but-unreviewed reports) and remaining quarterly calendar/BU lifecycle edge cases remain open.
- Every FRD requirement has one or more test IDs or an explicitly documented reason it cannot be automated.
- No contradictory rule remains between source-of-truth, business rules, scoring engine, acceptance criteria and implementation.
- Live schema, RLS policies, RPC grants and current runtime paths are verified in a safe environment; documents alone are not implementation evidence.


### Attendance decisions from the business-owner clarification
- Default status: PRESENT for every active staff member in a newly generated weekly roster.
- Normal held session: HR or another permissioned user toggles exceptions after the OKR session, then finalises the roster.
- Skipped session: a permissioned `Skip OKR for this week` action atomically marks the week/session SKIPPED and all in-scope staff VIRTUAL_PRESENT. This is a bulk operation and must be audited/idempotent.
- There is no CANCELLED OKR outcome or cancellation workflow.
- VIRTUAL_PRESENT identifies a week with no physical OKR session, not physical attendance; no absence violation/penalty is generated. Every BU must still submit a weekly report with a manually entered performance summary, and reports must be reviewed.
- Post-finalisation corrections continue to follow DEC-002. Correcting an erroneous skip outcome uses a separate audited exception workflow.


### DEC-018 — Skipped OKR weeks retain mandatory BU reporting (Agreed)
**Decision:** `Skip OKR for this week` means the physical session does not take place; it does not cancel the reporting week or waive any BU's reporting obligation. There is no separate cancelled-session outcome. Every BU must manually enter a performance summary for the affected week, submit its weekly report through the standard workflow, and have the report reviewed. The system must not satisfy the manual-entry requirement using only an automatically generated summary. There is no CANCELLED OKR status or workflow.
**Rationale:** Session attendance and weekly performance accountability are separate processes. The absence of a physical meeting does not remove the obligation to report and review performance.
**Implications:** Keep report deadlines, submission states, review queues, scoring and compliance controls active for skipped weeks. Show the skipped-session indicator separately from report state.

### DEC-019 — Quarterly scoring denominator, missing reports and authorised late corrections (Agreed)
**Decision 1:** Use every non-holiday calendar reporting week in the quarter as the denominator. Average the weekly score values equally; NORMAL and SKIPPED-session weeks count, while any week declared `ORGANIZATION_HOLIDAY` is excluded because no report is due. Missing reports in reportable weeks remain zero-valued.

**Decision 2:** If a report is not submitted by weekly final lock, assign `0.00` and `NON_COMPLIANT` unless an authorised exception applies. The zero remains in the quarter denominator. A submitted report scoring zero is distinct from non-submission.

**Authorised exception:** An authorised exception may allow a late report to be submitted and reviewed after weekly or quarter lock. If accepted and reviewed, its score replaces the missing-report zero only in a new versioned quarterly score snapshot. Preserve the original zero, previously published quarterly score, authorisation/approval and reason, report/review references, old/new values, recalculation details and timestamps. Do not generally reopen a locked quarter.

**Remaining boundaries:** A submitted-but-unreviewed report is not a missing report. The quarter-end finalisation treatment for that state and BU lifecycle/partial-quarter cases remain open under DEC-004/DEC-020.


### DEC-021 — Organization Holiday reporting state and denominator (Agreed)
**Decision:** The weekly workflow distinguishes (1) NORMAL reporting week, (2) SKIPPED physical OKR session while reporting remains mandatory, and (3) `ORGANIZATION_HOLIDAY` when the organisation is closed and no BU reports are required. HR, Admin or Super Admin (or a user with explicit holiday-management permission) can mark affected reporting week(s) as `ORGANIZATION_HOLIDAY`.

**Rules:** The holiday declaration is a reporting-period state, not a `CANCELLED` or `SKIPPED` session outcome. No weekly BU report/comment is required for declared holiday week(s); suppress weekly report reminders and missing-report zero/non-compliance for non-submission in those periods. Notify all BU Leads of the holiday period. Do not generate `VIRTUAL_PRESENT` rows solely from the holiday state. Exclude holiday week(s) from quarterly numerator and denominator. NORMAL and SKIPPED-session weeks remain included. A quarter with no eligible reporting weeks displays `N/A`.

**Audit and implementation controls:** Require selected week(s), confirmation, reason, actor and timestamp; append state-change events. If a change after report/quarter lock changes score eligibility, perform a controlled amendment and create a new quarterly score snapshot/version without mutating prior published history. The implementation assumes declarations apply to identified full reporting weeks; partial-week holiday semantics remain open if required.

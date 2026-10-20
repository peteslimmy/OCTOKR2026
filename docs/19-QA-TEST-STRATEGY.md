# 4CORE-OKR QA and Test Strategy

## Test layers

1. Unit
2. Component
3. Integration
4. API
5. Database
6. RLS/security
7. End-to-end
8. Concurrency
9. Financial integrity
10. Accessibility
11. Performance
12. Reliability/recovery
13. Regression
14. UAT
15. Production smoke

## Environments

- Local/Development
- Staging/UAT
- Production

Separate credentials/data/storage/monitoring.

## Core rule

Every business rule must have an automated verification.

## Critical functional tests

### Reporting

- 0 Goals cannot submit.
- 1 Goal can submit.
- unlimited Goals are technically permitted.
- SMART weakness does not block.
- Submit Report exists.
- Content Lock at Tuesday 18:00.
- Final Lock at following Tuesday 11:00.
- Undefined becomes Not Done at Final Lock.
- Held/skipped meeting state does not change report locks; an officially declared ORGANIZATION_HOLIDAY suspends reporting obligations and suppresses missing-report consequences.

### Scoring

- equal Goal weighting;
- Stretch included;
- task count does not change Goal weighting;
- no submission at final lock = 0.00 + NON_COMPLIANT, unless an authorised exception applies; a submitted score of 0.00 is a distinct state;
- quarter denominator is all non-holiday calendar reporting weeks (NORMAL + SKIPPED), excludes ORGANIZATION_HOLIDAY weeks, and does not shrink for missing reports in reportable weeks;
- skipped physical OKR week remains in denominator and uses its normally reviewed report score;
- missing-report zero is included in quarter average;
- authorised late report accepted and reviewed after quarter lock creates a new quarterly score version, replaces the zero in the new version, preserves the original zero and prior published score, records reason/approval and does not reopen the quarter;
- late amendment denial without permission, reason or required audit evidence; ensure failed correction does not mutate prior snapshots;
- submitted-but-unreviewed report is not automatically treated as missing; apply provisional/final behavior only as defined after the remaining decision is approved;
- Post-quarter late-report amendment preserves the locked quarter's normal edit restrictions, preserves the original missing-report zero and old published quarterly snapshot, records explicit permission/approval and mandatory reason, and creates exactly one new versioned quarterly snapshot.
- Denominator remains the all-calendar-reporting-weeks count after a correction; only the affected week contribution and derived numerator/score change.
- `ORGANIZATION_HOLIDAY` may be set only by authorised HR/Admin/SuperAdmin or equivalent explicit permission; require selected week(s), non-empty reason, confirmation and append-only audit.
- Organization-holiday week sends a notice to all BU Leads, suppresses report reminders/overdue status/missing-report zero/NON_COMPLIANT, creates no mandatory weekly report or skipped-session comment, creates no VIRTUAL_PRESENT roster by implication, and is excluded from quarterly numerator and denominator.
- A NORMAL reporting week with a SKIPPED physical session notifies all BU Leads, activates the mandatory manual summary comment for each BU, still requires normal report submission/review, and remains in the quarter denominator.
- A BU cannot submit a report for a SKIPPED week without a non-blank manually authored summary comment; the comment never substitutes for submission/review.
- Changing holiday state after quarter lock requires controlled audited amendment and creates a new score snapshot if scoring eligibility changes; prior snapshots remain unchanged.
- Quarter with no eligible non-holiday weeks returns `N/A` / `NO_ELIGIBLE_REPORTING_WEEKS`, not divide-by-zero or a fabricated 0.00.
- integrity penalty formula, including: 80.00% base + one 5% penalty = 76.00%; 80.00% base + two 5% penalties = 72.00%; 3.00% base + 10% penalty = 2.70%; combined rate at or above 100% floors at 0.00%; and final score precision is two decimal places across persistence, API, UI and exports; verify penalties are summed then applied once, never compounded sequentially;
- score floor 0.

### Attendance amendment / integrity

- finalised source attendance rows reject UPDATE and DELETE through API and database paths;
- HR can create amendment request at any time for eligible finalised attendance;
- missing/blank reason is rejected; evidence attachment is optional;
- request remains pending and effective status is unchanged until approved;
- requester self-approval is denied even when the same identity also has Admin/approver role;
- non-approver cannot approve/reject; approval/rejection requires distinct authenticated identity;
- rejection is audited and the requester is notified; do not require a reviewer comment until that policy is approved;
- approved amendment updates effective status in roster/report/export views but original status and original roster snapshot remain unchanged;
- requests and decisions remain historically viewable; repeated correction requires a new request;
- concurrent duplicate pending requests and stale-state approval are rejected safely;
- audit and notifications are created exactly once per committed business event; email failure does not roll back state.

### Security

- cross-BU denied;
- IDOR/BOLA denied;
- privileged bypass denied;
- RLS enforced;
- audit immutable.

### Finance

- self-approval denied;
- overdrawn approval denied;
- duplicate payment prevented;
- concurrent approval safe;
- ledger reconciliation exact.

## Performance

Establish p95 targets for representative APIs and pages. Monitor p50/p95/p99.

## Accessibility

Target WCAG 2.2 AA.

Test keyboard, focus, screen reader, colour contrast, reduced motion.

## Reliability

Test database failure, scheduler failure, email failure, AI-provider failure, network interruption, retry/idempotency.

## Regression

Every production defect becomes a permanent regression test.


### Attendance defaults and Skip OKR acceptance tests
- Creating a weekly roster snapshots all eligible active staff and defaults each row to PRESENT server-side.
- HR can change draft rows to ABSENT, ON_LEAVE, EXCUSED, ILL and configured approved statuses; status counts update correctly.
- Finalising a held roster makes source rows immutable through UI, API and database paths.
- A permitted user can Skip OKR for the week; the operation marks the session SKIPPED and all staff in the roster scope VIRTUAL_PRESENT in one transaction. Verify that the action does not suppress weekly reports, that every BU must manually enter a performance summary and submit the report, and that report review remains required.
- A skip retry with the same idempotency key does not duplicate rows; concurrent requests cannot produce mixed states. Failure rolls back both session state and all generated rows.
- A user without `attendance.session.manage` cannot invoke skip by hiding/showing UI controls, direct API calls or RPC calls.
- A SKIPPED session displays a skipped-week indicator, is distinguishable from PRESENT, and generates no absence violation/penalty.
- There is no CANCELLED OKR status or workflow. A skipped physical session still requires every BU to submit its weekly report with a manually authored performance summary, and submitted reports must pass through the normal review process.
- Skip-generated rows cannot be individually edited; an erroneous session outcome requires the separate audited exception path.

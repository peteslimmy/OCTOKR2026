# 4CORE-OKR Product Requirements Document

## 1. Product goals

### PG-001 — Replace spreadsheet reporting
Provide a single system of record for weekly BU commitments and execution.

### PG-002 — Improve strategic traceability
Connect weekly goals to Sub-KRs and allow management to trace strategy to execution.

### PG-003 — Create trustworthy accountability
Enforce deadlines, immutable historical records, controlled corrections, and auditable scoring.

### PG-004 — Improve management visibility
Provide current, historical, BU-level, Sub-KR-level, and organisational reporting.

### PG-005 — Digitise governance-financial flow
Digitise attendance, violations, violation-fund accounting, HR requests, and Finance approval.

## 2. Scope

The product includes:

- organisation/BU management;
- employees and application users;
- RBAC;
- strategy and quarter management;
- weekly BU reporting;
- SMART checker;
- tasks and execution;
- scoring;
- presenter mode;
- integrity correction;
- attendance;
- violations;
- quotes;
- violation fund and ledger;
- disbursement workflow;
- dashboards;
- audit;
- notifications;
- security and RLS;
- QA/observability support.

## 3. Success indicators

The product should enable:

- near-complete weekly report submission visibility;
- reliable automatic lock enforcement;
- no unexplained score changes;
- no cross-BU data exposure;
- zero negative financial balances;
- complete audit coverage for critical actions;
- management visibility without spreadsheet reconciliation.

## 4. Core management views

Management needs:

- BU weekly ranking;
- quarterly execution trend;
- Sub-KR execution;
- non-compliant BUs;
- integrity corrections;
- SMART quality analytics;
- violation/fund summary;
- pending finance decisions.

## 5. Product quality expectations

The application must be:

- secure;
- responsive;
- accessible;
- auditable;
- deterministic;
- performant;
- reliable;
- easy to use;
- visually polished;
- free from hardcoded production business data.


## Weekly operating-state requirements

- NORMAL week: weekly report is mandatory.
- SKIPPED physical OKR session: weekly report remains mandatory; notify all BU Leads; activate a required manually authored summary-comment field in each BU report; normal review remains mandatory.
- ORGANIZATION_HOLIDAY: HR/Admin/SuperAdmin or a specifically permissioned user can declare affected reporting week(s); no BU report is required; notify all BU Leads; suppress report reminders and non-submission penalties; exclude the affected week(s) from quarterly score numerator and denominator.
- The holiday reporting state is separate from session outcome and does not create VIRTUAL_PRESENT records.

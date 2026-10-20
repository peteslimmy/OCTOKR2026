# 4CORE-OKR Implementation Plan

## Phase 0 — Audit

- audit existing codebase;
- audit stack/dependencies;
- audit database;
- audit routes/APIs;
- audit hardcoded data;
- audit roles/RBAC;
- audit security;
- audit tests;
- audit obsolete features;
- produce gap matrix.

No blind rewrite.

## Phase 1 — Foundation

- Next.js project structure;
- Tailwind/shadcn/Radix design system;
- logging/observability;
- environment configuration;
- database connectivity;
- migration framework.

## Phase 2 — Identity and organisation

- organisations;
- BUs;
- employees;
- users;
- roles;
- permissions;
- authentication;
- MFA/lockout.

## Phase 3 — Security boundaries

- RLS;
- API authorization;
- scope policies;
- audit foundation.

## Phase 4 — Strategy

- Annual Theme;
- Quarter;
- Objective;
- KRs;
- Sub-KRs;
- quarter activation/lock.

## Phase 5 — Reporting calendar

- reporting weeks;
- WAT scheduling;
- Content Lock and Final Lock timestamps;
- countdown source.

## Phase 6 — Weekly reporting

- report;
- edit lease;
- goals;
- tasks;
- Submit Report;
- lock lifecycle.

## Phase 7 — SMART

- evaluator;
- score;
- suggestions;
- fallback behaviour;
- engine versioning.

## Phase 8 — Scoring

- Goal derivation;
- weekly score;
- penalty calculation;
- snapshots;
- quarterly execution.

## Phase 9 — Presenter and integrity

- Presenter Mode;
- correction workflow;
- penalties;
- waiver.

## Phase 10 — Attendance and violations

- sessions;
- attendance;
- quote;
- violation types;
- violations;
- payments.

## Phase 11 — Finance

- fund;
- ledger;
- disbursement request;
- Finance approval;
- disbursement;
- reconciliation.

## Phase 12 — Dashboards/analytics

- BU dashboard;
- executive dashboard;
- rankings;
- Sub-KR execution;
- compliance;
- finance summary.

## Phase 13 — Hardening

- security review;
- dependency review;
- performance;
- accessibility;
- concurrency;
- reliability.

## Phase 14 — Migration

- staging migration;
- reconciliation;
- UAT migration;
- production rehearsal;
- production migration.

## Phase 15 — Go-live

- final regression;
- security gate;
- DB/RLS gate;
- financial reconciliation;
- UAT signoff;
- production smoke;
- enhanced monitoring.

## Vertical-slice rule

Build each feature across DB → domain → API → security → UI → tests before moving to the next domain.


### Organization Holiday reporting state
- Add `reporting_state` and append-only state-event persistence for each reporting week.
- Add required skipped-session summary comment to BU weekly reports and enforce it server-side only when session outcome is SKIPPED.
- Implement permission-gated Organization Holiday action, BU Lead notification, suppression of due/overdue/non-compliance/zero score, and denominator exclusion.
- Version quarter snapshots with included/excluded reporting-week references and a no-eligible-weeks N/A result.
- Test normal, skipped, holiday, post-lock amendment, notification retries, RBAC/RLS, concurrency and audit immutability.

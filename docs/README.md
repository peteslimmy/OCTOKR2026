# 4CORE-OKR Engineering Documentation

## Purpose

This repository contains the authoritative product, functional, domain, database, API, UX, security, QA, DevOps, and AI-engineering specifications for **4CORE-OKR**.

4CORE-OKR is an organisation-wide strategic execution, weekly accountability, governance, and performance platform. It replaces spreadsheet-based weekly reporting with a controlled system of record connecting:

**Annual Theme → Quarterly Objective → Key Results → Sub-KRs → Weekly SMART Goals → Tasks → Execution → Weekly BU Score → Quarterly Execution**

The platform also manages a separate governance/financial flow:

**Tuesday Attendance → Violations → Fines → Violation Fund → HR Disbursement Request → Finance Approval/Rejection → Disbursement → Ledger**

## Authoritative documentation

Read `docs/00-SOURCE-OF-TRUTH.md` before modifying the system.

The implementation agent must treat the rules in this repository as authoritative over legacy implementation behaviour or legacy documentation.

## Documentation map

| File | Purpose |
|---|---|
| `AGENTS.md` | AI engineering operating contract |
| `docs/00-SOURCE-OF-TRUTH.md` | Authority, precedence, superseded legacy rules |
| `docs/01-PRODUCT-VISION.md` | Product vision, scope, outcomes |
| `docs/02-PRODUCT-REQUIREMENTS.md` | PRD |
| `docs/03-FUNCTIONAL-REQUIREMENTS.md` | FRD |
| `docs/04-BUSINESS-RULES.md` | Non-negotiable business rules |
| `docs/05-USER-JOURNEYS.md` | Detailed user journeys |
| `docs/06-ROLES-PERMISSIONS.md` | RBAC, scope, authorisation |
| `docs/07-SCORING-ENGINE.md` | Scoring formulas and examples |
| `docs/08-STATE-MACHINES.md` | Lifecycle/state-transition rules |
| `docs/09-DOMAIN-MODEL.md` | Domain entities and relationships |
| `docs/10-DATABASE-SPEC.md` | PostgreSQL/Supabase physical design |
| `docs/11-RLS-SECURITY.md` | RLS and security rules |
| `docs/12-API-CONTRACT.md` | API contracts |
| `docs/13-UI-UX-SPEC.md` | Screen and interaction specification |
| `docs/14-DESIGN-SYSTEM.md` | Visual/component system |
| `docs/15-AUDIT-CONTROLS.md` | Audit and immutability |
| `docs/16-FINANCIAL-CONTROLS.md` | Violation fund and financial controls |
| `docs/17-NOTIFICATIONS.md` | Notification/event rules |
| `docs/18-SECURITY-THREAT-MODEL.md` | Threat model and controls |
| `docs/19-QA-TEST-STRATEGY.md` | Quality engineering strategy |
| `docs/20-ACCEPTANCE-CRITERIA.md` | Testable acceptance criteria |
| `docs/21-DEVOPS-RELIABILITY.md` | Deployment/reliability |
| `docs/22-DATA-MIGRATION.md` | Existing-to-target migration |
| `docs/23-IMPLEMENTATION-PLAN.md` | Build sequence |
| `docs/24-DECISIONS.md` | Architecture/product decision log |
| `ai/MASTER-BUILD-PROMPT.md` | Master coding-agent prompt |

## Non-negotiable system principles

1. BU is the operational tenant/security boundary.
2. Strategy is organisation-wide.
3. BU Lead weekly reports represent BU commitments, not personal commitments.
4. Weekly report content locks Tuesday at 18:00 WAT.
5. Weekly reports final-lock the following Tuesday at 11:00 WAT.
6. Final lock is independent of whether the Tuesday physical meeting occurs.
7. Goal status is derived from task state.
8. Weekly score is based on equally weighted goals.
9. SMART quality does not block submission.
10. Integrity corrections follow one governed workflow for Presenter, Admin, and SuperAdmin.
11. Financial operations are transactional and auditable.
12. Historical/audit/financial records cannot be silently rewritten.
13. UI restrictions are not security boundaries; backend and database enforcement are mandatory.

Organisation Holiday: reporting-period state separate from SKIPPED session; no weekly report required, normal report reminders/missing-report penalties suppressed, and affected week(s) excluded from quarterly scoring. SKIPPED sessions still require a weekly BU report plus manual summary comment; all BU Leads are notified.

Organization Holiday is a distinct reporting-period state; no BU report is due during the designated reporting week(s), and those weeks are excluded from quarterly score denominator.

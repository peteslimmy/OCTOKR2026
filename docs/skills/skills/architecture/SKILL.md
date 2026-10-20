# 4CORE-OKR Solution & Software Architecture Skill

## Purpose
Act as Principal Solutions Architect and Software Architect. Keep the system modular, secure and maintainable.

## Read First
- `docs/00-SOURCE-OF-TRUTH.md`
- `docs/09-DOMAIN-MODEL.md`
- `docs/10-DATABASE-SPEC.md`
- `docs/12-API-CONTRACT.md`
- `docs/18-SECURITY-THREAT-MODEL.md`
- `docs/21-DEVOPS-RELIABILITY.md`
- `docs/24-DECISIONS.md`

## Target Architecture
- Next.js
- Tailwind CSS
- shadcn/ui
- Radix UI
- PostgreSQL/Supabase
- Modular monolith with domain-oriented modules

## Core Domains
Identity, Organisation, BU, Strategy, Weekly Reporting, SMART Goals, Scoring, Presentation, Integrity, Attendance, Violations, Finance, Notifications, Audit, Administration.

## Architecture Rules
1. Business logic belongs in domain/application services.
2. High-consequence actions use business capability APIs, not unrestricted CRUD.
3. Authorization occurs before mutation.
4. BU scope is enforced at multiple layers.
5. Server time is authoritative.
6. Financial operations are transactional.
7. Critical audit is part of the same transaction.
8. Derived values are calculated, not manually edited.
9. Scheduler failure must not create security/lifecycle bypass.
10. Do not introduce microservices without a verified need.

## Change Impact
For every architectural change assess DB, API, RLS, state machine, scoring, audit, notifications, tests, migration and rollback.

## Definition of Done
Architecture has explicit boundaries, ownership, security model, failure behavior, observability and migration impact.

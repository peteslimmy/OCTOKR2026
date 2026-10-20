# 4CORE-OKR Backend Engineering Skill

## Purpose
Act as Principal Backend Engineer. Build secure, deterministic, transactional business services.

## Read First
- `docs/03-FUNCTIONAL-REQUIREMENTS.md`
- `docs/04-BUSINESS-RULES.md`
- `docs/06-ROLES-PERMISSIONS.md`
- `docs/08-STATE-MACHINES.md`
- `docs/11-RLS-SECURITY.md`
- `docs/12-API-CONTRACT.md`
- `docs/15-AUDIT-CONTROLS.md`
- `docs/16-FINANCIAL-CONTROLS.md`

## API Rules
Use versioned `/api/v1` business APIs. Do not expose unrestricted table CRUD for high-consequence workflows.

## Every Mutation
Validate:
1. Authentication
2. Permission
3. Resource scope
4. Lifecycle state
5. Input
6. Transaction
7. Audit
8. Events/notifications
9. Idempotency where relevant

## Critical Operations
Integrity correction, violation payment, disbursement approval, quarter lock and similar high-risk operations must be atomic.

## Lifecycle
API must independently reject operations after Content/Final Lock even if the scheduler has not yet updated a status field.

## Concurrency
Use optimistic versioning for editable aggregates and transactional locking for financial balance consumption.

## Definition of Done
Endpoint has validation, authorization, scope enforcement, lifecycle checks, deterministic errors, audit, tests and concurrency handling.

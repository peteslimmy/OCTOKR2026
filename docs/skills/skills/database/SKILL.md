# 4CORE-OKR PostgreSQL/Supabase Database Skill

## Purpose
Act as Principal PostgreSQL DBA/Database Architect. The database is part of the business-control and security boundary.

## Read First
- `docs/09-DOMAIN-MODEL.md`
- `docs/10-DATABASE-SPEC.md`
- `docs/11-RLS-SECURITY.md`
- `docs/15-AUDIT-CONTROLS.md`
- `docs/16-FINANCIAL-CONTROLS.md`

## Core Rules
Use PostgreSQL/Supabase with:
- UUID primary keys
- explicit foreign keys
- CHECK constraints
- unique constraints
- justified indexes
- normalized structures
- RLS
- immutable audit controls
- controlled privileged functions/RPCs

## Target Normalization
Aim for practical 5NF or better. Avoid repeated groups, CSV fields, denormalized ownership facts and duplicated business facts.

## Critical Constraints
- employee email unique;
- one weekly report per BU/week;
- 3–4 KRs at quarter finalization;
- every KR has >=1 Sub-KR;
- KR_ALIGNED Goal requires Sub-KR;
- STRETCH Goal has no Sub-KR;
- Task status only UNDEFINED/DONE/NOT_DONE;
- currency NGN;
- no negative fund balance;
- audit rows immutable.

## Lifecycle
Before Content Lock, allowed Goal/Task deletion should be soft deletion where history must remain traceable. After Content Lock, content mutation is denied. After Final Lock, historical reporting records are immutable.

## Migration
Inspect current schema, constraints, triggers, functions, RLS and data quality before changing anything. Reconcile source and target counts and financial totals.

## Definition of Done
Migration + constraints + RLS + indexes + data impact + tests + recovery plan are complete.

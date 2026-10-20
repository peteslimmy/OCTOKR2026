# 4CORE-OKR Product Management Skill

## Purpose
Act as Principal Product Manager/Product Strategist. Preserve approved product intent and prevent scope drift.

## Read First
- `docs/00-SOURCE-OF-TRUTH.md`
- `docs/01-PRODUCT-VISION.md`
- `docs/02-PRODUCT-REQUIREMENTS.md`
- `docs/04-BUSINESS-RULES.md`
- `docs/05-USER-JOURNEYS.md`
- `docs/24-DECISIONS.md`

## Non-Negotiable Product Invariants
- One Annual Theme per organisation/year.
- One Quarterly Objective per quarter.
- 3–4 KRs per quarter.
- Every KR has at least one Sub-KR.
- Every BU needs at least one weekly Goal before submission.
- KR-aligned Goal requires exactly one Sub-KR.
- Stretch Goal has no Sub-KR.
- SMART weakness warns but never blocks submission.
- Content Lock: Tuesday 18:00 WAT.
- Final Lock: following Tuesday 11:00 WAT.
- Undefined tasks become Not Done at Final Lock.
- Every Goal has equal weekly weight.
- No submission = 0% + NON_COMPLIANT.
- Integrity correction workflow cannot be bypassed, including by SuperAdmin.
- All money is NGN.
- BU is the operational tenant boundary.

## Decision Procedure
Before changing behavior:
1. Identify affected business rules.
2. Identify affected actors and workflows.
3. Check `docs/24-DECISIONS.md`.
4. Check for conflicts with higher-authority documents.
5. Identify API, DB, RLS, UX and QA impacts.
6. Record an ADR for material new decisions.

## Definition of Done
A product requirement is complete only when actor, scope, trigger, preconditions, flow, exceptions, outcomes, business impact and acceptance criteria are explicit.

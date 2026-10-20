# 4CORE-OKR Quality Engineering Skill

## Purpose
Act as Principal QA/Test Engineer and prove that the product is correct, secure, usable and reliable.

## Read First
- `docs/03-FUNCTIONAL-REQUIREMENTS.md`
- `docs/04-BUSINESS-RULES.md`
- `docs/07-SCORING-ENGINE.md`
- `docs/08-STATE-MACHINES.md`
- `docs/19-QA-TEST-STRATEGY.md`
- `docs/20-ACCEPTANCE-CRITERIA.md`
- `docs/18-SECURITY-THREAT-MODEL.md`

## Test Layers
Unit, component, integration, API, DB, RLS, E2E, security, accessibility, performance, concurrency, reliability, recovery, regression.

## Critical Time Boundaries
Test exactly:
- Tuesday 17:59:59
- Tuesday 18:00:00
- Tuesday 18:00:01
- following Tuesday 10:59:59
- following Tuesday 11:00:00
- following Tuesday 11:00:01

## Critical Negative Tests
- cross-BU access denied;
- post-lock content edit denied;
- Final Locked report immutable;
- SuperAdmin integrity bypass denied;
- Finance self-approval denied;
- fund cannot go negative;
- audit cannot be changed/deleted.

## Definition of Done
Every business rule has tests, including negative and boundary tests. A green UI is not evidence of backend correctness.

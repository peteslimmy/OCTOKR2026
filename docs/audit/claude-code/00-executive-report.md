# 00 — Executive report

**Application:** 4CORE-OKR (weekly OKR execution, scoring, governance and violation-fund application). **Audit date:** 2026-10-26. **Auditor:** Claude Code (Sonnet 5.5), audit-only. **Package:** this folder; the authoritative list of findings is report 13.

## Overall condition
The core of the system is better built than its status documents suggest, and the surrounding material is worse than it looks.

**Sound, with evidence:** the database layer is careful. Of 300 functions, 229 run as their owner and all of them pin `search_path`; anonymous users can run none; every `read_*` function checks the caller except one trivial case (F-015); signed-in users hold no write privilege on any table; 78 row-level-security policies protect the tables that users can read. The scoring rules match the specification (`docs/07`) in both TypeScript and SQL. Sign-in is protected by a database-backed rate limiter, mandatory second factor for privileged roles, and well-designed emailed codes (CSPRNG, keyed hash bound to person and purpose, 10-minute expiry, 5 attempts, session-bound). On a freshly reset database all 487 unit and database tests pass, and about 30 screens render without errors.

**Not sound:**
1. **The owner's data was destroyed by the project's own test scripts** (F-001, HIGH). One local database is both the working database and the test target, and every test script resets it. This already caused real loss on 2026-10-24.
2. **Evidence-file access control was broken** (F-002 HIGH, F-003, F-008): downloads bypassed row-level security, and uploads wrote before authorising.
3. **Several features reported "complete" were not working** (F-004, F-006): a core page crashed with a 500, the unit hierarchy could not be created through the API, the quote routes called functions that did not exist, and one dashboard card could never render.
4. **The quality gate is red** (F-005): `npm run lint` fails and CI runs it.

No CRITICAL finding was substantiated. That is not a statement that none exists: roles other than Super Admin, end-to-end workflows, concurrency and the full browser suite were not exercised (report 16).

## What changed during this session (disclosure)
Before the audit instruction, in the same session, I changed application code to fix F-002, F-003, F-004 and F-020, to repair the unit hierarchy, quote workflow, review panel and contribution card, and to add the report-review, hierarchy and quote database tests. All of that is **uncommitted** in the working tree alongside ~100 earlier uncommitted changes. During the audit itself I changed no application code, schema or data; I created only these reports. The audit therefore examines the working tree as it stands, and findings marked *remediated* need independent verification and regression tests.

## Findings by severity
HIGH 2 · MEDIUM 7 · LOW 11 · INFO 3 (23 total; an earlier version of this line said 22 with 11 low, which miscounted the low findings by one). Details: report 13.

**Status at 2026-10-26 (after the first remediation passes, all uncommitted unless noted):** remediated: F-001, F-002, F-003, F-004, F-005, F-007, F-008, F-012, F-014, F-017, F-018, F-020 (F-001 to F-004 and F-020 were committed locally on 2026-10-26 in earlier slices). Still open: F-006 (unreliable status files), F-009 (owner decision), F-010, F-011, F-013, F-015, F-016, F-019, F-023; F-021 and F-022 are informational. Nothing here has been independently re-reviewed.

## Release blockers (recommended)
- Before this application holds production data: fix **F-001** (never let a test run touch real data) and add regression tests for **F-002/F-003**.
- Before the next merge: make lint pass (**F-005**) and add a render smoke test for every page (**F-004**).
- Decide **F-009** (keep or remove the quote workflow and report rejection).

## Recommended next actions, in order
1. Separate the test database from real data and add a guard (F-001); take a verified backup routine.
2. Regression tests for evidence access by role (F-002, F-003, F-008).
3. Green lint, smoke test of all pages, re-run the browser suite (F-005, F-004, F-019).
4. Complete Q4 2026 strategy, activate it, then exercise the weekly cycle end to end with several roles (F-022); this is the biggest unexamined area.
5. Clean up: delete the stray root `lib/`, dead CSP, unreliable status documents, bypass scripts (F-006, F-010, F-013, F-014).
6. Small hardening: user-deletion audit (F-007), RLS on the eight tables (F-012), proxy IP handling (F-011), accessible button names (F-018), advisories (F-016).

## Tested scope in one paragraph
Source inspection of the API layer (169 routes), database functions/policies/grants (live read-only queries), authentication, evidence, scoring and security headers; executed: typecheck (clean), lint (9 errors), 220 non-database unit tests (pass), 487 tests on a clean database earlier in the session (pass), `npm audit`; observed: sign-in as Super Admin, ~30 screens, the Add-unit flow end to end (create, display, delete), dev-mode page timings, an accessibility probe of two pages. Everything else is listed as outstanding in report 16.

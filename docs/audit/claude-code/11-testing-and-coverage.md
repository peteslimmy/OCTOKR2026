# 11 — Testing and coverage

## What was executed in this audit session
| Check | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` | Clean |
| Lint | `eslint .` | Was 9 errors (F-005); now **0 errors, 44 warnings**, `npm run lint` exits 0 |
| Unit tests (no database) | `vitest run src` | 27 files, 220 tests, all pass |
| Database tests, clean database | `supabase db reset` then `vitest run` (earlier, before the audit instruction) | 66 files, **487 tests pass**. Includes the 10 tests added this session (review 4, hierarchy 3, quote 3) |
| Database tests, real data present | `vitest run` | 25 failures in 9 files (attendance, finance, ledger, reminders, config, lock schedule, roles, reports, violation reopen). All fail because the tests assume an empty organisation; they pass on a clean database. This is a test-design weakness (tests count global rows) as much as a data issue |
| Dependency advisories | `npm audit --omit=dev` | 3 moderate, 0 high/critical |
| HTTP authorisation sweep, generated over all 192 route-and-method pairs (second pass) | `tests/api/route-authz.api.test.ts` on the built app against the seeded test stack | 4 tests pass: anonymous refused everywhere except 3 public routes; for 8 roles no route crashes and no blind mutation is accepted |
| HTTP evidence access by role, read-scope content checks (second pass) | `evidence-access.api.test.ts` (10), `read-scope.api.test.ts` (4) | pass after fixes F-025 to F-028; the same tests failed before them |
| Playwright browser suite (155) | not run | Last record 16 Oct: 138 passed, 17 not run, timed out |
| Concurrency suite | `npm run test:concurrency` on the test stack | 5 tests pass; its leftovers stay in the test database (F-001 fixed) |
| Full HTTP suite (23 files) | `run-api-tests.mjs` on the built app, seeded test stack | **All 23 files, 142 tests, pass.** The first run had 3 failing files, explained by F-031 (live mail provider), the broken old evidence test (F-023) and the sweep's run time; all fixed |
| Page smoke test (42 pages x 8 roles, anonymous), client-address unit tests (6), acceptance-criteria report | `page-smoke.api.test.ts`, `client-ip.test.ts`, `npm run ac:coverage` | pass; 11 of 82 criteria are cited by a test (F-019) |
| Database suite, final | `npm run test:db` (test stack) | 42 files, 276 tests pass |
| Unit tests, final | `vitest run src` | 28 files, 224 tests pass |

## Strengths
39 database test files covering RLS, scoring, finance, locks, imports, change control and security; negative-permission assertions are common (`PERMISSION_DENIED`, `IMMUTABLE_RECORD`, `INVALID_STATE_TRANSITION`); a role-permission matrix fixture fails any unintended permission change (it caught my new `quote.approve` grants until the fixture was updated).

## Weaknesses
1. **Destructive, global tests** (F-001): reset scripts and tests that count whole-table rows cannot coexist with real data.
2. **No page-render smoke test** that runs on every change (F-004 shipped to the working tree).
3. **Evidence routes untested** (only database functions are): F-002/F-003 have no regression test.
4. **Traceability:** 13 of 82 acceptance criteria cited (F-019).
5. **The browser suite is too slow to be a regular gate** (1 h) and fragile (timeouts).
6. **Lint red** while CI requires it (F-005).
7. Unit tests of the quote UI step buttons and of the report review panel do not exist.

## Regression tests required by this audit
F-001 guard test; F-002/F-003 evidence access by role and failure compensation; F-004 render all pages; F-007 deletion audit; F-012 RLS on the eight tables; F-015 caller check; the ten tests already added should be kept.

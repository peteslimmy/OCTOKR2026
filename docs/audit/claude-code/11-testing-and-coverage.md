# 11 — Testing and coverage

## What was executed in this audit session
| Check | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` | Clean |
| Lint | `eslint .` | **9 errors, 41 warnings** (F-005) |
| Unit tests (no database) | `vitest run src` | 27 files, 220 tests, all pass |
| Database tests, clean database | `supabase db reset` then `vitest run` (earlier, before the audit instruction) | 66 files, **487 tests pass**. Includes the 10 tests added this session (review 4, hierarchy 3, quote 3) |
| Database tests, real data present | `vitest run` | 25 failures in 9 files (attendance, finance, ledger, reminders, config, lock schedule, roles, reports, violation reopen). All fail because the tests assume an empty organisation; they pass on a clean database. This is a test-design weakness (tests count global rows) as much as a data issue |
| Dependency advisories | `npm audit --omit=dev` | 3 moderate, 0 high/critical |
| Playwright browser suite (155) | not run | Last record 16 Oct: 138 passed, 17 not run, timed out |
| Concurrency suite | not run | Resets the database (F-001) |
| API HTTP suite (21 files) | not run | Needs a seeded stack |

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

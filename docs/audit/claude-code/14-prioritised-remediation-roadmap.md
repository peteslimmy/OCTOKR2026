# 14 — Prioritised remediation roadmap

Severity and order differ: order reflects dependencies and the cost of leaving a problem in place. Nothing here has been implemented by the audit.

## Phase 0 — protect what exists (do first, hours)
| Step | Findings | Why first | Verification |
|---|---|---|---|
| 0.1 Take and keep a verified backup of the working database outside the repo; script it | F-001, ops | Real data was already lost once; every later step may reset the DB | Restore into a scratch DB and compare row counts |
| 0.2 Commit the working tree locally in logical slices (no push) | report 12 | ~140 uncommitted paths with no history | `git log` shows slices; tests still pass |
| 0.3 Separate test database and add the guard — **done 2026-10-26, see F-001** | F-001 | Prevents the next loss; unblocks safe testing for everything below | Full suite run leaves a seeded sample "real" DB unchanged |

## Phase 1 — security and correctness (days)
| Step | Findings | Prerequisite | Risk | Verification |
|---|---|---|---|---|
| 1.1 Regression tests for evidence access by role; magic-byte check; storage compensation test | F-002, F-003, F-008 | 0.3 | Low | Role matrix of allow/deny cases passes |
| 1.2 Audit and reason for user deletion; surface identity-deletion failure | F-007 | none | Low | Audit row with reason; partial-failure result |
| 1.3 Green lint | F-005 | none | Very low | `npm run lint` exits 0 in CI |
| 1.4 Render smoke test for every page | F-004 | 0.3 | Low | Fails if any page returns 500 |
| 1.5 RLS on the eight tables; caller check on `read_payment_is_reversed` | F-012, F-015 | none | Low | DB tests: denied for ordinary users, allowed for the intended role |
| 1.6 Decide and finish quote workflow / report rejection (keep, change or remove) | F-009 | owner | Medium (data model) | Owner sign-off, ADR updated |

## Phase 2 — workflow verification (the largest unexamined area)
Complete and activate Q4 2026 (owner content), then run the weekly cycle end to end with at least BU Lead, HR, Finance, Presenter, Executive and Admin accounts on a **test** copy: report → lock → execution → final lock → score → review/reject → quote → violation → payment → disbursement. Record each in report 05. **Depends on** 0.3 and the owner's Q4 strategy (F-022).

## Phase 3 — cleanup and hardening
Delete stray `lib/`, the dead CSP, unreliable status documents, and bypass scripts (F-006, F-010, F-013, F-014); proxy-IP handling (F-011); accessible names (F-018); standardise route errors (F-017); update dependencies (F-016); tag tests with acceptance-criteria IDs and generate a matrix (F-019); re-run the browser suite and split it for speed.

## Release blockers (justified)
- **For any production use:** 0.1–0.3 (data loss), 1.1 (access control), 1.2 (audit of deletions).
- **For merging:** 1.3, 1.4.
- **Not blockers:** F-011–F-018, F-021, F-022.

## Shared remediation opportunities
A test-environment separation (0.3) addresses F-001 and enables 1.1, 1.4 and Phase 2. A single evidence-access helper tied to the RLS policy removes the F-002 class of error. A lint rule forbidding `adminClient()` before an authorisation call would prevent recurrence.

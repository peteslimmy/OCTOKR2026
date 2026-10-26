# 02 — Requirements traceability

Requirements located: `docs/00`–`docs/38` (43 files), `docs/20-ACCEPTANCE-CRITERIA.md` (82 AC IDs), `docs/05-USER-JOURNEYS.md` (UJ-01…UJ-18), the owner's `../4CORE-OKR_USER_JOURNEYS.md`, `../spec/OKRDOCUMENTATION`, `../spec2/mdfiles`. The two sibling folders were located but not read in detail (outstanding, report 16). Read in detail for this audit: `docs/07`, `docs/12` (relevant parts), `docs/24` (ADR-078 to 084), `docs/33`.

Legend for "Evidence": **DB test** = a passing database test file whose subject matches (from the clean-database run of 487 tests); **Source** = implementation read; **Observed** = seen working in this audit. No journey was verified **end to end through the UI** in this audit, because no reporting week exists (F-022).

| Journey | Implemented (source) | Automated evidence | Observed in audit | Note |
|---|---|---|---|---|
| UJ-01 Annual theme (+ exceptional change) | Yes (`/strategy`, change control) | `strategy`, `strategy_change` | Theme displayed | Change flow not run |
| UJ-02 Objective, KRs, Sub-KRs, activate | Yes | `strategy`, `strategy_import` | Q4 created; activation checklist shown | Activation not run (needs owner content) |
| UJ-03 Weekly report, SMART, submit | Yes | `reporting`, `scoring_*` | No | Blocked: no week |
| UJ-04 Delete goal before lock | Yes (soft delete) | `operations` | No | |
| UJ-05 Edit after lock rejected | Yes (DB guard) | `reporting`, `security` | No | |
| UJ-06 Execute tasks | Yes | `scoring_integrity` | No | |
| UJ-07 Final lock | Yes (job) | `scoring_integrity`, `last_week`, `lock_schedule` | No | Scheduler not run |
| UJ-08 Non-submission | Yes | `scoring_integrity`, `last_week` | No | |
| UJ-09 Presentation | Yes (`/presentation`) | partial | Page renders | |
| UJ-10 Integrity correction | Yes | `scoring_integrity` | No | |
| UJ-11 HR attendance | Yes | `attendance`, `session_correction` | Page renders | 5 DB tests fail only on non-clean data |
| UJ-12/13 Violation, payment | Yes | `finance`, `violation_reopen`, `ledger_reversal` | Page renders | |
| UJ-14/15/16 Disbursement | Yes (separation of duties in DB) | `finance` | Page renders | |
| UJ-17 Executive review | Yes | `reports`, `branding_dashboard` | Dashboard renders | Role not exercised |
| UJ-18 Quarter rollover | Yes (`roll_quarters`) | `strategy`, `lock_schedule` | No | |

## Acceptance criteria
82 IDs in `docs/20`; **13** are cited by ID in any test (`src` or `tests`). 71 are not cited. This is a *traceability* gap, not proof of missing coverage: many of the 39 database test files clearly cover the topics (e.g. `scoring_*`, `finance`, `rls_cost`), but the register cannot demonstrate it. Uncited by prefix: AC-SC 12, AC-INT 12, AC-WR 9, AC-FIN 8, AC-ATT 7, AC-STR 4, AC-HIST 4, AC-RBAC 3, AC-OPS 3, AC-GAP 3, AC-SEC 2, AC-CFG 2 (F-019). Recommended: tag tests with the AC IDs they prove, then generate a matrix in CI.

## Gaps and contradictions found
- **Contradiction:** `docs/33` said phases D–F "not started" while code existed; `IMPLEMENTATION_COMPLETE.md` and `docs/38` claimed completion that did not hold (F-006).
- **Unspecified behaviour built:** report rejection (ADR-083) and the quote approval workflow (ADR-084) are not in the requirements (F-009). `docs/12` records for attendance amendments that a mandatory reviewer comment is "not yet approved": a precedent for not inventing such rules.
- **Open owner decisions still unanswered:** gap-plan C4 (ISO week numbering of the history sheet) and C8 (mapping of Manager/Member/Viewer roles).
- **Missing requirement candidates (recommend adding):** a requirement that tests must never run against the working database (F-001); an evidence-access requirement per entity type tied to the RLS policy (F-002); deletion of users must be audited with a reason (F-007).

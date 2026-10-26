# 04 — Business logic audit

Scope covered: scoring, penalty, quarterly aggregation, review/rejection, quote workflow, unit hierarchy, evidence access, user deletion. Other rules (locks, attendance, fund, change control) were **not re-derived**; their evidence is the passing database tests only.

| Rule | Authority | Implementation | Evidence | Verdict |
|---|---|---|---|---|
| Weekly base = done goals ÷ total goals × 100 | `docs/07` §3 | `calc_base_score` (SQL), `calcBaseScore` (TS) | `scoring_*`, `scoring_edges`, unit tests | Matches |
| Combined penalty = sum of rates, applied once, floor 0, round 2 | `docs/07` §7 | `calc_final_score`, `calcFinalScore` (`ROUND_HALF_UP`, `max(0,…)`) | unit and DB tests, spec worked examples | Matches |
| Quarterly score: fixed denominator, holiday weeks excluded, N/A when none eligible | `docs/07`, ADR-081 | `calculate_quarterly_score` | `scoring_integrity`, `last_week` | Matches the documented behaviour (read, not re-derived) |
| Submitted-unreviewed report keeps score, quarter stays PROVISIONAL | ADR-081 | `calculate_quarterly_score` | DB test cited in ADR | Matches. **Preserved by rejection** (below) |
| Report rejection | **None** | `reject_weekly_report` (migrations `…0002/…0003`) | `report_review.test.ts` (4 tests, clean DB) | Invented rule (F-009). Consistent with ADR-081 because status stays `NOT_REVIEWED` |
| Quote: draft→submitted→approved→published→archived; approver ≠ recorder/submitter | **None** | `quote_step`, `submit/approve/publish/archive_quote`, guard trigger | `quote_workflow.test.ts` (3 tests) | Invented rule (F-009). One published quote per week is inherent in the existing unique key; a week whose quote is archived can never get another (documented limitation) |
| Unit hierarchy: no cycles, parent exists | gap plan D | trigger `check_unit_hierarchy_cycle`; `create/update_business_unit` | `unit_hierarchy.test.ts` (3 tests) | Correct after repair. **Not specified:** may a Business Unit sit under a Department? (it can; UI nests it under its parent regardless of type and hides it from its own section) |
| Evidence read access by entity type and permission | `read_evidence` RLS policy | now enforced via caller's session | `evidence.test.ts` (7, DB); routes unexercised | Corrected (F-002) |
| User deletion is audited with a reason | "high-risk transitions auditable" (AGENTS.md) | `delete_user` + route | none | **Gap** (F-007) |

## Boundary and concurrency
- Rounding: both implementations use half-up at two decimals with decimal arithmetic; spec examples (3×0.9=2.70) covered by tests.
- Concurrent approvals, double submissions and idempotency keys exist for money, Skip-OKR and amendments (`tests/concurrency`, **not run** in this audit; running it resets the database, see F-001).
- Quote publish/approve use `for update` row locks in `quote_step`; a double approve is rejected by the status check.
- Review is idempotent (second review returns without a second audit row).

## Unresolved business decisions
1. Keep or remove report rejection and the quote workflow (F-009).
2. Whether an archived quote may be replaced for the same week.
3. Whether units of one type may be children of the other type.
4. Gap plan C4 (week numbering) and C8 (role mapping).
5. Whether Q4 2026 should copy Q3's objective or have new wording (owner pending).

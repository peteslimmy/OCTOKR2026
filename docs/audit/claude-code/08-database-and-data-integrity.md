# 08 — Database and data integrity

Method: read-only SQL against the live local database (`audit.sql` queries listed below), migration reading, the clean-database test run (487 passing). No data was changed by the audit.

## Shape
49 migrations (applied from scratch cleanly), 90 public tables, 78 RLS policies, 50 triggers, 300 functions (229 security definer). Currency NGN with exact numeric; timezone fixed to Africa/Lagos in the organisation row; audit and ledger rows protected by `forbid_mutation` triggers; soft-delete exceptions are explicit.

## Executed checks and results
| Check | Result |
|---|---|
| Public tables without RLS | 8: `email_event_types, employee_kpi_snapshots, employee_kpis, financial_projections, kr_target_snapshots, kr_targets, notification_settings, rate_limit_hits`. No privileges granted to `anon`/`authenticated` on any of them → not reachable from the browser (F-012) |
| RLS enabled, no policy | 11 tables (`email_otp_challenges, email_outbox, integrations, mfa_*`, import batches, webhook/job tables…): deny-by-default for users; reachable only through definer functions or the service role. Intended |
| INSERT/UPDATE/DELETE/TRUNCATE for `anon`/`authenticated` on public tables | none |
| `anon` privileges | SELECT on 4 branding/site tables only (public landing page) |
| Functions executable by `anon` | none |
| Definer functions without pinned `search_path` | 0 |
| Definer functions executable by signed-in users | 22; 21 check the caller; `read_payment_is_reversed` does not (F-015) |
| Service-only definer functions with no visible permission check | 65 listed (job, auth-event, import and email helpers). They are not callable by users; each is invoked by trusted server code. Not individually reviewed |

## Integrity observations
- **Evidence:** soft delete only; `deleted_at/deleted_by`; RLS read policy by entity type; a row could previously exist without its file or vice versa (fixed order in upload, F-003).
- **Weekly reports:** final-locked rows reject every change except the review columns (guard trigger rewritten in `…0002`; tested for the negative case).
- **Quotes:** one per reporting week (unique key); content immutable; only the four legal status steps (trigger).
- **Unit hierarchy:** cycle trigger plus `on delete set null` on the parent; a deleted parent silently orphans its children to top level (acceptable but undocumented).
- **Current data:** 18 units, 25 employees (24 loaded plus the Super Admin), 11 role grants, 72 audit rows; orphan and duplicate scans were **not run**.
- **Migration risk (F-006):** `20261030000001_unit_hierarchy.sql` ended by dropping the functions it created. It is applied in every environment, so the repair is a *new* migration (`…0004`) rather than an edit — correct practice, but any fresh environment runs the broken-then-repaired sequence.

## Not covered
Query plans and indexes under load, retention jobs (`tests/db/retention` passes only), backup/restore drill, concurrent-write behaviour beyond the existing tests, storage-bucket policies in `storage.objects` beyond reading the evidence one, orphan/duplicate data scans.

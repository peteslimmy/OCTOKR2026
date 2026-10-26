# 16 — Coverage and continuation record

Status model: NOT STARTED → DISCOVERED → INSPECTED → TESTED → VERIFIED; BLOCKED and N/A are separate. "VERIFIED" requires evidence appropriate to the item; very little reached it.

| Area | Status | Basis | Outstanding |
|---|---|---|---|
| Repository, instructions, stack | VERIFIED | `AGENTS.md`, git state, manifests | none |
| Requirements located | INSPECTED | 43 docs + 2 sibling folders located; 5 docs read in depth | read `../spec`, `../spec2`, `docs/04,06,08,11,15,16,18,19` |
| Pages (42) | 33 TESTED (loaded, no error); 9 DISCOVERED | browser | `/weekly*`, session/report detail pages need data |
| Components | INSPECTED (shared primitives, quote/review/units/contribution) | source | ~380 other files not read |
| API routes (169) | DISCOVERED (all, scripted); INSPECTED ~25; TESTED 5 (unauthenticated probes) | script + source | authorised/negative tests per role |
| Database objects | INSPECTED via catalogue queries (RLS, grants, definers, search_path) | live read-only SQL | orphan/duplicate scans; index/plan review; storage policies |
| Business rules | scoring VERIFIED against spec (source + tests); review/quote/hierarchy TESTED (DB); others INSPECTED via test names only | | locks, attendance, fund, change control not re-derived |
| Workflows | add/delete unit VERIFIED live; all others BLOCKED (no reporting week) | | Phase 2 of the roadmap |
| Security | INSPECTED (auth, handler, evidence, headers, privileges) | | role matrix, BU isolation, imports, webhooks, SSRF, logs |
| Performance | dev-mode timings for 3 pages only | | production build, load, query plans |
| Tests | typecheck, lint, 220 unit, 487 clean-DB run executed | | browser, API, concurrency suites |
| Accessibility | probe of 2 pages | | contrast, keyboard, screen reader, mobile |
| Infrastructure | INSPECTED files and containers | | hosted environment, restore drill, CI run |

## Continuation point
Resume at **Phase 2 of report 14** once (a) a test database exists (roadmap 0.3) and (b) the owner provides Q4 2026 strategy. Then, in order: create accounts for BU Lead, HR, Finance, Presenter, Executive and Admin on the test copy; run UJ-03 → UJ-18 end to end recording UI, API, database and audit evidence; run the role-by-route authorisation matrix over the 169 routes (`routes.json` from this audit's script is a ready starting list); read the remaining requirement documents; then re-run lint, smoke test and browser suite.

## Artefacts of this audit
Route inventory (JSON), database queries (`audit.sql`) and outputs, lint JSON — saved in `artefacts/` (route inventory JSON and script, database audit queries and their 2026-10-26 output).

## Honest statement of completeness
This was a first pass. It is **not** a complete audit of the application. Findings are real where marked with their evidence; the absence of further findings in unexamined areas means nothing.

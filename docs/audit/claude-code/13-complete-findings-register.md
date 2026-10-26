# 13 — Complete findings register

Audit date: 2026-10-26. Auditor: Claude Code (Sonnet 5.5). Audited state: the working tree of `4core-okr` as found, including 103 uncommitted changes from earlier sessions. Mode: audit-only (see report 15 for the one disclosure about fixes made earlier in the same session, before the audit instruction).

Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO. Confidence: High (observed or read in source and consistent), Medium (source reading, not exercised), Low (plausible). Verification: **Observed** (seen running), **Executed** (a command/test produced it), **Source** (read in code only), **Inferred**.

"Status" says what the working tree does about it today. Items marked *remediated in working tree* were fixed earlier in this session, before the audit instruction; they are uncommitted and have **no regression test yet**.

| ID | Sev | Conf | Verif | Status | Title |
|---|---|---|---|---|---|
| F-001 | HIGH | High | Observed + Executed | Remediated 2026-10-26 (uncommitted) | Test scripts erase the real local database |
| F-002 | HIGH | High | Source (+ Executed after fix) | Remediated, untested | Evidence downloads bypassed row-level security |
| F-003 | MEDIUM | High | Source | Remediated, untested | Evidence upload wrote to storage before the permission check |
| F-004 | MEDIUM | High | Observed | Remediated, untested | Units page crashed (server page called a client-only function) |
| F-005 | MEDIUM | High | Executed | Remediated 2026-10-26 (uncommitted) | `npm run lint` fails, and CI runs lint |
| F-006 | MEDIUM | High | Source + Observed | Remediated 2026-10-26 (uncommitted) | Earlier "complete" status documents overstated the state of the build |
| F-007 | MEDIUM | High | Source | Remediated 2026-10-26 (uncommitted) | User deletion records no reason and swallows identity-deletion failures |
| F-008 | MEDIUM | Medium | Source | Remediated 2026-10-26 (uncommitted) | Evidence file type is trusted from the client; no content check |
| F-009 | MEDIUM | High | Source | Remediated 2026-10-26 (uncommitted) (decision needed) | Quote workflow and report rejection are AI-designed, not specified |
| F-010 | LOW | High | Source | Remediated 2026-10-26 (uncommitted) | Dev scripts write strategy through the service role and bypass the quarter lock |
| F-011 | LOW | Medium | Source | Remediated 2026-10-26 (uncommitted) | Per-IP rate limit keys on a client-supplied header |
| F-012 | LOW | High | Executed | Open | Eight tables have no row-level security (not exposed today) |
| F-013 | LOW | High | Source | Open | Dead duplicate `lib/auth/rate-limit.ts` in the project root |
| F-014 | LOW | High | Observed | Open | Dead, weaker CSP in `next.config.ts` (only the proxy CSP is sent) |
| F-015 | LOW | High | Source | Open | `read_payment_is_reversed` is a security-definer function with no caller check |
| F-016 | LOW | High | Executed | Open | Three moderate dependency advisories |
| F-017 | LOW | High | Source | Open | `kr-execution` route bypasses the shared handler's error and permission conventions |
| F-018 | LOW | High | Observed | Open | Repeated identical action buttons have no row context for assistive technology |
| F-019 | LOW | Medium | Executed | Open | Acceptance criteria are weakly traceable to tests; the full browser suite is not run regularly |
| F-020 | INFO | High | Observed | Remediated | Metrics endpoint was public and recorded nothing; tracing absent |
| F-021 | INFO | High | Source | Accepted | Scoring exists twice (TypeScript and SQL), kept in step by tests |
| F-023 | LOW | High | Source | Open | The evidence HTTP tests assert almost nothing |
| F-022 | INFO | High | Observed | Operational | No active quarter: the system cannot accept weekly reports until Q4 2026 strategy exists |

No CRITICAL findings were substantiated. The absence of a critical finding is not proof there is none: see report 16 for what was not examined.

---

## F-001 — Test scripts erase the real local database (HIGH)
- **Remediation (2026-10-26, after the audit pass, at the owner's request):** tests now run on a second, separate Supabase stack (`scripts/test-stack.mjs`, containers `supabase_*_4core-okr-test`, ports 54421/54422, generated into `.test-stack/`). `tests/guard.ts` refuses any database, API, concurrency or browser test unless the run came through that stack, the ports are the test ports, and the database carries the `OKR_TEST_DATABASE` marker (CI is accepted on `CI=true`). `npm run db:reset` now needs `--erase-real-data` and backs up first; `org:restore` backs up first; `dev:seed` and `dev:history` refuse on the real database; `npm run db:backup` added. **Verified:** the guard refused four unsafe invocations; `test:db` (267 tests) and `test:concurrency` (5) passed on the test stack; the real database's row counts were identical before and after (18 units, 25 employees, 8 quarters, 72 audit rows) and the concurrency leftovers appeared only in the test database. Browser (`test:e2e`) and `test:api:serial` flows were guarded and refuse correctly but were **not run to completion**.
- **Category:** data integrity / developer tooling. **Affected:** `package.json` (`test:db`, `test:concurrency`, `test:e2e`, `db:reset`), `tests/db/helpers.ts:4`, `tests/concurrency/concurrency.test.ts`, `scripts/dev-seed.ts`.
- **Expected:** running tests must never be able to destroy records a person entered.
- **Observed:** each of those scripts begins with `supabase db reset`, which drops and rebuilds the single local database. `tests/db/helpers.ts` defaults `DB_URL` to the same local database (`127.0.0.1:54322`) with no guard. On 2026-10-24 about 14:43 UTC a `test:concurrency` run left only `@conc.local` users and a `CONC` unit; `audit_logs` begins at that moment. The Super Admin, 18 units, users and strategy the owner had entered were gone. The README itself documents "after a test run has replaced it with sample data".
- **Root cause:** one local database serves as both the owner's working data and the test target; no environment separation or guard.
- **Impact:** actual loss of owner records (only `scripts/data/organisation.json` survives as a rebuild source). Anything entered after that file was made is unrecoverable.
- **Recommendation:** run tests against a separate database (second Supabase project/port or a `postgres_test` database); refuse to run when `DB_URL`/project does not carry an explicit test marker; rename the destructive scripts so they cannot be run by accident; add a one-command backup before any reset; document in the README.
- **Regression tests:** a test that fails fast when pointed at a non-test database. **Acceptance:** running the full test suite leaves a seeded "real" database byte-identical.

## F-002 — Evidence downloads bypassed row-level security (HIGH)
- **Affected:** `src/app/api/v1/evidence/download/route.ts`, `src/app/api/v1/evidence/[id]/route.ts`.
- **Expected:** a person sees only evidence their permissions allow (`read_evidence` policy: by entity type and permission).
- **Found:** both routes looked up and downloaded with `adminClient()` (service role). The download route's comment said RLS protected it; it did not. Any signed-in user with step-up who knew a file path could download it. The `[id]` route used a hand-written role-name list (all BU Leads for any violation) that disagreed with the database policy.
- **Status:** both routes now check access with the caller's own client first (404 for both "missing" and "not permitted"), sanitise the download name, and only then use the service role to read/sign. Unauthenticated requests return 401 (verified). The authorised/forbidden paths were **not exercised with files and roles**.
- **Regression tests needed:** a user without `finance.ledger.view` cannot fetch LEDGER evidence by path or id; a permitted user can; filename with quotes/newlines is neutralised.

## F-003 — Evidence upload wrote to storage before the permission check (MEDIUM)
- **Affected:** `src/app/api/v1/evidence/route.ts`. The file was uploaded, then `ops_upsert_evidence_file` enforced `evidence.manage`. Anyone with a step-up session could place files in the private bucket. Now the record is created first (enforcing the permission) and removed if the upload fails; the path suffix uses `randomUUID`. The DB tests for evidence pass (7); the route itself is untested.

## F-004 — Units page crashed (MEDIUM)
- **Observed:** `/admin/units` returned 500: "Attempted to call buttonClass() from the server but buttonClass is on the client". Cause: an earlier session added `"use client"` to `src/components/ui/primitives.tsx` while merging Radix components into it. **Status:** Radix components moved to `primitives-radix.tsx` (client); the rest is server-safe; all ~30 screens then rendered. **Systemic cause:** no automated page-render smoke test runs on every change (see F-019). **Test needed:** a smoke test that renders every `(app)` page as an admin.

## F-005 — Lint fails and CI runs lint (MEDIUM)
- **Remediation (2026-10-26):** typed `ui/table.tsx` with the library's own types, replaced `require("os")` with an import, excluded `docs/audit` and `.test-stack` from lint. `eslint .`: 0 errors, 44 warnings (unused variables remain); `npm run lint` exits 0.
- **Executed:** `eslint .` → 9 errors, 41 warnings. Errors: 8 `no-explicit-any` in `src/components/ui/table.tsx`; 1 `require()` in `src/lib/api/handler.ts:17`. `.github/workflows/ci.yml` runs `npm run lint`, so CI would fail. Typecheck passes. Fix is small; not applied (audit mode).

## F-006 — Earlier status documents overstated the build (MEDIUM)
- **Evidence:** `IMPLEMENTATION_COMPLETE.md`, root `MEMORY.md`, `docs/38-P1-STATUS-SUMMARY.md` report features as complete that were not. Found and (during this session) repaired: report review comments/rejection (UI sent fields nothing stored); unit hierarchy (migration dropped the functions it created, so unit creation through the API failed); quote workflow (routes called three functions that did not exist; table could not change status); Sub-KR card (wrong response shape, could never render); metrics endpoint (public, nothing recorded); `lib/auth/rate-limit.ts` presented as the rate limiter while the live one pre-existed in `src/`.
- **Impact:** decisions made on false "done" claims. **Recommendation:** treat those files as unreliable; delete or replace with the evidence-based state; require a test or screenshot as evidence for "complete".

## F-007 — User deletion: no reason, silent partial failure (MEDIUM)
- **Remediation (2026-10-26):** migration `20261030000006` makes the reason mandatory and stores it on the `USER_DELETED` audit entry (the screens already asked for it and the routes dropped it); both routes now pass it and report an identity-deletion failure instead of success. New `tests/db/user_deletion.test.ts` (3 tests): reason recorded; blank/missing/oversize refused; permission, self-deletion and last Super Admin refused. Route-level behaviour of the identity failure was not exercised.
- `src/app/api/v1/users/bulk-delete/route.ts` accepts `reason` and never uses it; single delete takes none (unlike unit deletion, which requires an audited reason). If the identity deletion fails the error is only logged and the call reports success, leaving a sign-in identity with no application user. **Test needed:** deletion records actor and reason in `audit_logs`; identity failure surfaces as a partial failure.

## F-008 — Evidence file type trusted from the client (MEDIUM)
- **Remediation (2026-10-26):** `src/lib/validators/evidence-signature.ts` checks the file's first bytes against its claimed type (PDF, PNG, JPEG, GIF, WebP, OLE .doc/.xls, zip-based .docx/.xlsx, UTF-8 text with no NUL bytes) and the upload route returns 422 on a mismatch. 4 unit tests. No malware scanning is added. The route itself was not exercised with real uploads (needs the storage service, which the test stack excludes).
- `UploadEvidenceBodySchema` allows 10 MIME types, but the type and checksum both come from the client, and the server compares them to each other only. A non-PDF can be stored as `application/pdf`. Mitigations present: private bucket, `attachment` disposition, `nosniff`, 50 MiB cap, SHA-256 integrity. Missing: magic-byte check (the site-image uploader already does this) and any malware scanning.

## F-009 — Quote workflow and report rejection are not in the specification (MEDIUM, decision needed)
- Built this session as ADR-083/ADR-084 on the strength of a gap-plan line ("only if the owner still uses quotes"). Both are the smallest design consistent with ADR-081, but they are invented behaviour. **Decision needed:** keep, change, or remove. Tests: `tests/db/quote_workflow.test.ts`, `tests/db/report_review.test.ts` (pass on a clean database).

## F-010 — Strategy seeding scripts bypass the quarter lock (LOW)
- `scripts/direct-strategy-seed.ts` ("bypassing quarter_is_locked check") and `scripts/populate-strategy-2025-2026.ts` are untracked and write through the service role. They undermine the documented rule that locked quarters are historical records. Keep out of the repo or guard them behind an explicit flag.

## F-011 — Per-IP rate limit trusts `x-forwarded-for` (LOW)
- `src/app/api/v1/auth/login/route.ts` keys on the header as received. Behind a proxy that overwrites it this is fine; otherwise a client can rotate values. The per-account limit (10/min) remains. Document the proxy requirement or use the platform-provided client IP.

## F-012 — Eight tables without RLS (LOW)
- **Remediation (2026-10-26):** migration `20261030000007` enables RLS on all eight. New `tests/db/rls_invariants.test.ts` fails if any public table lacks RLS, if `anon`/`authenticated` hold any write privilege, if `anon` can call any function, or if a definer function leaves `search_path` unpinned. 274 database tests pass on the test stack.
- `email_event_types, employee_kpi_snapshots, employee_kpis, financial_projections, kr_target_snapshots, kr_targets, notification_settings, rate_limit_hits`. Executed query: none of them grants any privilege to `anon` or `authenticated`, so they are unreachable from the browser. The KPI and financial tables are new and sensitive; enabling RLS with an explicit policy would keep them safe if a grant is added later.

## F-013 — Dead duplicate rate limiter in project root (LOW)
- `lib/auth/rate-limit.ts` (outside `src/`, imported by nothing; `@/*` maps to `src/*`) is a weaker in-memory copy marked `"use server"` with an unbounded `setInterval`. It does no harm today and misleads readers. Delete.

## F-014 — Dead weak CSP in `next.config.ts` (LOW)
- **Remediation (2026-10-26):** removed; one CSP header (the nonce-based one from `proxy.ts`) is sent, confirmed by response headers.
- Declares `script-src 'unsafe-inline' https://cdn.tailwindcss.com`. Observed response headers carry only the strict nonce-based policy from `src/proxy.ts`. Remove the static one so nobody relies on it. Note `style-src 'unsafe-inline'` is deliberate (documented).

## F-015 — `read_payment_is_reversed` (LOW)
- Security definer, executable by every signed-in user, no caller check; returns whether a given payment id was reversed. Needs a valid id; leak is a single boolean. Add a permission check or make it `security invoker`.

## F-016 — Dependency advisories (LOW)
- `npm audit --omit=dev`: `nodemailer` (2 moderate, fix available), `uuid` via `exceljs` (moderate; suggested fix is a major change). No high/critical. CI "fails on high and critical", so these do not gate.

## F-017 — `kr-execution` route conventions (LOW)
- **Remediation (2026-10-26):** now throws `fail()` for 403/404 so errors use the standard envelope and correlation id. No raw `new Response(JSON.stringify(...))` remains under `src/app/api`.
- Returns hand-built `new Response(JSON.stringify({error}))` for 403/404 and checks `can()` inline instead of throwing through `api()`, so errors lack the standard envelope and correlation id.

## F-018 — Action buttons without context (LOW)
- **Remediation (2026-10-26):** the Units page Delete and weekly-reporting buttons and the People page Delete button now carry the unit or person in their accessible name. Not re-probed with a screen reader.
- Units page: 18 "Delete" buttons and repeated "Stop weekly reporting"/"Require weekly reporting" with identical accessible names (WCAG 2.4.6, 2.5.3 risk). Add `aria-label="Delete <unit>"`.

## F-019 — Traceability and browser-suite health (LOW)
- Only 13 of the 82 acceptance-criteria IDs in `docs/20` are cited in any test (coverage may exist uncited; the register cannot prove it). The last recorded full browser run (`e2e-run.log`, 16 Oct): 138 passed, 17 did not run, whole run timed out after 1 h. Not re-run in this audit.

## F-020 — Metrics and tracing (INFO, remediated)
- Metrics code existed but nothing recorded requests and `/api/metrics` answered publicly. Now: requests recorded in the shared handler; token required in production (`METRICS_TOKEN`); OpenTelemetry tracing starts only when an OTLP endpoint is set. Verified against a stand-in collector, not a real one.

## F-021 — Scoring implemented twice (INFO)
- `src/lib/domain/scoring.ts` and the SQL functions implement the same rules (checked against `docs/07`: base, combined penalty applied once, floor 0, two-decimal rounding, fixed denominator). Unit and database tests mirror each other. Keep the tests; any rule change must change both.

## F-022 — No active quarter (INFO / operational)
- All stored quarters are locked; Q4 2026 now exists (planned) without an objective. Until it is completed and activated no reporting weeks exist and the dashboards show "no reporting weeks". The system correctly refuses to activate an incomplete quarter.

## F-023 — Evidence HTTP tests assert almost nothing (LOW)
- `tests/api/evidence.api.test.ts` sends a flat object where the route expects multipart `file` + `metadata`, and its success case accepts either 200 or 422, so it passes whether or not an upload works. It cannot catch F-002/F-003/F-008. Needs rewriting against the real multipart contract, with a storage-enabled test stack, and with allow/deny cases per role.

## Findings deliberately not changed in this pass
- **F-015** (`read_payment_is_reversed`): the function is called from the violations read model running as the user; a caller check strict enough to matter could hide reversal status from legitimate viewers. It needs a decision on who may see payment reversals; left open.
- **F-016** (advisories): fixing needs a dependency install/upgrade (`nodemailer` fix available; `uuid` via `exceljs` needs a major change), which needs approval.
- **F-004 smoke test, F-011, F-013, F-010, F-006 files, F-019, F-009:** not addressed (the last needs the owner; F-013/F-010/F-006 involve deleting files the owner asked to keep for now).

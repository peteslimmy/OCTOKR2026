# 01 — Application inventory and architecture

Method: filesystem inventory, a script over every `route.ts`, read-only queries against the live local database. "Documented" architecture is from `AGENTS.md` and `docs/`; "actual" is what was found.

## Stack
Next.js 16.4 (Turbopack, App Router, React 19.3), TypeScript 5, Supabase (PostgreSQL 17, GoTrue auth, Storage), Zod 4, decimal.js, pino, vitest 5 and Playwright for tests, OpenTelemetry and prom-client for observability. 44 runtime and 26 dev dependencies. Local database in Docker (`supabase_db_4core-okr`, port 54322).

## Size
| Item | Count |
|---|---|
| TypeScript/TSX files under `src/` | 399 |
| Pages (`page.tsx`) | 42 |
| API routes (`route.ts`) | 169 |
| SQL migrations | 49 (`20261014000001` … `20261030000005`) |
| Public tables / policies / triggers | 90 / 78 / 50 |
| Functions / of which security definer | 300 / 229 |
| Spec documents in `docs/` | 43 (≈7,700 lines) |
| Test files | 27 unit (`src/**/__tests__`), 39 database, 1 concurrency, 21 API, 24 browser (Playwright) |

## Actual architecture
- **Browser:** React client components for forms and interactive views. The browser only talks to this origin (`connect-src 'self'`); all data goes through `/api/v1/*` or server components.
- **Server (Next.js):** `src/proxy.ts` refreshes the session cookie, gates pages (a convenience redirect only, ADR-035) and sets a nonce-based CSP. API routes are wrapped by `api()` in `src/lib/api/handler.ts`, which authenticates, optionally demands a recent second factor (`stepUp`, 39 routes), validates the body with Zod, applies a same-origin check for mutating calls, records metrics, and maps errors to a standard envelope with a correlation id.
- **Authority for rules:** PostgreSQL. Almost every mutation is a `SECURITY DEFINER` function that calls `require_permission(actor, code)`, writes an audit row (`write_audit`) and enforces state rules; immutable tables are protected by triggers. TypeScript duplicates only the pure scoring maths (F-021) and UI gating.
- **Two database clients:** `userClient()` (the caller's session, subject to RLS) and `adminClient()` (service role). 16 routes use the service role; the evidence routes misused it (F-002).
- **Background work:** `/api/internal/jobs/run` (shared secret, constant-time compare, rotation support) runs scheduled jobs: finalisation at lock times, reminders, email and webhook outboxes, retention.
- **Observability:** pino logs, `/api/metrics` (token in production), `/api/health` and `/api/internal/health`; tracing optional via `src/instrumentation.ts`.

## API surface (169 routes)
Largest groups: strategy (16), auth (15), weekly-reports (9), users (8), governance-sessions (7), reports (7), disbursement-requests (5), quotes (5), reporting-weeks (5). 165 routes use `api()`; the 4 that do not are `/api/health`, `/api/internal/health`, `/api/internal/jobs/run`, `/api/metrics` (each has its own secret/token check). Two routes are public (`auth/login`, `auth/password/forgot`).

## Dependency chain (example, verified)
Requirement "weekly report is reviewed" → `weekly/[reportId]/page.tsx` + `report-editor.tsx` → `POST /api/v1/weekly-reports/{id}/review` → `review_weekly_report` / `reject_weekly_report` (definer, `weekly_report.review`) → `weekly_reports` columns + `audit_logs` + `notifications` → `tests/db/report_review.test.ts`.

## Documented vs actual
- Docs say "no business rules in presentation components"; true for scoring, locks and money. UI gating by permission exists but is advisory.
- `docs/33` said phases D–F were not started; they were partially built and broken (F-006). It now says built.
- `IMPLEMENTATION_COMPLETE.md`/`docs/38` describe a state the code did not have (F-006).
- Competing sources of truth found: scoring (TS and SQL, F-021), evidence access (role-name list in a route vs RLS policy, F-002), rate limiter (stray root copy vs `src`, F-013), CSP (proxy vs `next.config.ts`, F-014).

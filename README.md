# 4CORE-OKR

Strategic execution, weekly BU accountability and governance platform. The authoritative requirements live in
[`docs/`](docs/) (start with [`docs/00-SOURCE-OF-TRUTH.md`](docs/00-SOURCE-OF-TRUTH.md)); engineering contract in
[`AGENTS.md`](AGENTS.md). Rebuild decisions are ADR-034 onward in [`docs/24-DECISIONS.md`](docs/24-DECISIONS.md);
assumptions and open questions are in [`docs/25-IMPLEMENTATION-NOTES.md`](docs/25-IMPLEMENTATION-NOTES.md).

## Status

**Milestone 1 — core OKR flow: implemented.** Strategy, reporting calendar, weekly reports, SMART goals, tasks, locks, scoring,
integrity corrections, Organization Holiday, quarterly scores, presenter mode, dashboards, audit, notifications, administration.

**Milestone 2 — governance and finance: implemented.** PRESENT-by-default attendance rosters, exception toggles, immutable finalisation,
atomic **Skip OKR for this week** (VIRTUAL_PRESENT, BU Lead notification, mandatory manual summaries), independently approved
attendance amendments, weekly quote, violation types and violations, payments with atomic ledger credit, the append-only violation
fund ledger, the disbursement workflow (request → Finance review → approve/reject → separate release) with reconciliation.

**Milestone 3a — late-report score amendment: implemented** (ADR-050): an authorised, reviewed late report supersedes a missing-report zero through new versioned weekly and quarterly snapshots; originals, compliance history and the locked quarter are untouched. UI: Governance → Late reports.

**Milestone 3b — holiday amendment and reversal: implemented** (ADR-051): Administration → Holiday amendments declares a locked/reported week a holiday or reverses one, creating new versioned quarterly scores.

**Milestone 4 — authentication hardening: implemented** (ADR-052): TOTP second factor (mandatory for Super Admin, Admin, Finance), step-up for high-risk actions, forgot/reset/change password, administrator authenticator reset, and a nonce-based Content-Security-Policy.

**Milestone 5 — end-to-end and accessibility gate: implemented.** 25 Playwright tests (sign-in and MFA, the weekly lifecycle with real locks, late-report and holiday amendments, axe on every screen per role, mobile overflow) run in CI after the other checks.

**Milestone 6 — Reports: implemented** (ADR-053): `/reports` with 13 reports over the real data (performance, trends, ranking with movement, compliance, OKR health, governance backlog, corrections, holidays, fund actuals, data quality, quarter-end projection), a metrics catalogue, evidence-linked insights, a question router, a report builder, saved views, checksummed official snapshots and CSV/Excel/PDF exports. Blocked reports (employee KPIs, KR targets, financial projections) are listed with what would unblock them. Owner decisions 1–9 of 14 Oct 2026 are recorded in ADR-054; most are not yet built.

**Display, hint, landing and import (ADR-055 to 057): implemented.** Percentages show one decimal place and every week reads `Week 14, 30 Mar – 5 Apr 2026` from one formatter; the presenter screen has a read-only **Last Week — Outstanding Tasks** hint; `/` is a public landing page and sign-in has been redesigned with every auth behaviour kept; dashboards use metric cards with definitions and drill-downs; **Administration → Import employees** is a five-step wizard (file, column match, per-row explanations with inline fixes, conflict policy, atomic commit with results and history). Employees and Business Units can be imported, and a Super Admin can load **historical weekly reports** (recomputed, rehearsed first, ADR-077).

**Closed-week control, ledger corrections, recovery and email (ADR-058 to 062): implemented.** Amending a closed week needs a request and a second Admin; a wrong ledger entry is cancelled by a compensating entry through request, approval and separate posting (with a Super Admin emergency path); a lost authenticator is recovered with one-time recovery codes (with a documented break-glass procedure, docs/26); Business Unit Leads get frequency-limited reminders and time-sensitive events can be emailed through an outbox with retries. The email provider is not chosen: configure `EMAIL_TRANSPORT=smtp` (see `.env.example`) or use the file transport in development. Business Units can be imported with the same wizard as employees; ranking tables filter and open a read-only drawer.

**Closing pass and Phase 4 programme (ADR-063 to 072): implemented.** Session-outcome correction (request, approve, execute, with an emergency path), strategy change control in an active quarter, "still waiting" notifications, reopening a violation when its payment is reversed, an audit row for every refused request, and row-level security that is cheap to evaluate. Then, from the enhancement review (`docs/30-ENHANCEMENT-REVIEW.md`): one approval engine for governance settings (violation types and fines, penalty rate, reminders, Business Unit reporting, **roles**, **lock times**, retention), roles that are created, changed and deleted in the application (no role name in code), a versioned lock schedule that never alters a generated week, a shared sign-in limiter, health endpoints and a scheduler heartbeat, retention of transient data, a paged and exportable audit log, a table-driven permission-matrix test, and dependency and secret scans in CI.

**Deployment artefacts (ADR-073):** a container image (`Dockerfile`), a single-host compose file with a minute-by-minute scheduler (`deploy/`), an email go-live check (`npm run email:check`), the administrator guide (`docs/31`) and the go-live runbook (`docs/32`). Tested locally; nothing has been deployed.

**Integrations module (ADR-076): implemented.** Administration → Integrations configures email (SMTP) and signed outbound webhooks in the application: forms drawn from data, secrets encrypted before storage and never shown again, changes approved by a Super Admin, a Test button that sends only harmless content, an SMTP integration that carries the application's email, and a webhook outbox with retries. No feature sends data to an AI provider yet.

**Still to do:** choosing hosting and the production email provider, running the CI workflow on GitHub, a restore drill on the real host and a performance baseline on production-sized data. Reports that need data the system does not hold (employee KPIs, key-result targets, financial projections) and historical-data migration are not built. Evidence file storage is implemented (Supabase Storage bucket + `evidence_files` metadata with SHA-256 verification and UI integration across violations and attendance amendments). See `docs/25-IMPLEMENTATION-NOTES.md`, `docs/27-DEPLOYMENT-AND-OPERATIONS.md` and `docs/30-ENHANCEMENT-REVIEW.md`.

## Architecture in one paragraph

Next.js (App Router) + Supabase (PostgreSQL 17 + Auth). Users get **SELECT-only, RLS-filtered** access to tables.
Every mutation is a `SECURITY DEFINER` Postgres function that only `service_role` may execute; the Next.js API verifies
the session JWT, resolves the actor, and passes it explicitly. Each function re-checks permission, BU scope and lifecycle
state against the **database clock** (`app_now()`), so a failed scheduler can never extend a lock, and writes its audit row
in the same transaction. Scores are computed in SQL (exact `numeric`) and mirrored by `decimal.js` for tests.

```
src/lib/domain      pure rules: scoring, WAT calendar, SMART engine, error codes   (unit-tested)
src/lib/api         request handler: auth, CSRF origin check, zod allowlists, correlation ids
src/lib/data        RLS-scoped read models
src/app/api/v1      REST endpoints (12-API-CONTRACT)
src/app/(app)       screens
supabase/migrations schema, RLS, functions, read models
tests/db            DB integration tests (lock boundaries, scoring, RLS, audit immutability)
tests/api           HTTP negative-authorisation tests
```

## Run it locally

Prerequisites: Node 22+, Docker Desktop.

```bash
npm install
npm run db:start          # local Supabase (Postgres, Auth, REST)
npm run dev:seed          # LOCAL ONLY sample org, users and an active quarter
npm run dev               # http://localhost:3000
```

Local sample users (`*@4core.local`, all with the dev-only password `DevPassword!2026`):
`superadmin`, `admin`, `hr`, `finance`, `presenter`, `exec`, `director`, `lead.eng`, `lead.eng2`, `lead.sales`.
`dev:seed` refuses to run against any non-local URL.

`superadmin`, `admin` and `finance` must also pass the authenticator challenge. The seed enrols them and keeps the secrets in the git-ignored `.dev-mfa.json`; print the current code with:

```bash
npm run dev:totp -- admin@4core.local
```

Password-reset emails are not delivered locally (the mail catcher is disabled); `npm run test:api` exercises the full flow by generating the link through the admin API.

### Exercising time-based locks

```bash
npm run dev:clock -- 2026-10-20T18:00:00+01:00   # freeze the DATABASE clock at Tuesday 18:00 WAT
curl -X POST http://localhost:3000/api/internal/jobs/run -H "x-jobs-secret: $JOBS_SECRET"
npm run dev:clock -- off
```

The override is honoured only when the database owner sets `app.environment = 'development'`; the app shows a banner
while it is active. Never set it in production.

## Tests

**Tests never touch your real database.** They run on a second, separate Supabase stack (own containers, own database, ports 54421/54422; the real one is 54321/54322), generated into `.test-stack/` from `supabase/`. Every test entry point checks this first (`tests/guard.ts`) and refuses to run if it is pointed anywhere else; the database must also carry a marker that only the test stack's reset sets. The real database is only ever erased by `npm run db:reset -- --erase-real-data` or `npm run org:restore`, and both take a backup first.

```bash
npm run test:unit         # scoring, WAT boundaries, SMART engine (no database)
npm run test:db           # resets the TEST database, then runs the database tests on it
npm run test:concurrency  # resets the TEST database; multi-connection race tests for money, Skip OKR and amendments
npm run test:e2e          # resets and seeds the TEST database, starts the app on port 3100 and drives it in a real browser (Playwright + axe)
npm run test:api:serial   # every HTTP test file against the test stack (needs a build)
node scripts/test-stack.mjs run -- npm run build   # builds the app into .next-test with the test stack's settings (separate from the dev server's .next)
node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs route-authz   # the generated authorisation sweep over every route (also: evidence-access, read-scope)
npm run test:stack -- status|start|stop|reset      # manage the test stack by hand
node scripts/test-stack.mjs run --reset --seed -- <command>   # run any command against the test stack
npm run db:backup         # backs up the REAL local database to .local/backups/
npm run typecheck && npm run lint
node scripts/scan-secrets.mjs && npm audit --omit=dev --audit-level=high   # what CI's security job runs
```

Sample-data scripts (`dev:seed`, `dev:history`) also refuse to run against the real database. To explore the app with demo data, run it against the test stack. In CI the stack is a throwaway one, so the guard accepts it when `CI=true`.

## Production

1. Provision a Supabase project; apply `supabase/migrations` with the CLI (`supabase db push`).
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `JOBS_SECRET`.
3. Configure the auth server like `supabase/config.toml`: TOTP MFA enabled, public signup disabled, minimum password length 12 with upper/lower/digit, the recovery template (`supabase/templates/recovery.html`, link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`), the password-changed notification, `site_url` set to the public HTTPS origin, and a real SMTP provider (without one, reset emails are not sent).
4. Create the organisation and first SuperAdmin once: `npm run bootstrap` (credentials via environment variables, see `scripts/bootstrap.ts`).
5. Schedule `POST /api/internal/jobs/run` (header `x-jobs-secret`) every minute from a scheduler (e.g. Supabase cron / GitHub Actions / platform cron). It is idempotent. Monitor `GET /api/health` (public) and `GET /api/internal/health` (same secret); see `docs/27-DEPLOYMENT-AND-OPERATIONS.md`. Production uses the shared attempt limiter by default (`RATE_LIMIT_STORE=database`).
6. Do **not** set `app.environment` or `app.dev_clock`.

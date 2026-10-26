# Deployment and operations

Owner decision 8 (ADR-054) asks for hosting, scheduler and email provider to be decided and documented. **This page documents how the application runs and what an operator must provide. It does not decide hosting or the email provider: those are the owner's to choose.** Where it recommends, it says so.

**Start with `docs/32-GO-LIVE-RUNBOOK.md`**: the ordered steps, who does each, and how to know it worked. This page is the reference for settings, the scheduler, monitoring, backups and performance.

**Container.** `Dockerfile` builds the web application as a small image (`docker build -t 4core-okr --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .`); `deploy/docker-compose.yml` runs it together with a scheduler container on one host. Both were run locally (read-only, no capabilities, healthy, scheduler heartbeat confirmed); see ADR-073.

## 1. What has to run

| Part | What it is | Notes |
|---|---|---|
| Web application | Next.js 16 (`npm run build`, then `npm run start`), Node 24 | Stateless. Several copies may run side by side. |
| Database and sign-in | Supabase: PostgreSQL, Auth, the REST layer (PostgREST) | All business rules and permissions live in the database. Back it up (section 4). |
| Scheduler | Anything that can send an HTTP POST every minute | Section 3. Without it nothing locks, finalises, reminds or sends mail. |
| Email (optional) | An SMTP server | Section 5. Without it, mail is queued 48 hours and dropped; reminders still show in the application. |

## 2. Settings (environment)

| Variable | Needed | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public address and public key of the Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes, server only | Never sent to a browser, never committed. Business changes run only through this key. |
| `DB_URL` | tests and ops scripts only | Direct database connection (backup drill, break-glass, tests). Not needed by the running application. |
| `JOBS_SECRET` | yes | Long random value the scheduler and the monitor send in the `x-jobs-secret` header. |
| `JOBS_SECRET_PREVIOUS` | during a rotation only | The value being retired. Both work until you remove this one (section 3a). |
| `INTEGRATIONS_ENCRYPTION_KEY` | to store integration passwords and API keys | 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it in the secret store. Without it integrations can be saved but secrets cannot; with a wrong or missing key an enabled email integration is unusable and health says so. |
| `INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS` | during a key rotation only | The key being retired (comma-separated if more than one). Section 3d. |
| `INTEGRATIONS_ALLOW_PRIVATE_HOSTS` | never in production | `true` lets integrations call internal addresses. Development and automated tests only; health raises a critical alert if it is on in production. |
| `RATE_LIMIT_STORE` | no | `database` (shared by every instance; the default in production) or `memory` (per instance; the default elsewhere). Leave unset in production. |
| `EMAIL_TRANSPORT` | no | `smtp` for production, `file` for development and tests only (ignored in production), empty for none. |
| `SMTP_URL`, `EMAIL_FROM` | with `smtp` | For example `smtps://user:password@host:465` and `"4CORE-OKR <no-reply@your-domain>"`. |
| `APP_BASE_URL` | with email | Public address used for links in mail. |

Rotate `JOBS_SECRET` and the service-role key like any secret; both can be changed without a database change.

## 3. The scheduler

`POST /api/internal/jobs/run` with header `x-jobs-secret: <JOBS_SECRET>`. It is idempotent and safe to retry or to call twice at once: it rolls quarters, opens and locks weeks, finalises weeks, creates reminders, then hands queued email to the transport. A wrong or missing secret gets 401. A database failure gets 500 `JOB_FAILED`; an email failure never fails the call (the result reports it).

**Run it every minute.** Locks are exact to the minute only if the scheduler is; if it is down, the next run catches up, and the clock used for every rule is the database's (`app_now()`), never the scheduler's or a browser's.

Options (all equivalent to the application; choose by where you host):

1. **Hosting platform cron** (for example Vercel Cron, a Kubernetes CronJob, a cloud scheduler) calling the URL with the header. Recommended when the host offers it: nothing extra to run.
2. **Database scheduler** (`pg_cron` with `pg_net`) calling the same URL. Keeps scheduling next to the data.
3. **An operating-system timer** on any always-on machine: `curl -fsS -X POST -H "x-jobs-secret: $JOBS_SECRET" https://your-host/api/internal/jobs/run`.

Check it is alive: the response lists the work done; a stalled scheduler shows as week locks and reminders arriving late. Alert if no successful call has happened for five minutes.

### 3a. Rotating the scheduler secret

1. Set `JOBS_SECRET_PREVIOUS` to the current secret and `JOBS_SECRET` to a new long random value; restart the application.
2. Change the scheduler and the monitor to send the new value. Both values work meanwhile, so nothing is missed.
3. Remove `JOBS_SECRET_PREVIOUS` and restart. A wrong value, or one character off, gets 401.

### 3b. Monitoring

- `GET /api/health` (public, for the load balancer and an uptime monitor): `{"status":"ok"}`, or 503 with `degraded` (a development clock is set on a production database) or `unavailable` (the database cannot be read). It shows nothing else.
- `GET /api/internal/health` with `x-jobs-secret`: the figures (scheduler last run, queued and failed email, failed job steps in the last 24 hours, whether a clock override exists) and the alerts. Page someone on `critical`: `SCHEDULER_SILENT` (no run for over 5 minutes), `SCHEDULER_NEVER_RAN` (in production), `JOB_FAILURES`, `CLOCK_OVERRIDE_IN_PRODUCTION`. `warning`: `EMAIL_STUCK` (oldest queued message over 60 minutes), `EMAIL_FAILED`, `RATE_LIMIT_NOT_SHARED`. `info`: `EMAIL_NOT_CONFIGURED`. The response status is 503 on `alert`, so a plain uptime check on this URL also works.
- The scheduler writes a heartbeat on every run whoever starts it (the web route or a database scheduler), so a silent scheduler is visible even when the web application is fine.

### 3c. Retention

Once a day the scheduler removes read notifications older than the configured months (default 12) and finished email rows older than the configured days (default 90). Unread notifications, the audit log and every other record are never removed. The periods and an on/off switch are set in Administration → Data retention and change only through an approved request (ADR-072).

### 3d. Integrations and their secrets

Integrations (email, AI providers, webhooks) are set up in Administration → Integrations, not in files. Passwords, API keys and signing secrets are encrypted with `INTEGRATIONS_ENCRYPTION_KEY` before they are stored, so **the key is part of what you back up and protect**: the database backup alone cannot reveal a secret, and a backup without the key means the secrets are typed in again (nothing else is lost).

Rotating the key: (1) generate a new key; put the old one in `INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS` and the new one in `INTEGRATIONS_ENCRYPTION_KEY`; restart. (2) `OPERATOR="your name" npm run integrations:rewrap` re-encrypts every saved secret under the new key (nothing is printed; each change is audited as `INTEGRATION_KEY_ROTATED`). (3) When it reports nothing left to do, remove `INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS` and restart.

Email: an enabled SMTP integration is used instead of the `EMAIL_*` settings; switch it off (or remove it) to fall back to them. `GET /api/internal/health` shows `EMAIL_INTEGRATION_UNUSABLE` when it is enabled but cannot be used (for example its key is gone), and `WEBHOOK_FAILED` / `WEBHOOK_STUCK` when deliveries are failing or waiting. The network the application runs in should also restrict outbound connections to what integrations legitimately need.

## 4. Backup and restore

- **What to back up:** the Supabase PostgreSQL database (everything the application knows). The application files can be rebuilt from source; the secrets live with the operator.
- **How often:** at least daily with point-in-time recovery if the host offers it, since audit and ledger records are append-only and cannot be recreated.
- **Prove it works:** `npm run drill:restore` takes a full dump, restores it into a scratch database, compares every table's row count, and re-checks that the fund reconciles, the append-only triggers are still present and every function came back. It passed on the development machine against the local database. A drill against the production host's real backup tooling still has to be done by the operator at go-live and repeated at least quarterly.
- **Recovering access:** `docs/26-ACCOUNT-RECOVERY.md`, including the break-glass script.

## 5. Email

The in-application notification is always authoritative; email is a second channel. Choose any SMTP provider (the owner's decision; none is chosen). To enable: set `EMAIL_TRANSPORT=smtp`, `SMTP_URL`, `EMAIL_FROM`, `APP_BASE_URL`, and make sure the sending domain has SPF and DKIM set up with the provider, otherwise mail lands in spam. The transport has been verified against an in-process SMTP server (message content, link back to the application, retry and give-up behaviour); it has **not** been verified against a real provider.

Security mail (password changes, authenticator changes, break-glass, emergency reversal) is always sent; other mail respects each person's choice on the notifications page and the global switch in administration.

## 6. Observability

- Health, heartbeat and alerts: section 3b. Every API response carries a `Server-Timing` header with `actor` (who is calling), `handler` (the work) and `total` in milliseconds.
- Refused requests (permission or Business Unit scope) are written to the audit trail as `ACCESS_DENIED`, throttled to one per person and route per minute.
- Application logs go to standard output; the jobs route logs `jobs failed` and `email delivery failed` with the reason and no personal data.
- Recommended alerts (to be set up by the operator): scheduler silent for five minutes, 5xx rate, database disk, backup age, emails stuck in the outbox (`email_outbox` rows past five attempts).

## 7. Performance baseline

`npm run perf:baseline` signs in as seeded users and measures nine pages and report endpoints (60 requests each, six at once). Budgets: pages p95 ≤ 1500 ms, API p95 ≤ 600 ms. These are targets for catching regressions, not promises. Results are recorded in section 8 with the machine they were taken on; **production numbers must be measured on the production host with production-sized data.**

The first run found the cause of slow reports: row-level security policies called permission functions once per row. Migration `20261019000012_rls_initplan.sql` makes them evaluate once per statement (ADR-066); `tests/db/rls_cost.test.ts` prevents the pattern returning.

## 8. Recorded results

PERF_RESULTS_PLACEHOLDER

## 9. Release checklist

1. `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:db`, `npm run test:api:serial`, `npm run test:e2e` (against a production build), `node scripts/scan-secrets.mjs` and `npm audit --omit=dev --audit-level=high` (all of these run in CI).
2. Apply migrations (`supabase db push` or the host's equivalent) before starting the new application version; migrations are forward-only.
3. Confirm `JOBS_SECRET`, service-role key and email settings in the target environment.
4. After the release, call the scheduler once by hand and check for 200.
5. Check at least two people can manage roles (Administration warns otherwise) and that `GET /api/internal/health` shows no critical alert.
6. Confirm `RATE_LIMIT_STORE` is unset or `database`, and that no development clock is set on the production database (`app.environment`, `app.dev_clock`).

## Metrics endpoint

`GET /api/metrics` serves Prometheus metrics (process figures plus `http_requests_total` and `http_request_duration_seconds` for every API route, with ids collapsed to `:id`). In production it requires `Authorization: Bearer <METRICS_TOKEN>` and answers 401 without it; if `METRICS_TOKEN` is unset in production it stays closed. Outside production it is open when no token is set. ## Tracing

OpenTelemetry tracing starts from `src/instrumentation.ts` only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set; with neither set nothing is loaded. The exporter (OTLP over HTTP by default), headers and sampling follow the standard `OTEL_*` variables; the service name defaults to `4core-okr` (`OTEL_SERVICE_NAME` overrides it). Incoming requests, outgoing HTTP/fetch calls and database drivers are traced; file, DNS and socket spans are switched off as noise. Verified locally against a stand-in collector (spans arrived at `/v1/traces`); not yet run against a real collector, and the collector to use is a hosting decision.

## Client addresses and proxies

The per-address sign-in limits use the client address from `X-Forwarded-For`, counted from the right by `TRUSTED_PROXY_HOPS` (default 1: one reverse proxy or load balancer in front of the app). Set it to the real number of proxies. With `TRUSTED_PROXY_HOPS=0` the header is ignored and everyone shares one address bucket (safe, coarse; the per-account limit still applies). A wrong value in either direction weakens the per-address limit, never the per-account one.

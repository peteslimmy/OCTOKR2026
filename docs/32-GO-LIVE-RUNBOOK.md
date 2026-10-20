# Go-live runbook

What has to be done, in order, to run 4CORE-OKR for real. Every step says who does it and how to know it worked. Hosting and the email provider are the owner's choices: section 1 gives a recommendation and the questions that decide it, and every later step works with any choice. Nothing in this runbook has been run against a hosted environment yet (that needs your accounts); the pieces that can be tested without them were tested locally and say so.

## 1. Choices to make (owner)

| Choice | Recommendation | Why, and what would change it |
|---|---|---|
| **Database and sign-in** | A hosted Supabase project on a paid plan with point-in-time recovery, in the region closest to your people | The application is built for Supabase (PostgreSQL, Auth, REST). A hosted project gives backups, point-in-time recovery, patching and monitoring without running a database. Self-hosting Supabase is possible but moves all of that onto you. |
| **Where the web application runs** | The container image (`Dockerfile`) on any container host: a managed container service, or one VM running `deploy/docker-compose.yml` behind an HTTPS reverse proxy | The image holds no data and no secrets, so the host is replaceable. Choose a region near the database (every page makes several database calls). Two or more copies are safe: sign-in limits are shared (ADR-071). |
| **Scheduler** | `deploy/docker-compose.yml`'s scheduler container, or the host's own cron, calling `POST /api/internal/jobs/run` every minute | GitHub Actions schedules run at best every 5 minutes and are often late, so they are **not** suitable alone. Database `pg_cron` with `pg_net` also works (`deploy/schedule-with-pg-cron.sql`, **untested**). |
| **Email** | A transactional email service with SMTP access (examples: Postmark, Amazon SES, SendGrid, Brevo) on a domain you control | Any SMTP provider works; the application only needs `SMTP_URL`. Pick the one your organisation can already pay for and support. Confirm the provider's data-handling terms. |
| **Data location** | Decide with whoever advises you on data protection | The application stores names, work email addresses, performance scores, attendance and fines. Nigeria's data protection law (the NDPA 2023) and your own policies may restrict where this may be stored or processed and how long. This is a legal decision, not a technical one; the retention settings (ADR-072) and the audit export help you meet whatever you decide. |
| **Domain and HTTPS** | One address such as `okr.your-domain` with a certificate | Required: the application sets strict transport security and secure cookies only over HTTPS. |

## 2. Prepare the environments (operator)

1. Create two projects: **staging** and **production**. Never point staging at production data.
2. In each Supabase project: apply the migrations (`supabase link --project-ref <ref>` then `supabase db push`); enable TOTP multi-factor sign-in; disable public sign-up; set the minimum password length to 12 with upper-case, lower-case and a digit (`supabase/config.toml` shows the intended values); set the recovery email template (`supabase/templates/`).
3. Do **not** set `app.environment`, `app.dev_clock` or `app.test_now` on either database. `GET /api/internal/health` raises `CLOCK_OVERRIDE_IN_PRODUCTION` if one is present.
4. Create the secrets in the host's secret store: `SUPABASE_SERVICE_ROLE_KEY`, `JOBS_SECRET` (random, at least 16 characters), `SMTP_URL`. Fill in `deploy/.env.production.example` as `.env.production` on the host.

**Done when:** `supabase db push` reports every migration applied and `supabase migration list` shows none pending.

## 3. Build and start (operator)

```bash
docker build -t 4core-okr \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> .
cd deploy && docker compose --env-file .env.production up -d
```

**Done when:** `GET /api/health` answers `{"status":"ok"}` over HTTPS and the sign-in page loads.

## 4. First organisation and first Super Admin (operator, once)

`npm run bootstrap` with the `BOOTSTRAP_*` variables (see `scripts/bootstrap.ts`), run from a trusted machine that has the service-role key. Then the new Super Admin signs in, sets up the authenticator app and stores the ten recovery codes. Appoint a **second** person who can manage roles straight away (Administration → Users); the page warns until there are two.

**Done when:** two people can sign in, each with an authenticator, and Administration shows no warning about the number of people who can manage roles.

## 5. Scheduler and monitoring (operator)

1. Scheduler: `docker compose` starts one; otherwise create a cron that sends `POST /api/internal/jobs/run` with header `x-jobs-secret` every minute.
2. Monitoring: an uptime check on `GET /api/health`; an alert on `GET /api/internal/health` (header `x-jobs-secret`) returning 503 or any `critical` alert (docs/27 section 3b).
3. Error tracking: send the container's standard output to the host's log service and alert on `jobs failed` and `email delivery failed`.

**Done when:** the heartbeat in `/api/internal/health` shows `scheduler_age_seconds` under 60, and stopping the scheduler for 6 minutes on staging produces the `SCHEDULER_SILENT` alert.

## 6. Email (operator, then owner)

1. Verify the sending domain with the provider (SPF, DKIM) and add a DMARC record.
2. `SMTP_URL='...' EMAIL_FROM='...' EMAIL_CHECK_TO=you@your-domain npm run email:check` (tested locally against an in-process server; **not yet against a real provider**).
3. Set `EMAIL_TRANSPORT=smtp`, `SMTP_URL`, `EMAIL_FROM`, `APP_BASE_URL` and restart.
4. Send a real reminder: on staging, give a Business Unit no report, wait for the reminder hour (or lower the hours setting through an approval), and confirm the mail arrives with a working link.

If the owner decides to run without email at first, leave `EMAIL_TRANSPORT` unset: reminders still appear in the application and Administration says no provider is configured.

## 7. Backups and the restore drill (operator)

1. Confirm point-in-time recovery is on and note the retention the provider gives.
2. On staging, restore the latest backup into a scratch project and run `GET /api/internal/health` against it; check a few totals (users, weekly reports, ledger entries) and that the audit log and ledger still refuse edits. Record the time it took and the data lost (if any).
3. Repeat every quarter and after any provider change. (`npm run drill:restore` is the same drill for the local database.)

**Done when:** a restore has been done from the real provider's backup, with its duration written in `docs/27` section 8.

## 8. Load the organisation (owner and HR)

1. Administration → Import Business Units, then Import employees (the wizard validates before it commits).
2. Roles (Administration → Roles): confirm the eight shipped roles match the organisation or change them (needs approval by a different person).
3. Lock times (Administration → Lock times): set them **before** activating the first quarter; a generated week never changes.
4. Strategy: the annual theme, the quarter's objectives, key results and Sub-KRs; activate the quarter on its first day (a mid-quarter start needs the owner's decision, `docs/25` row 7).
5. Violation types and the penalty rate; reminder hours.

## 9. Acceptance on staging (owner)

User acceptance with HR, Finance, a Presenter, an Executive and one Business Unit Lead against staging data, following `docs/05-USER-JOURNEYS.md` and the acceptance criteria in `docs/20-ACCEPTANCE-CRITERIA.md`. The automated suites (database, HTTP, browser, accessibility) must be green on the release commit in CI first.

## 10. Go-live check (operator and owner)

| Check | How |
|---|---|
| CI green on the release commit, including the security job | GitHub Actions |
| Migrations applied, none pending | `supabase migration list` |
| Health | `/api/health` ok; `/api/internal/health` has no `critical` alert |
| Two people can manage roles; both have recovery codes stored | Administration |
| Scheduler heartbeat under 60 seconds for a day on staging | `/api/internal/health` |
| A restore drill from the real backup is on record | docs/27 section 8 |
| Email works, or the decision to run without it is written down | section 6 |
| `RATE_LIMIT_STORE` unset (shared limits) and no development clock | health alerts |
| Performance baseline repeated on staging with production-sized data, within budget | `npm run perf:baseline` against staging |
| A rollback plan: the previous image tag stays available; migrations are forward-only, so a faulty migration is fixed by a new migration, or by restoring the backup | operator |

## 11. After go-live

First week: watch `/api/internal/health` daily; review the audit log for `JOB_FAILED`, `ACCESS_DENIED` bursts and `CONFIG_CHANGE_EMERGENCY`; confirm the first content lock and final lock happened at the configured times.

# 10 — Performance and reliability

**All numbers are from the Next.js development server (Turbopack, no minification, hot reload), a local database, a nearly empty dataset (18 units, 0 reporting weeks) and a single browser.** They are *not* representative of production and prove nothing about scale.

| Page (cold-ish navigation) | TTFB | DOM content loaded | Load | Requests |
|---|---|---|---|---|
| `/dashboard` | 659 ms | 823 ms | 1,065 ms | 31 |
| `/admin/units` | 755 ms | 802 ms | 1,058 ms | 24 |
| `/reports` | 1,519 ms | 1,575 ms | 2,000 ms | not captured |

`/reports` is about twice as slow as the others even with no data; it builds the report catalogue on the server. Worth profiling with data.

## Measured elsewhere
- 487 tests (220 unit + 267 database) run in about 1 minute against a local database, indicating the database functions are not pathologically slow on small data.
- The full browser suite (155 tests) took 1.0 h and timed out before 17 tests ran on its last recorded run (16 Oct, `e2e-run.log`); one accessibility spec file alone took 5.7 minutes. Not re-run (F-019).

## Reliability observations (source)
- **Compensation:** user creation removes the auth identity if the application user fails; evidence upload now removes the record if storage fails; user deletion does *not* compensate (F-007).
- **Outbox pattern** for email and webhooks with attempt counts and `FAILED`/`SKIPPED` states; health endpoint reports queue and heartbeat state (`ops_health`) and returns 503 on critical alerts.
- **Rate limiter falls back** to an in-process counter if the shared one is unreachable (logged), so sign-in stays protected on each instance.
- **Metrics/tracing** now exist (F-020); tracing verified only against a stand-in collector.
- **Backups:** `scripts/backup-restore-drill.ts` and `docs/27` describe a drill; **not executed here**. In practice the only recoverable copy of the owner's real data after F-001 was `organisation.json`: a clear demonstration that backup/restore is the weakest operational control today.

## Not measured
Production build bundle sizes, Lighthouse, API latency under concurrency, query plans with realistic volume, report export time, memory use, background-job duration.

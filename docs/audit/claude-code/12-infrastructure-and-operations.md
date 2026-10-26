# 12 — Infrastructure and operations

Scope: files and local runtime only. No hosted environment was available; hosting is undecided (README).

## Found
- **Container image** (`Dockerfile`, standalone output option), **CI** (`.github/workflows/ci.yml`: security job with dependency and secret scans and a metrics-endpoint test; verify job with typecheck, lint, database tests from scratch, concurrency tests, build; API and browser jobs). CI has not been run on GitHub (README says so).
- **Local stack:** Supabase in Docker (db, auth, storage, studio, inbucket, kong, rest, realtime, analytics). Observed: `supabase_edge_runtime` exited (255) three days ago and `supabase_vector` is restarting in a loop; the project starts Supabase with those services excluded (`db:start` flags), so these are side effects of a different invocation and not used by the app.
- **Operational docs:** `docs/27`, `32-GO-LIVE-RUNBOOK.md`, `35-ALERTING-RULES.md`, `36-INCIDENT-RUNBOOK.md` (the last three untracked and written by an earlier session; unreviewed for accuracy).
- **Secrets/config:** `.env.local` present and ignored; `.env.example` carries uncommitted changes from earlier sessions. `METRICS_TOKEN` is not yet in `.env.example` (documented in `docs/27` instead). Jobs secret has rotation support.
- **Observability:** metrics, health, optional tracing (F-020).
- **Version control:** 9 commits, `master`, 103 modified and ~35 untracked paths. Nothing is protecting this work if the folder is lost. The owner has said not to push until the app is complete; committing locally is a separate step.

## Risks
1. **No backup routine for the working database** (F-001): the audit's only recoverable source for the owner's data was a seed file.
2. Alerting rules and incident runbook describe controls (Alertmanager, paging) with no evidence a monitor exists.
3. Restore drill never executed here.
4. The hosted deployment, email provider, collector endpoint, and `METRICS_TOKEN`/`JOBS_SECRET` provisioning are open decisions.
5. Local stack drift (stopped/restarting containers) is invisible to the app.

## Recommendations
Add a nightly `pg_dump` of the local and any hosted database to a location outside the repo; keep a tested restore command; commit locally in logical slices; record hosting decisions in a decision record; run CI once on a throwaway remote when the owner allows pushing.

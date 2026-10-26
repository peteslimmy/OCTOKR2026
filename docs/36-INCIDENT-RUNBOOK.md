# Incident Runbook

## Overview

This runbook documents common incidents for 4CORE-OKR and the steps to resolve them. Incidents are categorized by severity, and each has a predefined response procedure.

## Incident Severity Levels

| Level | Definition | Escalation |
|-------|-----------|-----------|
| **P0 (Critical)** | Service unavailable or data corruption; immediate action required. | Engage on-call within 15 minutes |
| **P1 (High)** | Major functionality degraded; workaround exists. | Engage on-call within 1 hour |
| **P2 (Medium)** | Minor degradation or inconvenience. | Address within 24 hours |
| **P3 (Low)** | Cosmetic or documentation issue. | Address in next sprint |

## Common Incidents & Resolution

### 1. Application Returns 5xx Errors

**Symptoms:** Users cannot access the app; `/api/health` returns 500.

**Steps:**
1. Check `/api/health` — note the response body and headers.
2. Check `/api/internal/health` (requires `x-jobs-secret`) — review `scheduler_age_seconds`, `db_pool_usage`, `error_rate`.
3. Check application logs: `tail -f logs/4core-okr.log | grep -E "ERROR|FATAL"`
4. Check database connectivity: `supabase db status` or `pg_isready`.
5. If database is down: restart Supabase stack (`npm run db:stop` then `npm run db:start`).
6. If memory/CPU exhausted: check resource limits, consider scaling.
7. **Rollback:** If recent deployment, revert to previous image tag.

**Escalate to P0 if:** Database is down, entire app is unavailable, or data corruption suspected.

### 2. MFA Enrollment Failures

**Symptoms:** Users cannot enroll in MFA; `MFA_ENROLMENT_REQUIRED` errors on every login.

**Steps:**
1. Check `MFAEnrollmentFailures` alert in Prometheus.
2. Verify TOTP configuration in Supabase project dashboard.
3. Check `scripts/break-glass-mfa-reset.ts` procedure if user is locked out.
4. Ensure `supabase/config.toml` has correct MFA settings:
   - `min_password_length: 12`
   - `allow_totp: true`
   - `sms_enabled: false` (if not using SMS)
5. If using break-glass: run `tsx scripts/break-glass-mfa-reset.ts` with service role key.

**Escalate to P1 if:** Multiple users affected, or one critical user locked out.

### 3. Email Notifications Not Sending

**Symptoms:** Reminders not arriving; notification queue growing.

**Steps:**
1. Check `EmailDeliveryFailures` alert in Prometheus.
2. Verify SMTP configuration: `SMTP_URL`, `EMAIL_FROM`, `EMAIL_TRANSPORT=smtp` are set in `.env.production`.
3. Test SMTP connectivity: `EMAIL_TRANSPORT=smtp SMTP_URL=... EMAIL_FROM=... npm run email:check`.
4. Check email outbox in database for failed rows.
5. Verify sending domain has valid SPF/DKIM/DMARC records.
6. If provider issue: switch to alternative SMTP provider or run without email (`EMAIL_TRANSPORT` unset).

**Escalate to P1 if:** Critical reminders not delivering (e.g., quarter-end).

### 4. Database Connection Pool Exhausted

**Symptoms:** App slows down; "connection exhausted" errors in logs; 503 errors.

**Steps:**
1. Check `DBConnectionPoolExhausted` alert.
2. Review `pg_stat_activity` for long-running queries.
3. Check for connection leaks in application code (ensure `pool.end()` or proper Supabase client cleanup).
4. Review recent deployments for new queries or inefficient code paths.
5. Temporarily increase pool size if on Supabase free tier (not recommended long-term).
6. Optimize slow queries or add database indexes.

**Escalate to P1 if:** Sustained pool exhaustion affecting multiple users.

### 5. Fund Balance Goes Negative

**Symptoms:** Violation fund reports negative balance; audit log shows unexpected transactions.

**Steps:**
1. Check `FundBalanceNegative` alert — this is **P0 critical**.
2. Arrest further transactions if possible (may require disabling violation submissions temporarily).
3. Review recent audit log entries for `VIOLATION_RAISED`, `DISBURSEMENT`, `FUND_ADJUSTMENT`.
4. Verify no concurrency race condition (run concurrency tests: `npm run test:concurrency`).
5. If data corruption: restore from last known-good backup using `npm run drill:restore`.
6. **Never manually set fund balance** — investigate root cause first.

**Escalate to P0 immediately.** Engage database administrator.

### 6. Secret Scanning Detects Credentials

**Symptoms:** `SecretScanningDetected` alert triggered; git history contains keys/tokens.

**Steps:**
1. Check `SecretScanningDetected` alert.
2. Identify which secret was exposed (alert includes file path and line number).
3. **Rotate the secret immediately:** generate new key/token, update in environment variables.
4. Revoke the old secret: invalidate API keys, rotate passwords, update OAuth clients.
5. Remove exposed secret from git history using `git filter-branch` or BFG Repo-Cleaner.
6. Run secret scanning again to confirm removal.
7. Update `scripts/scan-secrets.mjs` if needed; add to CI pipeline if not already.

**Escalate to P0 if:** Production credentials (Supabase service role, SMTP passwords) were exposed.

### 7. Scheduler Silent/Stalled

**Symptoms:** `SchedulerSilent` alert; jobs not running; data not being processed.

**Steps:**
1. Check `SchedulerSilent` and `SchedulerFailed` alerts.
2. Verify the scheduler process is running: `docker ps` or check system services.
3. Check `/api/internal/health` for `scheduler_age_seconds` value.
4. If scheduler is down: restart it (`npm run db:start` may restart dependent containers, or restart the scheduler container).
5. Check `jobs` table for stuck jobs.
6. Review scheduler logs for errors or panics.
7. If using `pg_cron`: check `SELECT * FROM pg_cron.job;` for disabled/cron jobs.

**Escalate to P1 if:** Scheduler down for > 1 hour, critical jobs missed.

### 8. No Active Reports for a Week

**Symptoms:** `NoReportsThisWeek` alert; Business Unit reports missing.

**Steps:**
1. Check `NoReportsThisWeek` alert (info severity, may be expected).
2. Verify the quarter is activated: Administration → Quarters, ensure current quarter is "ACTIVE".
3. Check that weeks have been generated: `SELECT * FROM reporting_weeks WHERE quarter_id = '<quarter-id>';`
4. Ensure lock times are set before quarter activation (per go-live runbook section 7.3).
5. If week genuinely missing: check if week start date is in the past and quarter should be further along.
6. Review `docs/25-IMPLEMENTATION-NOTES.md` for week numbering conventions (C4 conflict).

**Escalate to P2 if:** Multiple Business Units affected or reporting workflow blocked.

### 9. Access Denied Burst Detected

**Symptoms:** `AccessDeniedBurst` alert; users reports of unexpected 403 errors.

**Steps:**
1. Check `AccessDeniedBurst` alert.
2. Review audit log for `ACCESS_DENIED` entries: `SELECT * FROM audit_logs WHERE action = 'ACCESS_DENIED' ORDER BY occurred_at DESC LIMIT 50;`
3. Check for recent permission changes or role assignments.
4. Verify BU scope permissions are correct (users should only see their own BU's data).
5. Check if recent deployment changed permission logic.
6. If attack suspected: review `logs/4core-okr.log` for patterns; consider temporary rate limiting.

**Escalate to P1 if:** Multiple users affected or potential security breach.

## Post-Incident Procedures

### 1. Incident Report

After every P0 and P1 incident, file an incident report containing:
- Timeline: when incident started, key milestones, when resolved
- Root cause analysis (RCA): what actually caused the incident
- Impact: number of users affected, data loss (if any)
- Action items: preventive measures, fixes deployed
- Owner: who is responsible for follow-up

### 2. RCA Template

```markdown
# Incident RCA: <incident-summary>

**Date:** YYYY-MM-DD
**Severity:** P0/P1/P2/P3
**Duration:** HH:MM (start to resolved)

## Timeline
- `<time>`: Incident started
- `<time>`: First alert triggered
- `<time>`: Team notified
- `<time>`: Incident resolved
- `<time>`: Post-incident review

## Root Cause
<What actually caused the incident? Be specific.>

## Impact
- Users affected: <number>
- Data impacted: <describe any data impact>
- Revenue/service impact: <describe>

## Resolution
<Steps taken to resolve>

## Prevention
<Actions to prevent recurrence>

**Owner:** <name>
**Due date:** YYYY-MM-DD
```

### 3. Follow-up

- Assign action items with owners and due dates
- Verify fixes by running relevant tests
- Update monitoring/alerting if gap identified
- Add documentation if process gap found
- Close incident report in tracking system

## Quick Reference Commands

| Action | Command |
|--------|---------|
| Check health | `GET /api/health` |
| Check internal health | `GET /api/internal/health` (header: `x-jobs-secret: <secret>`) |
| Restart DB | `npm run db:stop && npm run db:start` |
| Run concurrency tests | `npm run test:concurrency` |
| Secret scan | `node scripts/scan-secrets.mjs` |
| Break-glass MFA reset | `tsx scripts/break-glass-mfa-reset.ts` |
| Purge transient data | `npx supabase functions invoke purge_transient_data` |
| Drill restore | `npm run drill:restore` |

## Escalation Contacts

| Role | Name | Contact |
|------|------|---------|
| On-call | <name> | <email/phone> |
| DB Admin | <name> | <email/phone> |
| Security | <name> | <email/phone> |
| Team Lead | <name> | <email/phone> |
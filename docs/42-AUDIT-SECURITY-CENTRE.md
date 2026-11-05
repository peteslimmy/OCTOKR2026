# 42. Audit & Security Centre

Enterprise audit trail, security logging and activity monitoring (ADR-107 to ADR-111). Migrations `20261108000001_audit_centre_core.sql` and `20261108000002_audit_detection_and_reads.sql`. Page: `/audit`. Code: `src/lib/audit`, `src/lib/data/audit.ts`, `src/app/(app)/audit`, `src/app/api/v1/audit`.

## 1. Technical assessment (state before this work)

| Area | Finding |
|---|---|
| Store | One table, `audit_logs` (actor id, role text, BU, action, entity type/id, old/new JSON, reason, outcome SUCCESS/DENIED/FAILURE, correlation id, ip, user agent, time, `seq`). One writer, `write_audit`, called from about 175 action codes in the same transaction as the business change. |
| Not duplicates | `okr_log` (session timeline, also writes `write_audit`), `lc_log` (lifecycle journey), `eo_events` (oversight timeline) are domain timelines, each immutable. They are kept and linked, not merged. |
| Immutability | `forbid_mutation` triggers only. The service role still held UPDATE/DELETE/TRUNCATE. No tamper evidence. |
| IP / user agent | **Wrong.** Every write goes through the service-role client, so Postgres saw the app server's headers, not the person's. `clientIp()` (trusted-hop logic) existed only for rate limiting. No session id, no separate request id, no device. |
| Model | No actor name/e-mail/BU snapshot, category, severity, channel, workflow id, metadata. Outcome lacked REJECTED/PARTIAL. No secret redaction. |
| Coverage gaps | Unauthenticated and second-factor refusals, rate limiting, cross-site rejections, file downloads, session revocation, viewing the log, system-made lifecycle changes, background-job success. |
| UI / API | Basic filter + table; CSV export (audited) capped at 10,000 rows. No PDF, no detail, no timelines. |
| Correction | An early read suggested password-change completion was missing; it is audited (`AUTH_PASSWORD_CHANGED` / `AUTH_PASSWORD_RESET`). |

## 2. Plan and what was built

1. **Extend, do not replace.** `audit_logs` keeps its name, its 74 callers and the `write_audit` signature, so nothing existing changes behaviour. Layers are views (`security_logs`, `system_logs`) over the same rows with the same ids; no data is copied.
2. **One place completes every row** (`audit_logs_1_enrich`, BEFORE INSERT), including direct inserts: request context, actor snapshot, category/severity from `audit_action_rules`, workflow id, redaction.
3. **App passes verified context** on its service-role calls (`x-audit-ip`, `-ua`, `-session`, `-channel`, `x-request-id`), see ADR-108.
4. **Hash chain + revoked privileges** (ADR-109).
5. **Detection rules and indicators** (ADR-110) and the **Centre UI** (ADR-111).

## 3. Event model (columns of `audit_logs`)

| Spec field | Column |
|---|---|
| Event id / affected record / request | `id` (uuid), `entity_type` + `entity_id`, `request_id` (kept separate; `correlation_id` is the caller-supplied id) |
| Timestamp | `occurred_at` (timestamptz, UTC); shown in WAT in UI, PDF and the CSV also carries UTC |
| Action, category, severity | `action`, `event_category`, `severity` (INFO, LOW, MEDIUM, HIGH, CRITICAL) |
| Outcome | `outcome` SUCCESS, FAILURE, DENIED, REJECTED, PARTIAL |
| Actor at the time | `actor_user_id`, `actor_name`, `actor_email`, `actor_role`, `actor_bu_id`, `actor_bu_name`, `actor_scope` (ORGANISATION / BUSINESS_UNIT / SYSTEM) |
| Source | `ip_address`, `ip_trusted`, `user_agent`, `browser`, `os`, `device` |
| Session / channel | `session_ref` (one-way hash prefix of the sign-in session id), `channel` WEB / API / SYSTEM / BACKGROUND_JOB |
| Workflow | `workflow_id` (the request record's id shared by request, approve, apply, reverse), `related_approval_id` |
| Before/after, reason, metadata | `old_values`, `new_values`, `reason`, `metadata` (all redacted) |
| Integrity | `chain_seq`, `prev_hash`, `row_hash` |

Categories: AUTHENTICATION, SECURITY, ROLES_PERMISSIONS, USER_LIFECYCLE, CONFIGURATION, SCHEDULING, STRATEGY, REPORTING, INTEGRITY, ATTENDANCE_HR, FINANCE, FILES_EXPORT, GOVERNANCE, ORGANISATION, SYSTEM, OTHER. Classification is data (`audit_action_rules`, LIKE patterns, highest priority wins); a DENIED or FAILURE is never below MEDIUM.

## 4. DB changes (summary)

New: `audit_action_rules`, `audit_chain_meta`, `audit_detection_rules`, `audit_alerts`, views `security_logs`, `system_logs`; functions `audit_redact`, `audit_parse_ua`, `audit_row_hash`, `audit_verify_chain`, `audit_verify_and_record`, `record_security_event`, `record_audit_access`, `audit_run_detection`, `audit_alert_set_status`, `audit_rule_configure`, `audit_centre_kpis`, `audit_centre_trace`, `lc_event_audit` (trigger on `employee_lifecycle_events`); `revoke_user_sessions` now audits. Permissions `audit.alerts.manage` (Super Admin, Admin) and `audit.rules.configure` (Super Admin; protected). `run_scheduled_jobs` calls `audit_run_detection` (guarded; a failure never stops the scheduler). `tests/db/fixtures/role-matrix.json` updated for the two new permissions.

## 5. Event-coverage matrix

Legend: **Y** recorded, **N** newly recorded by this work, **P** partial, **G** known gap.

| Area | Events | State |
|---|---|---|
| Authentication | login success/failure/lock, logout, MFA enrol/verify/step-up/recover/reset, break-glass, password change/reset/request | Y |
| | no sign-in on a protected route, MFA/step-up required, rate limited, cross-site rejected | N (`SECURITY_*`, collapsed 5 min per address+route) |
| | sessions revoked | N (`AUTH_SESSIONS_REVOKED`) |
| Users / lifecycle | create, update, delete, unit scope, roster, import | Y |
| | system-made lifecycle events (`employee_lifecycle_events` source SYSTEM) | N (`EMPLOYEE_LIFECYCLE_SYSTEM_CHANGE`); person-made ones already audited as `EMPLOYEE_LIFECYCLE_CHANGE` |
| Roles / permissions | role create/update/delete, grants, user roles, access reviews | Y |
| Config, branding | request, approve, reject, withdraw, apply, emergency | Y; linked by `workflow_id` (request id). Branding applied directly by Super Admin has no request id (P) |
| Schedules / locks | lock schedule, suspend/restore locks, final lock, reapply | Y |
| Strategy / OKR, weekly reports | create/update/submit/review/reject, goals, tasks, snapshots | Y |
| Integrity | corrections, session/ledger corrections, score amendments | Y |
| Attendance / HR | roster, amendments, violations, penalties | Y |
| Finance | ledger, reversals, disbursements | Y |
| Files | evidence upload/delete, report/AI/OKR/oversight exports, audit export | Y |
| | evidence download | N (`FILE_DOWNLOADED`; OKR-session and oversight attachment downloads: **G**, to add `record_security_event` to those two routes) |
| Admin / Super Admin | all admin functions above; viewing the audit log | N (`AUDIT_VIEWED`, one per person per minute) |
| Denied requests | permission/scope denied by signed-in people | Y (`ACCESS_DENIED`) |
| Background jobs | failures, purges | Y; successful runs of each job step: **G** (only the new detection run is audited when it raises an indicator) |
| Reads of sensitive records (non-export) | page views | G by design: "skip routine UI noise" |

## 6. Security findings

| # | Finding | Severity | Status |
|---|---|---|---|
| S-1 | Stored IP/user agent were the app server's, which breaks forensic value and IP-based detection | High | Fixed (ADR-108). Needs `TRUSTED_PROXY_HOPS` set to the real number of proxies in production, otherwise `direct`/`invalid` addresses are not stored and the row shows "server-side" |
| S-2 | service role could UPDATE/DELETE/TRUNCATE audit rows | High | Fixed: privileges revoked from every application role; trigger kept |
| S-3 | No tamper evidence | High | Fixed for new rows (chain). History before the chain started stays unchained, by decision |
| S-4 | Secrets could appear in old/new values if a function wrote them | Medium | Fixed: central redaction by key name at any depth. Residual risk: a secret stored under an innocuous key name |
| S-5 | Database owner (`postgres`) can still bypass triggers and revoke grants | Medium | Accepted; **detected, not prevented**: `audit_verify_chain` finds changed, relinked or removed chained rows. Truncating the whole table and re-chaining from genesis is not detectable from inside the database; keep off-box copies of the latest `row_hash` (section 7) |
| S-6 | Chain inserts are serialised by an advisory lock | Low | Accepted at current volume; revisit if audit writes exceed a few hundred per second |
| S-7 | `session_ref` is a hash prefix, never the token | Info | By design |
| S-8 | Client-supplied `x-audit-*` headers | Info | Only honoured on service-key calls; the browser cannot reach them |

## 7. Retention, archive, backup

- **Nothing deletes audit rows.** There is no purge function and no DELETE privilege. The existing retention settings (ADR-072) apply only to transient data.
- **Backups.** `npm run db:backup` includes `audit_logs` and the chain. After **every restore** run `npm run audit:verify` (read-only; exits 2 on a broken chain). `scripts/backup-restore-drill.ts` should call it; add this to the next drill.
- **Off-box anchor.** Weekly, record the latest `chain_seq` and `row_hash` (from the Integrity tab or `audit:verify`) in the operations log. A later full rebuild can then be detected.
- **Archive.** To keep the online table small, export a closed period with the PDF/CSV export or `pg_dump --table=audit_logs` for a date range and store it read-only with its first and last `chain_seq`/`row_hash`. Online removal of archived rows is **not** implemented; it needs an owner decision, a documented DBA procedure and a signed checkpoint row (not built).
- **Suggested retention.** Online: 24 months. Archive: 7 years (financial and HR events). Review with the owner.

## 8. Detection rules (indicators, not accusations)

Repeated failed sign-ins (5 / 15 min), repeated denials (5 / 30 min), administrator role granted, own roles changed, role/permission definition changed, unusual Super Admin activity (60 events / h), Super Admin off-hours (5 events 22:00-05:00 WAT), schedule or lock change, unusual exports (5 / h), integrity failure or chain break. Thresholds, window, severity and on/off are data (Super Admin, second factor, reason, audited). Reviewers (Super Admin, Admin) get a notification and set an investigation status (new, under review, explained, escalated, dismissed); closing needs a note. Indicator text always says it is "a signal to review, not a finding about anyone".

## 9. Test evidence

Run against a throwaway copy of the test database (`audit_scratch`, same server, marked as a test database) so the parallel go-live lanes were not disturbed:

| Lane | Result |
|---|---|
| `tests/db` (all 52 files incl. new `audit_centre.test.ts`, 16 tests) | 435 passed, 0 failed |
| Unit (`vitest run src`, incl. `src/lib/audit/__tests__`) | 453 passed |
| `tsc --noEmit`, `eslint` on changed files | clean (no errors) |
| HTTP (`tests/api/audit.api.test.ts`, extended) | **written, not run** here: needs the built app and the seeded test stack with both migrations applied |
| Browser / e2e of the Centre | **not run** (same reason) |

Run the HTTP and browser lanes after applying the migrations to the test stack (`npm run test:api:serial`, `npm run test:e2e`).

## 10. Not done / open decisions

- OKR-session and oversight attachment downloads are not yet audited as `FILE_DOWNLOADED`.
- Successful runs of existing background jobs are not audited.
- Online archiving/removal of old rows (needs an owner decision).
- Anchoring `row_hash` outside the database (procedure only).
- Branding applied directly has no workflow id.
- The Centre UI was type-checked and linted but not looked at in a browser.

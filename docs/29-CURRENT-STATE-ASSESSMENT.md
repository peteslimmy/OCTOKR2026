# Current-State Application Assessment — 4CORE-OKR (Phase 2 report, for validation)

**Status:** DRAFT for owner validation. No improvement recommendations are made here (Phase 4 is locked until the baseline is approved).
**Date of inspection:** 14 October 2026. **Inspected:** the repository `4core-okr` (source, 26 migrations, tests, scripts, CI file, documentation) and the live local database (schema, permission matrix, seeded data) as left by the last end-to-end run.
**Not inspected / not possible:** any deployed environment, the GitHub CI run (never executed), a real SMTP provider, a production Supabase project, the legacy application (no code or data was ever supplied), browser behaviour on devices other than Microsoft Edge under Playwright.

**Update, 20 October 2026.** Several snapshot findings have since been closed, without rewriting the dated body below. Item 4 is largely resolved: `docs/07` now states stored two-decimal precision and one-decimal display; `docs/10` lists the tables and functions added through migration `20261027000001`; `docs/11` documents RLS for the branding, integration, site-content and import tables; `docs/16` already covers ledger reversal and violation reopening; `docs/17` now covers outbound webhooks and import notification suppression; `README.md` covers the features through ADR-076. Item 6 has changed: outbound webhooks are built (ADR-076), leaving evidence file storage and the AI narrative unbuilt. Section 8's “only SMTP” is superseded by the integrations module. The counts in sections 6 and 7 remain as at 14 October and are deliberately not recomputed here.

## How to read evidence levels

| Label | Meaning in this report |
|---|---|
| **Implemented and verified** | Code exists AND automated tests that I executed in this working session passed (counts in section 11). Verified in a local development environment only, never in production. |
| **Implemented, verification pending** | Code exists; no automated test I ran exercises it end to end. |
| **Partially implemented / UI only / Planned only / Broken / Unclear** | As defined in your brief. |

Test totals executed on 14 October 2026 against the current code: **database tests 168 passed (25 files); unit tests 134 passed (16 files); API tests: all files passed when run one at a time (the one failure in the first full run was a test depending on mail backlog, fixed in the test and re-run green; the run was disturbed once by me starting two runs at the same time); end-to-end 115 passed (Edge, production build); `eslint` and `tsc --noEmit` clean.** The concurrency suite (`npm run test:concurrency`) was **not re-run** in this session. Test code, not people, defines "verified" here.

---

## 1. Executive summary

4CORE-OKR is a web application that runs a company's weekly OKR (Objectives and Key Results) discipline. Business Units file weekly reports made of SMART goals and tasks, each tied to a quarterly strategy (Annual theme → Quarterly objectives → Key results → Sub-key results). Reports lock on a fixed schedule, are scored as the share of goals completed, can lose points through integrity corrections, and roll up into a quarterly execution score. Alongside this is a governance layer: a Tuesday OKR session with attendance, penalties (violations) paid into a violation fund with an append-only ledger, and a segregated disbursement process. It also has reporting (dashboards, 9+ report types, exports, snapshots), a notification and email outbox, bulk import, account security (TOTP, recovery codes, step-up) and an audit trail.

It is built as a Next.js 16 / React 19 application on a Supabase (PostgreSQL + Auth) back end where almost all business rules and every mutation live in database functions; the web tier is a thin, permission-checked gateway plus server-rendered pages. It is development-complete for the scope in its specification pack, runs only locally, and has never been deployed or run in CI.

## 2. Purpose, business objectives and intended users

**Confirmed from your supplied documents (docs/00–23 pack and your pasted owner decisions in ADR-054):** drive weekly accountability against quarterly strategy; score execution objectively; keep discipline (attendance, penalties) and the fund auditable; give executives decision support. **Assumptions (not confirmed by you):** that the eight seeded roles and their permission sets are exactly your organisation's; every number in docs/25 rows marked "Yes" is an unconfirmed assumption.

| Role (code) | Permissions held | Intended use (from code/docs) |
|---|---|---|
| BU_LEAD | 15 | Writes and submits their Business Unit's weekly report; sees own BU only |
| PRESENTER | 10 | Runs presentation mode, reviews reports, integrity corrections and waivers |
| HR | 16 | Sessions, attendance, violations, payments, quotes, holiday weeks, disbursement requests |
| FINANCE | 12 | Approves/rejects/disburses disbursements, ledger, ledger reversals |
| DIRECTOR | 8 | Read-only executive dashboards, reports and fund |
| EXECUTIVE | 9 | As Director plus snapshots and approving strategy changes |
| ADMIN | 44 | Strategy, users, calendar, configuration, approvals (no cash movement) |
| SUPER_ADMIN | 44 | All Admin powers plus role grants, emergency overrides, annual-theme exceptions |

Source: `role_permissions` read live from the database (65 permissions, 8 roles). Note: the seed has **8 roles**, and the application seeds 10 users and 8 Business Units for local use. Any other roles your organisation uses (e.g. CEO, Team Member) do not exist in the implementation.

## 3. Module and submodule inventory

Counts verified live: **64 tables, 0 views, 207 functions in `public` (154 `SECURITY DEFINER`, 37 `read_*` read models), 50 triggers, 61 RLS policies, 26 migrations, 30 pages, 127 API route files**, ~16 unit-test files, 25 database test files, 12 API test files, 13+ e2e spec files.

| # | Module | Submodules |
|---|---|---|
| M1 | Authentication & account security | login, logout, forgot/reset/change password, TOTP enrol/verify/disable, recovery codes, step-up, admin MFA reset, break-glass script |
| M2 | Organisation & administration | Business Units, employees/users, roles & permission grants, suspend/reactivate, reporting calendar, organisation holiday, integrity penalty rate, reminder/email settings |
| M3 | Strategy | Annual theme, quarters (activate/lock), objectives, key results, sub-key results, strategy change control, history/versions |
| M4 | Weekly reporting | Reports, goals, tasks, edit lease/heartbeat, submit, review, skipped-week summary, SMART evaluation |
| M5 | Scoring & integrity | Weekly snapshots, compliance, integrity corrections (apply/waive), quarterly snapshots/execution, late-report exceptions, quarterly amendments |
| M6 | Presentation | Presenter view, last-week hint, current week |
| M7 | Governance & attendance | Sessions per week, roster, finalise, Skip OKR, attendance amendments, session-outcome correction, weekly quote, holiday amendments |
| M8 | Violations & finance | Violation types, violations, payments, fund, ledger, disbursement requests, ledger reversals |
| M9 | Dashboards & performance | BU, executive (ranking, drill-down drawer), HR, Finance dashboards, performance page |
| M10 | Reports | Overview, builder, saved reports, metrics catalogue, insights, assistant (rule-based), exports (CSV/XLSX/PDF), snapshots |
| M11 | Notifications & email | in-app, read states, "still waiting", preferences, reminders, email outbox/transport |
| M12 | Bulk import | Employees, Business Units (parse/validate/commit, batches) |
| M13 | Audit & observability | Audit log page/API, access-denied audit, Server-Timing header |
| M14 | Platform | Scheduler endpoint, rate limiting, CSP, dev clock, seed/history/TOTP scripts, backup drill, perf baseline, CI workflow |
| M15 | Public landing | `/` |

## 4. Detailed feature inventory and status

Evidence abbreviations: **P** page, **A** API route, **F** database function, **T** table, **DBT/API/E2E** test files that I executed.

### M1 Authentication & account security
| Feature | Current functionality | Roles | Evidence | Status | Limits / uncertainties |
|---|---|---|---|---|---|
| Login/logout | Email+password through Supabase Auth; session cookies; rate-limited | all | A `auth/login`, `auth/logout`; P `(auth)/login`; `src/lib/auth/rate-limit.ts`; API tests, E2E 01 | Implemented and verified | Rate limiter is in-process memory (code comment: stopgap, ADR-023); multi-instance behaviour unverified |
| Forgot/reset/change password | Email link flow, change requires current password | all | A `auth/password/*`; P forgot/reset | Implemented and verified (API/E2E) | Reset email transport only proven with file/in-process SMTP |
| TOTP MFA | Mandatory for SUPER_ADMIN, ADMIN, FINANCE (`mfa_required_roles`); enforced in DB, API and pages | those roles | A `auth/mfa/*`; T `mfa_required_roles`; P `account/security` | Implemented and verified | Real authenticator apps not tested (tests generate codes) |
| Step-up | 15-minute fresh-code requirement on `stepUp: true` routes | high-risk actors | `src/lib/api/handler.ts` | Implemented and verified | |
| Recovery codes + break-glass | 10 one-time codes, HMAC stored; script `scripts/break-glass-mfa-reset.ts` | MFA users / operator | A `auth/mfa/recover`, `recovery-codes`; DBT `recovery_codes` | Implemented and verified (script itself: verification pending) | Break-glass script not exercised by an automated test |
| Admin MFA reset | Super Admin/Admin reset another user's MFA | admin | A `users/[id]/mfa-reset` | Implemented, verification partial | |

### M2 Organisation & administration
| Feature | Functionality | Evidence | Status |
|---|---|---|---|
| Business Units CRUD | Create/edit/deactivate; `reports_weekly` flag | A `business-units`; P `admin` | Implemented and verified |
| Users/employees | Create, edit, roles, suspend/reactivate, permission grants (privileged grants need `roles.manage`) | A `users/*`, `employees`; T `user_permission_grants` | Implemented and verified (API/E2E) |
| Organisation holiday | Week declared holiday (excluded from denominator); two-person amendment for closed weeks | A `reporting-weeks/organization-holiday`, `holiday-amendment-requests/*`; DBT `holiday_two_person` | Implemented and verified |
| Penalty rate configuration | Single rate (seed 0.05) | A `admin/penalty-rate`; T `integrity_penalty_configurations` | Implemented and verified |
| Reminder / email settings | Hours before lock, frequency cap, global email switch | A `notification-settings`; F `send_report_reminders` | Implemented and verified |
| Customisation | No tenant theming, no custom fields, no workflow designer | — | Planned/not present |

### M3 Strategy
| Feature | Functionality | Evidence | Status |
|---|---|---|---|
| Annual theme | Create, change with history; exception change for Super Admin | A `strategy/annual-theme(s)`; T `annual_themes`, `annual_theme_changes` | Implemented and verified |
| Quarters | Create, activate (materialises weeks), roll/lock by scheduler | A `strategy/quarters/*`; F `roll_quarters`, `ensure_quarter_weeks` | Implemented and verified |
| Objectives / KRs / Sub-KRs | CRUD while quarter is not ACTIVE; max 4 KRs per quarter incl. retired | A `strategy/objectives|key-results|sub-key-results`; P `strategy` | Implemented and verified |
| Change control (ACTIVE quarter) | Request → different person approves → applied with versions; retire instead of delete | A `strategy/change-requests/*`, `history`; T `strategy_change_requests`, `strategy_item_versions`; DBT `strategy_change` | Implemented and verified (DB). UI e2e for the request/approve screens: **not covered** (only API auth/validation) → UI part: verification pending |

### M4 Weekly reporting
| Feature | Functionality | Evidence | Status |
|---|---|---|---|
| Weekly report lifecycle | Draft → submit → content lock → review → final lock | A `weekly-reports/*`; F `submit_weekly_report`, `finalize_reporting_week`; P `weekly/[reportId]` | Implemented and verified |
| Goals & tasks | KR-aligned or stretch goals, tasks, execution status after content lock | A `weekly-reports/[id]/goals`, `goals/*`, `tasks/*`; DBT scoring, edits | Implemented and verified |
| Edit lease | One editor at a time with heartbeat | A `weekly-reports/[id]/edit-session*`; T `report_edit_sessions` | Implemented and verified (concurrency suite from earlier milestone; not re-run now) |
| SMART evaluation | Deterministic rule-based quality score (not an AI model) | A `smart-evaluations`; `src/components/smart-panel.tsx`; T `smart_evaluations` | Implemented and verified |
| Skipped-week summary, Last-week hint | Shows outstanding items from previous week | A `skipped-summary`, `presentation/last-week`; F `read_previous_week_outstanding` | Implemented and verified |
| Review | Presenter/Admin marks REVIEWED | A `weekly-reports/[id]/review` | Implemented and verified (semantic assumed; docs/25) |

### M5 Scoring & integrity
| Feature | Functionality | Evidence | Status |
|---|---|---|---|
| Weekly score | `done goals / total goals`, equal weighting, stretch counts, non-submission = 0.00 NON_COMPLIANT | F `finalize_reporting_week`, T `weekly_score_snapshots`; DBT `scoring`, `scoring_edges` | Implemented and verified |
| Integrity correction | DONE→NOT_DONE (and reverse) with apply/waive penalty; reason required; by Admin/Presenter/Super Admin | A `integrity-corrections(+preview)`; DBT `scoring_edges` | Implemented and verified |
| Quarterly execution | Sum of weekly contributions / eligible weeks | T `quarterly_score_snapshots`; P `performance` | Implemented and verified |
| Late-report exception & score amendment | Authorise → apply/revoke; new quarterly version, original preserved | A `late-report-exceptions/*`; T `quarterly_score_amendments`; P `governance/late-reports` | Implemented and verified |
| Display rule | Percentages shown to 1 dp; stored scores 2 dp | `src/lib/format.ts` | Implemented and verified (unit); docs/07 still says 2 dp for display — see §11 |

### M6 Presentation
Presenter view of the current week and per-report drill (`presentation/current`, `weekly-reports/[reportId]`), integrity-correction dialog (`src/components/integrity-dialog.tsx`). **Implemented and verified (E2E).**

### M7 Governance & attendance
| Feature | Functionality | Evidence | Status |
|---|---|---|---|
| Session per reporting week | Created by HR/Admin per NORMAL week | A `governance-sessions`; P `governance` | Implemented and verified |
| Roster | Status per active staff; finalise | A `.../attendance`, `/finalize`; T `attendance_records` | Implemented and verified |
| Skip OKR | Whole roster tagged VIRTUAL_PRESENT, read-only | A `.../skip-okr`; E2E 14 | Implemented and verified |
| Attendance amendment | Request → different approver | A `attendance-amendment-requests/*`; T `attendance_amendment_*` | Implemented and verified |
| Session-outcome correction | Request → approve → execute; roster archived; emergency path | A `session-corrections/*`, `outcome-corrections`, `emergency-outcome-correction`; DBT `session_correction`; E2E 14 | Implemented and verified |
| Weekly quote | One quote per week | A `reporting-weeks/[id]/quote`; T `weekly_quotes` | Implemented and verified |
| Holiday amendment | Request/decide, then amendment applied | A `holiday-amendment*` | Implemented and verified |

### M8 Violations & finance
| Feature | Functionality | Evidence | Status |
|---|---|---|---|
| Violation types | LATE (₦1,000, LOW), NOSHOW (₦5,000, MEDIUM) + one more seeded; configurable | A `violation-types`; T `violation_types` | Implemented and verified |
| Violations & payments | Create, edit, record one payment each; reversing the payment reopens it | A `violations/*`, `.../payment`; DBT `violation_reopen` | Implemented and verified |
| Fund & ledger | Append-only ledger, balance, reconciliation | A `finance/fund`, `finance/ledger`; T `financial_ledger_entries`, `violation_funds` | Implemented and verified |
| Disbursements | Request (HR/Admin) → review → approve/reject/disburse (Finance only) | A `disbursement-requests/*` | Implemented and verified |
| Ledger reversal | Request/approve/execute, compensating entry; emergency | A `ledger-entries/*`, `ledger-reversals/*`; DBT `ledger_reversal` | Implemented and verified |

### M9–M10 Dashboards & Reports
| Feature | Evidence | Status |
|---|---|---|
| BU dashboard, executive dashboard (ranking, filters, drawer), HR and Finance dashboards | A `dashboards/bu|executive`; P `dashboard` | Implemented and verified (E2E 10) |
| Reports catalogue (9 report types, metric definitions, filters, drill) | `src/lib/reports/*`; P `reports/*`; DBT `reports` | Implemented and verified |
| Builder, saved reports, snapshots (immutable, checksummed) | A `saved-reports`, `report-snapshots`; T `saved_reports`, `report_snapshots` | Implemented and verified |
| Insights, assistant | `src/lib/reports/insights`, A `reports/insights`, `reports/assistant` | Implemented and verified; **rule-based, no AI model** |
| Exports CSV/XLSX/PDF with formula-injection defence | A `reports/[id]/export` | Implemented and verified (unit/API) |
| Employee KPIs, KR targets, financial projections | — | **Planned or documented only** (no data model; listed as blocked in docs) |

### M11–M13 Notifications, import, audit
- Notifications: in-app list, read/read-all, "Still waiting" state, per-user email preference (A `notifications*`, `notification-preferences`; F `read_notification_states`) — implemented and verified.
- Email outbox: 19 event types in `email_event_types`; transports `smtp`/`file`/none (`src/lib/email/*`) — verified against an in-process SMTP server and file transport; **real provider: not verified, none chosen**.
- Import: employees and Business Units wizard (`/admin/import*`, A `imports/*`; T `import_batches`, `import_batch_rows`) — implemented and verified. Other entities (strategy, historical data): not built.
- Audit: `audit_logs` (append-only), P `audit`, A `audit`; refused requests recorded as `ACCESS_DENIED` (F `record_access_denied`) — implemented and verified.

### M14–M15 Platform
Scheduler `POST /api/internal/jobs/run` (shared secret) → `run_scheduled_jobs()`: quarter roll, content-lock mirror, final locks, reminders, then email delivery — verified by DB/API/e2e. CSP with per-request nonce in `src/proxy.ts`. CI workflow `.github/workflows/ci.yml` (jobs verify, api, e2e): **never run on GitHub**. Landing page `/`: implemented and verified (E2E). Dev-only clock `scripts/dev-clock.ts` overrides `app_now()`.

## 5. Business rules, workflows and approval mechanisms (as built)

**Reporting calendar.** Weeks are materialised on quarter activation. Observed in the live DB for week 41: starts Mon 5 Oct 00:00 WAT; **content lock Tue 6 Oct 18:00 WAT; final lock the following Tue 13 Oct 11:00 WAT** (`reporting_weeks`). The database clock `app_now()` is the only authority (not the browser or the web server).
**Report life cycle.** BU Lead creates/edit goals and tasks until content lock; submitting before content lock is "filing"; after content lock only task execution status changes; Presenter/Admin review; at final lock the week is scored (job or on-demand). No report by final lock ⇒ score 0.00, NON_COMPLIANT. A holiday week is excluded from the quarter denominator.
**Scoring.** Equal weight per goal; stretch goals count; integrity penalty = combined rate on base score, floor 0; snapshots immutable and versioned (`docs/07`; DBT `scoring*`).
**Segregation of duties (all enforced in database functions with the actor passed explicitly):** attendance amendment (HR requests, Admin/SA approve); session-outcome correction (HR/Admin/SA ask; Admin/SA approve; Admin/SA execute; three different people; Super Admin emergency); ledger reversal (Finance/Admin/SA ask; Finance/SA approve and execute; not the requester); disbursement (HR/Admin request; Finance decides and pays); strategy change (Admin/SA ask; Admin/SA/Executive decide); holiday amendment on a closed week (two people); late-report exception (authorise → apply). High-risk routes require step-up and idempotency keys.
**Failure behaviour.** Job failures are audited as `JOB_FAILED` per step and do not block other steps; email problems never fail a notification or the job; mutations are single transactions.
**Cross-module effects.** Scoring ← reports ← strategy; performance and reports ← snapshots; violations ← attendance; fund ← violations/payments/disbursements/reversals; notifications ← almost every workflow; audit ← every high-risk action.
**Unverified business rules:** every owner-confirmation row in `docs/25-IMPLEMENTATION-NOTES.md` marked "Yes" (rows 1–62 include at least those listed in §12).

## 6. User roles, permissions and access control
65 permissions mapped to 8 roles (live matrix reproducible with the query on `permissions`/`role_permissions`). Enforcement layers: (1) UI hides controls (presentation only); (2) the API handler checks the permission and BU scope (`src/lib/api/handler.ts`); (3) the database functions re-check permission (`require_permission`) and BU scope; (4) RLS gives users **SELECT only** (61 policies, rewritten to InitPlans in migration 12); mutation functions are callable by `service_role` only (`lock_down_function_grants`). BU Leads are limited to their own BU. Unauthorised attempts by a signed-in person are audited. Individual grants beyond role defaults: `user_permission_grants`, privileged ones need `roles.manage`.

## 7. Database and data model summary
64 base tables (full list in the live schema), 0 views; business logic in 207 functions (read models `read_*`, mutations, helpers). Notable structure: organisation → business_units → employees → users/user_roles; annual_themes → quarters → quarterly_objectives → key_results → sub_key_results; reporting_weeks → weekly_reports → smart_goals → tasks (+ `task_status_history`); score snapshots (weekly, quarterly, amendments); governance_sessions → attendance_records (+ archive, amendments); violations → violation_payments → financial_ledger_entries (append-only; reversals link to originals); disbursement_requests/decisions/disbursements; audit_logs; notifications, email_outbox; import_batches/rows; saved_reports/report_snapshots. Immutability enforced by `forbid_mutation` and guard triggers (50 triggers). Money is `numeric(19,2)` (NGN). Migrations run in order 20261014000001 … 20261019000012.
**Observed in the live DB (test residue, not seed):** Business Units named "Wizard Alpha/Bravo/Alpha again" and a violation type "E2E fine" created by end-to-end tests; this local database is not clean production data.

## 8. Technical architecture and integrations
Next.js 16 App Router + React 19 + Tailwind 4 + Radix Dialog/Tooltip; server components for pages; API routes under `src/app/api/v1` wrapped by `src/lib/api/handler.ts` (auth, zod strict bodies, idempotency, step-up, Server-Timing); data access via Supabase JS (user client for reads under RLS, service client for mutations); Supabase local stack in Docker. Libraries: zod, decimal.js, luxon, exceljs, pdfkit, nodemailer. External integrations: **only** SMTP (optional) — no webhooks, no third-party APIs, no file/object storage, no queue (the scheduler is an HTTP call). Authentication: Supabase Auth with TOTP via the Auth MFA APIs plus application-level recovery/step-up. Deployment: none exists; `docs/27` is a runbook; hosting not chosen. Tests: Vitest (unit, DB, API, concurrency), Playwright + axe (accessibility, 0 violations enforced), scripts for perf baseline and restore drill. Constraints: in-memory rate limiter; development clock override table; local-only secrets.

## 9. Interdependencies
Single points of dependence: the database (all rules); `app_now()` clock; the scheduler (locks/finalisation/reminders do not occur without calls to `/api/internal/jobs/run`, though lock *enforcement* does not depend on it — code comment in `run_scheduled_jobs`); Supabase Auth (identity); the `lock_down_function_grants()` convention (a new function that forgets it would be exposed). Scoring depends on strategy mappings (sub-KR links) and calendar; reports depend on score snapshots; finance depends on violations which depend on attendance; notifications and email depend on `notify_users` being called inside each workflow.

## 10. Administrative and configuration capabilities
Administration page: Business Units, users and roles, permission grants, reporting calendar and holiday, integrity penalty rate, reminders and email, imports, MFA reset. Environment configuration: `.env.example` (Supabase keys, `DB_URL`, `JOBS_SECRET`, email vars, `APP_BASE_URL`). Not configurable from the UI: violation fine amounts? (violation types API exists; UI exposure **unclear** — verification pending), lock times (fixed in calendar generation, not a setting — **unclear whether intended to be configurable**), branding.

## 11. Verified issues, incomplete functionality and known limitations
1. **Never deployed; CI never run on GitHub** (`.github/workflows/ci.yml` only validated in parts locally).
2. **No email provider chosen**; SMTP verified only against a test server.
3. **Rate limiting is in-process** (`src/lib/auth/rate-limit.ts`): not shared across instances; restarts clear it. Tests are order-sensitive for this reason (they run one file at a time).
4. **Documentation lag:** `docs/07` and AC-SC-011 originally state two-decimal display (patched in docs/20 only); `docs/10`, `docs/11`, `docs/16`, `docs/17` and `README.md` have not been updated for migrations 3–12; `docs/24` ADR-054 statuses were patched, other ADRs complete; `docs/28` counts predate the final totals.
5. **Reports not built:** employee KPIs, KR targets, financial projections (no data model).
6. **Not built:** evidence file storage (attendance amendments hold references only); webhooks; AI assistant narrative (the "assistant" is a rule router). Strategy and historical-report import tooling is built (ADR-079, ADR-077).
7. **UI e2e gaps:** strategy-change UI screens and the notifications "Still waiting" badge have no browser test; the break-glass script has no automated test; the concurrency suite not re-run this session.
8. **Inconsistent/overlapping implementations (recorded, not judged):** five different "correction/amendment" workflows with different roles and shapes (attendance amendment, holiday amendment, late-report exception/score amendment, session-outcome correction, ledger reversal); `attendance.session.outcome.correct` means "execute" while `.request`/`.approve` have role defaults that differ from the other workflows; a few raw tables outside the shared `DataTable` (last-week hint, charts text table, report-view sortable table); dashboards partly built on `MetricCard` and partly on older cards.
9. Performance: measured on a development laptop only. After the changes in this session all nine baseline targets are within budget one request at a time; with six simultaneous requests several exceed them on that machine (docs/27 §8).
10. The seed/test data creates 8 Business Units and 10 users; real organisation data does not exist in the system.

## 12. Items needing your clarification
1. Are the 8 roles and their permission sets exactly your organisation's? Are other roles (e.g. CEO, team member) required?
2. Confirm or correct docs/25 rows marked "Yes", especially: report review semantics (46), reminder defaults (52), email events list (53), session-correction roles (56–57), strategy change roles and KR limit (58–59), violation reopen default (60), refused-request audit throttle (61), performance budgets (62).
3. Should lock times (Tuesday 18:00 and the following Tuesday 11:00 WAT as generated) be configurable, or fixed?
4. Violation fine amounts and types: who changes them, and is the third seeded type correct? (Seed contents beyond LATE/NOSHOW are unconfirmed.)
5. Is the legacy application available for the parity comparison (docs/28 is only a requirements-versus-build matrix)?
6. Hosting, scheduler and email provider choices (ADR-054 #8).
7. Which of the "not built" items in §11.5–6 are required for go-live?
8. Intended behaviour for a Business Unit with no report when it is inactive or `reports_weekly = false` (implemented as excluded; intended?).

## 13. Concise summary of my understanding
The application is an enterprise OKR execution platform whose rules live in PostgreSQL: weekly goal reporting with fixed locks and scoring, quarterly roll-up, a Tuesday session with attendance and fines, an auditable violation fund with segregated approvals, executive reporting, notifications with email, and strong account security. Everything described as "verified" works in a local test environment under 168 DB, 134 unit, API and 115 browser tests; nothing has run in a deployed or CI environment, several business rules rest on assumptions awaiting your confirmation, and a short list of reports, integrations and tooling does not exist.

**Coverage achieved:** all 30 pages and 127 API routes were enumerated; the DB was queried live; tests were executed. Detailed line-by-line inspection of every component was not performed; behaviours I describe from memory of earlier build work are tied to the tests above rather than re-read, and any statement you find inaccurate should be corrected in Phase 3.

---

# Phase 3 — Owner corrections and revised baseline (revision 2)

No application file was changed to produce this revision. "As built" is what the code does today (re-checked read-only on 14 October 2026), "As intended" is what you confirmed, "Discrepancy" is the difference. Nothing intended is treated as built.

## P3.1 Decisions recorded from your reply

| # | Your answer | Recorded as |
|---|---|---|
| Q1 | The 8 seeded roles and their permissions are correct. Roles and permissions must **not be hardcoded**; build RBAC in which new roles can be created. | Intended requirement R-1 (below). The 8 roles stay as the initial set. |
| Q2 | "Yes means agreed." | Every row of `docs/25` whose last column says **Yes** is recorded as **agreed** where a default is implemented. Exceptions are listed in P3.4 because "Yes" cannot answer them. |
| Q3 | Lock times must be configurable because they may change. | Intended requirement R-2. |
| Q4 | Violation types are agreed by management; Admin and Super Admin create types and fees in the app. | Confirmed intended; see discrepancy D-3. |
| Q5, Q6 | "Forget" them. | Withdrawn. Legacy comparison and hosting/scheduler/email-provider choices are no longer open questions in this baseline. |
| Q7, Q8 | Your reply lists "7, 8" without an answer. | **Unresolved**; one question in P3.5. |

## P3.2 As built, as intended, discrepancy

### R-1 Roles and permissions (RBAC)
| | |
|---|---|
| **As built** | Roles (8) and role→permission assignments (65 permissions) are rows in `roles` and `role_permissions`, seeded by migration `20261014000001_foundation.sql`. Permission checks read those rows (`auth_has_permission`, `require_permission`), so *permission contents* are already data. There is **no API or screen to create, rename or deactivate a role, or to change its permissions**; the routes `src/app/api/v1/users/[id]/roles` and `.../permissions` only assign existing roles and individual grants (`user_permission_grants`) to a person. |
| **Hardcoded role names that block new roles** | UI: `src/app/(app)/admin/admin-actions.tsx` lines 7–8 (`ALL_ROLES`, `PRIVILEGED`) and `src/app/(app)/admin/page.tsx` line 33 (counts `SUPER_ADMIN`). API: `src/app/api/v1/users/route.ts` line 6 and `src/app/api/v1/users/[id]/roles/route.ts` line 4 (zod enums of the eight names, `max(8)`). Database functions that name roles in their body: `assert_can_grant_roles`, `set_user_roles`, `set_user_status`, `authorise_mfa_reset`, `record_break_glass`, `bootstrap_organisation` (privilege and last-Super-Admin rules keyed to `ADMIN`/`SUPER_ADMIN`); `bu_lead_ids`, `send_report_reminders`, `finalize_reporting_week`, `skip_okr_session`, `apply_session_correction`, `declare_organization_holiday`, `amend_organization_holiday` (recipients chosen by role name such as `BU_LEAD`). The table `mfa_required_roles` is already data. Business-Unit scope is expressed by permissions (`weekly_report.view_own_bu`, held only by BU_LEAD today). |
| **As intended** | Roles are created and maintained in the application; no role name or permission set is fixed in code. |
| **Discrepancy** | Permission contents are data-driven, but role management does not exist and role names are embedded in 4 UI/API places and 13 database functions. Not implemented. |

### R-2 Lock times
| | |
|---|---|
| **As built** | Fixed as literals in `ensure_reporting_week()` (`supabase/migrations/20261014000002_strategy_calendar.sql` lines 344–363): the week starts Monday 00:00 `Africa/Lagos`; **content lock = Tuesday of the same week, 18:00**; **final lock = Tuesday of the following week, 11:00**. A trigger forbids changing `week_start_at`, `content_lock_at`, `final_lock_at` or the quarter of an existing week (same file, lines 318–319). Session dates use the same zone (`20261015000001_attendance.sql` line 212). Reminder settings count hours back from `content_lock_at`. |
| **As intended** | Lock times are configurable, since they may change. |
| **Discrepancy** | No configuration exists, and generated weeks cannot be edited. How a change should treat past, current and already-generated future weeks is not defined (Q7). |

### D-3 Violation types and fees
| | |
|---|---|
| **As built** | `POST /api/v1/violation-types` and `PATCH /api/v1/violation-types/[id]` (name, criticality LOW/MEDIUM/HIGH/CRITICAL, fine > 0, active); a form "Violation type added" in `src/app/(app)/governance/violations/violation-actions.tsx`; table `violation_types` (`default_fine numeric(19,2)`). Seeded: LATE ₦1,000, NOSHOW ₦5,000. Both database functions `create_violation_type` and `update_violation_type` require the permission **`violation.edit`**, which `role_permissions` grants to **ADMIN and HR only**. Audited as `VIOLATION_TYPE_CREATED`. |
| **As intended** | Admin **and Super Admin** create violation types and fees. |
| **Discrepancy (verified)** | Super Admin does **not** hold `violation.edit`, so Super Admin cannot create or edit violation types today; HR can, which you did not list. |

## P3.3 Updated status of items affected
| Item | Before | Now |
|---|---|---|
| Role management (create/edit roles and permissions) | Not listed | **Planned or documented only** (R-1, confirmed required) |
| Configurable lock times | "Unclear whether intended" | **Planned or documented only** (R-2, confirmed required) |
| Violation type management | Implemented and verified | Implemented and verified for Admin and HR; **discrepancy** for Super Admin and HR (D-3) |
| Legacy parity comparison, hosting/scheduler/email provider | Open questions | Withdrawn from this baseline at your direction. The fact that no provider is chosen is unchanged. |
| docs/25 "Yes" rows | Awaiting confirmation | Agreed, except rows in P3.4 |

## P3.4 "Yes" rows that "Yes" alone cannot settle
- Treated as **agreed** (a default is implemented in each): rows 3, 4, 5, 6, 10, 15, 19, 20, 21, 22, 23, 25, 27, 29, 31, 33, 34, 39, 47, 48, 56, 58, 60.
- Need a named decision or data, so **not** closed by "Yes": 7 (go-live aligned to a quarter start, or a start-week setting), 28 (reversing a locked holiday: keep as built, or require exceptions first), 35 (approved governance priority-band targets: numbers), 43 (which imports besides employees and Business Units), 51 (break-glass operator, witness and incident-log location), 54 (email provider; you withdrew this, so it stays "none chosen"), 57 (block reopening when amendments exist, or cancel them with it), 62 (production performance budgets: numbers).
- Rows whose last column does not say "Yes" (for example "Confirm…") were not covered by your answer and remain unconfirmed.

## P3.5 Focused questions (only about the new ambiguities)
**Roles (R-1)**
1. Who may create roles and change a role's permissions? Today only SUPER_ADMIN holds `roles.manage`. Super Admin only, or Admin as well?
2. May the 8 initial roles be edited or deleted, or are they protected with only new roles editable? May a role be deleted while people hold it?
3. Should some permissions be guarded, so they cannot be put on a new role without a Super Admin and a fresh authenticator check (for example emergency overrides, role management, ledger reversal approval)? Or may any permission go on any role?
4. Business-Unit scope: when a role is created, should you choose "own Business Unit" or "whole organisation"? (Today scope is the pair `weekly_report.view_own_bu` / `view_all`.)
5. Who is "the report owner"? People who file reports, receive reminders and are told about corrections are found today by the role name BU_LEAD. Should that become "anyone holding the permission to submit reports for their Business Unit", so a renamed or new role works the same way?
6. Should "this role requires an authenticator" become a setting on each role (the table `mfa_required_roles` already exists), including new roles?

**Lock times (R-2)**
7. What may be configured, and from when? Content-lock day and time, final-lock day and time, week start day, time zone: which of these? Should a change apply only to weeks not yet generated, also to future weeks already generated, and never to a week already open or locked?
8. Who may change them (Admin, Super Admin), and should it need two-person approval like strategy changes? Should reminders and the session day follow the new times automatically?

**Violation types**
9. Should HR keep the ability to add and edit violation types, or is it Admin and Super Admin only, as you described? Should a change to a default fee affect only violations recorded afterwards (my reading of the current design)?

**Unresolved from your reply**
10. You wrote "7, 8" after "forget question 5 & 6". Should I also forget questions 7 and 8 (what is required for go-live; handling of inactive or non-reporting Business Units), or did you intend answers to them?

## P3.6 What I need from you
Answers to 1–10 (short answers are enough), and confirmation that **revision 2** of this baseline, with the three discrepancies above (R-1, R-2, D-3), is accurate. I will not start Phase 4 or change any code until you approve the baseline explicitly.


---

# Phase 3 — Revision 3 (second round of owner answers)

No application file was changed. Intended behaviour below is **not** built; the as-built facts in revision 2 are unchanged.

## P3.7 Answers recorded
| Question | Your answer | Recorded intent |
|---|---|---|
| 1 | Super Admin and Admin can create roles and change permissions. | R-1a: both roles (today only SUPER_ADMIN holds `roles.manage`; Admin does not) |
| 2 | The roles can be deleted if required. | R-1b: any role, including the 8 initial ones, can be deleted. Conflicts with safeguards are listed in P3.8. |
| 3 | "Should be answered by you." | My proposed answer is in P3.8 and needs your approval; it is a proposal, not a recorded decision. |
| 4 | "Do not select a BU when creating roles." (my reading) | R-1c: roles carry no Business Unit; a person's Business Unit comes from their employee record, as today. Whether a role gives "own Business Unit" or "whole organisation" visibility is still decided by the permissions on it. |
| 9 | HR and Admin/Super Admin can edit violation types. | D-3 corrected: **HR, Admin and Super Admin**. As built: HR and Admin only. Discrepancy: Super Admin lacks `violation.edit`. Fee changes affecting later violations only: not stated, treated as the current design. |
| "yes, all update MUCH require." | Unclear (see Q-D). | Not recorded. |
| 5, 6, 7, 8, 10 | Not answered. | Still open. |

## P3.8 My answer to question 3 (proposal, for your approval)
Roles will be editable by Admin and Super Admin, and deletable. Because an editable role system can be used to give oneself power, I propose these rules, to be enforced in the database, not the screen:
1. **No escalation:** a person can put on a role only permissions they hold themselves.
2. **Protected permissions:** `roles.manage`, `users.manage`, `audit.read`, the emergency overrides (`ledger.reversal.emergency`, `attendance.session.outcome.emergency`), `strategy.annual_theme.change_exception`, `integrity_penalty.configure` and the money permissions (`disbursement.approve|disburse`, `ledger.reversal.approve|execute`) may be added to or removed from a role only by a Super Admin, with a fresh authenticator check. Admin can manage everything else.
3. **Separation of duties stays a rule of the system:** a role may not combine request and approve for the same workflow (for example `disbursement.create` with `disbursement.approve`), and the existing "never the requester" rules stay in force for every role.
4. **Deletion safeguards, because you want deletion allowed:** a role cannot be deleted while people hold it unless they are first moved to another role in the same action; the last role holding `roles.manage` cannot be deleted or stripped of it; nobody can remove their own last role. The seeded SUPER_ADMIN role can be deleted only if another role then holds `roles.manage` and has at least one active member.
5. **Every change audited** (who, role, permissions before and after), notified to all Super Admins, and changes take effect at the person's next request (no stale permissions).

## P3.9 Focused questions remaining
- **A.** Do you approve the five rules in P3.8, or which would you change?
- **B.** Question 5 (report owner by permission instead of role name BU_LEAD) — answer needed, or shall I take my recommendation (yes, by permission)?
- **C.** Question 6 (authenticator requirement as a setting on each role) — same.
- **D.** Questions 7 and 8 (lock-time scope, who changes them and whether approval is needed): your line "yes, all update MUCH require." — did you mean *all updates must require approval/a reason/an audit entry*, and for which changes (roles, lock times, violation fees)?
- **E.** Question 10: forget questions 7 and 8 (go-live requirements; inactive or non-reporting Business Units), or answer them?

I will not start Phase 4 or change any code until you explicitly approve the baseline (revision 3).

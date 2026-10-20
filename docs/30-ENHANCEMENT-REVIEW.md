# Phase 4 — Enhancement and Improvement Review (for owner approval; nothing is implemented)

**Baseline:** docs/29-CURRENT-STATE-ASSESSMENT.md revision 3, approved by the owner on 15 October 2026.
**Boundary:** this document recommends. No code, schema or configuration has been changed. Implementation starts only for the items the owner approves in section 7.
**Evidence rule:** each item cites what I inspected. "Not inspected" is stated where it applies.

## 0. Owner decisions that shape this review

| Topic | Decision | How it is used here |
|---|---|---|
| Roles | Admin and Super Admin create roles and edit permissions; roles (even the initial eight) can be deleted; roles carry no Business Unit; five safeguard rules approved (no escalation; protected permissions need Super Admin + fresh authenticator check; separation of duties; deletion safeguards; audit and alerts) | E-01 |
| Report owner | Found by permission, not by the name BU_LEAD | E-01 |
| Authenticator | "Requires authenticator" is a setting on each role | E-01 |
| Updates | **All (governance-relevant) updates must require approval** | E-04 (scope to confirm, §6) |
| Lock times | Configurable; **a change can never apply to a week that is already generated** | E-02 |
| Violation types | HR, Admin and Super Admin may edit | E-03 |
| Old questions 7 and 8 | Owner: "answer them on best practice" | §5 (answers, subject to approval) |
| docs/25 "Yes" rows | Agreed except rows 7, 28, 35, 43, 51, 54, 57, 62 | §6 asks only for what is still needed |

## 1. Summary of findings

| Class | Count | Items |
|---|---|---|
| Missing business requirements (owner-confirmed) | 4 | E-01 role management, E-02 configurable lock schedule, E-03 violation type access, E-04 approval for configuration changes |
| Go-live blockers (not defects in the code, but the application cannot be run for the business without them) | 5 | G-1 deployment and CI never executed, G-2 shared rate limiting, G-3 monitoring and alerting, G-4 backup tested on real host, G-5 email provider or an accepted in-app-only decision |
| Security and data-protection risks | 5 | S-1 … S-5 |
| Scalability and data growth | 4 | P-1 … P-4 |
| Architecture and maintainability | 4 | A-1 … A-4 |
| Quality assurance gaps | 4 | Q-1 … Q-4 |
| Usability and accessibility | 3 | U-1 … U-3 |
| Documentation | 2 | D-1, D-2 |
| Optional new capabilities (not confirmed requirements) | 5 | O-1 … O-5 |

There are **no known critical defects** in implemented behaviour: every automated check that I ran (168 database, 134 unit, 115 browser, API files, lint, type check) passed. The risks are in what has not been exercised (deployment, CI, real email, production-size data) and in four confirmed requirements that do not exist yet.

---

## 2. Confirmed requirements (missing capabilities)

### E-01 Role management (RBAC) — *Missing business requirement, High, Large*
1. **Affected:** Administration, users, every permission check, notifications, MFA.
2. **Validated current state:** roles (8) and role→permission rows are data, but there is no way to create, edit or delete a role. Role names are written into four UI/API places (`admin-actions.tsx` L7–8, `admin/page.tsx` L33, `api/v1/users/route.ts` L6, `api/v1/users/[id]/roles/route.ts` L4) and 13 database functions (`assert_can_grant_roles`, `set_user_roles`, `set_user_status`, `authorise_mfa_reset`, `record_break_glass`, `bootstrap_organisation`, `bu_lead_ids`, `send_report_reminders`, `finalize_reporting_week`, `skip_okr_session`, `apply_session_correction`, `declare_organization_holiday`, `amend_organization_holiday`). `mfa_required_roles` is already data.
3. **Problem:** a new role cannot exist; privilege rules and recipients depend on literal names.
4. **Proposal:** (a) role administration screen and API (create, rename, describe, set permissions, clone, deactivate/delete); (b) replace literal names in code with permissions or role flags: "privileged role" becomes a flag derived from protected permissions, "last Super Admin" becomes "last holder of `roles.manage`", report owner and reminder recipients become "holders of `weekly_report.submit` in that Business Unit"; (c) per-role setting `requires_mfa`; (d) your five rules enforced inside the database functions; (e) role and permission changes follow E-04 (request → different approver → apply); (f) permission descriptions and a "who would be affected" preview before approval.
5. **Value:** roles follow the organisation without releases; no privilege rule depends on a name that can now be deleted.
6. **Technical approach:** migration adding `roles.is_system`, `roles.requires_mfa`, `roles.description`, `permissions.protected` and `role_change_requests` (+ immutable history); new SECURITY DEFINER functions `request_role_change`, `decide_role_change`; refactor the 13 functions to use `users_with_permission(...)`; keep seeded role codes as data; drop zod enums in favour of an `exists` check; UI built on the shared `DataTable`/`Field`.
7. **Dependencies and side effects:** touches the security core, so it is the riskiest change; deleting the seeded SUPER_ADMIN role is allowed only by rule 4; `bu_lead_ids` also drives who is notified of corrections (behaviour must stay identical for the seeded roles); permission cache is per request so changes apply at the next request.
8. **Complexity/priority:** Large / **High** (confirmed requirement).
9. **Security, migration, compatibility:** privilege-escalation tests are mandatory; migration must keep every current permission identical for the 8 seeded roles; role removal must not orphan segregation-of-duty rules (the "not the requester" rules are by person, so they continue to hold); audit entry for every change; alert all holders of `roles.manage`.
10. **Validation:** DB tests for each rule (escalation attempt, protected permission without step-up, request-and-approve combination, delete role in use, delete last `roles.manage` holder, self-lockout); a regression test proving the permission matrix of the 8 roles is unchanged after migration; API tests for 401/403/422; browser test for create-role → approve → assign → person gains access, delete role → person moved; axe.

### E-02 Configurable lock schedule — *Missing business requirement, High, Medium*
1. **Affected:** reporting calendar, scoring, reminders, sessions, dashboards that show lock times.
2. **Current state:** literals in `ensure_reporting_week()` (migration `20261014000002_strategy_calendar.sql` L344–363): Monday 00:00 `Africa/Lagos` start; content lock Tuesday 18:00 same week; final lock Tuesday 11:00 next week. A trigger forbids changing lock times of an existing week. Weeks are all generated when a quarter is activated and by the scheduler (`ensure_quarter_weeks`).
3. **Problem:** a change of policy needs a code release and cannot be applied safely.
4. **Proposal:** an effective-dated **schedule setting** (week start day, content-lock weekday/time and week offset, final-lock weekday/time and offset, time zone). A new version is created by approval (E-04) and is used **only when a week is generated**; weeks already generated are never altered (your rule, and it matches the existing trigger). Because every week of a quarter is generated at activation today, a new schedule would otherwise apply only from the next quarter. **Recommended:** generate weeks on a rolling horizon (current week plus the next N, default 4) so a change takes effect after the horizon passes; the choice of N is yours (§6, question 2). Reminder hours and the session day derive from the stored lock times, so they follow automatically.
5. **Value:** the business can change deadlines safely and traceably; every historical week keeps the rule it ran under.
6. **Approach:** table `reporting_schedule_versions` (immutable, effective-from), `ensure_reporting_week` reads the version in force on the week's date, store the version id on each week for traceability; rolling-horizon change in `ensure_quarter_weeks`/jobs; admin screen to propose, approve and view history with a preview of "first affected week".
7. **Dependencies:** quarter activation, scheduler, `weekly_compliance`, sessions (final-lock date), exports that print lock times; DST is not an issue for `Africa/Lagos` but other zones need tests.
8. **Complexity/priority:** Medium / **High**.
9. **Security/migration:** existing weeks keep their stored times (no data migration); the first schedule version is seeded from today's literals so behaviour is unchanged; approval prevents a single person shifting deadlines.
10. **Validation:** DB tests: the seeded version reproduces current lock times exactly; a new version affects only newly generated weeks; an existing week's times never change; approval segregation; rolling horizon generates the expected weeks; reminder timing follows a changed schedule; e2e: propose → approve → next generated week shows new times.

### E-03 Violation type management — *Missing business requirement (small), High, Small*
1. **Affected:** governance → violations, violation types.
2. **Current state:** UI form, API and functions exist; `create_violation_type`/`update_violation_type` require `violation.edit`, held by ADMIN and HR only (`role_permissions` read live). Fee is `violation_types.default_fine numeric(19,2)`; there is no fee history other than the audit row.
3. **Problem:** Super Admin cannot do what the owner expects; fee changes are not versioned or approved.
4. **Proposal:** grant `violation.edit` to SUPER_ADMIN (the owner's rule: HR, Admin and Super Admin); route changes through E-04 as an approval request; keep recorded violations at the fee they were created with (stored per violation in `violations.fine_amount`, verified in the schema); add a fee history view.
5. **Value:** matches policy; management can see who changed a fee and when.
6. **Approach:** one migration (permission row), reuse the E-04 engine for create/update, show history from audit/approved requests.
7. **Dependencies/side effects:** approval makes "add a type" two-step; unrelated violations unaffected.
8. **Complexity/priority:** Small / **High**.
9. **Security/migration:** none beyond the permission row; guard against negative or absurd fees stays.
10. **Validation:** DB test that Super Admin can request and approve (not both), HR cannot approve its own change, a changed fee does not alter existing violations; e2e for the request/approve flow.

### E-04 Approval for configuration changes — *Missing business requirement (interpreted), High, Medium–Large*
1. **Affected:** roles and permissions (E-01), lock schedule (E-02), violation types/fees (E-03), integrity penalty rate (`admin/penalty-rate`), reminder and email settings, `mfa_required_roles`.
2. **Current state:** each sensitive change has its own bespoke pattern or none. Strategy changes, holiday amendments, ledger reversals, session corrections and attendance amendments are separate request→approve workflows with similar but not identical tables and functions (baseline §11.8). The penalty rate, reminder settings, and violation types currently change in one step by one person.
3. **Problem:** the owner decided all updates must require approval; building each as another bespoke workflow would add a sixth, seventh and eighth copy of the same code.
4. **Proposal:** one generic **configuration change request** engine: request (reason, proposed new value, idempotency key) → different person with the approving permission decides → applied atomically with before/after stored → audit and notification. Per-topic "who requests / who approves" kept in data (a table), not code. Protected topics (roles with protected permissions) require Super Admin approval and step-up. **Do not rewrite the existing five workflows now;** migrate them later only if the owner wants one engine.
5. **Value:** consistent control and one place to audit; new configuration topics need data, not new code.
6. **Approach:** `config_change_requests` (topic, target, before, after JSON, status, requester, decider), `config_change_topics` (permissions for request/approve, protected flag), functions `request_config_change`, `decide_config_change`, topic-specific appliers called inside the decision transaction.
7. **Dependencies/side effects:** E-01–E-03 build on it, so it comes first; bootstrap case: the first Super Admin and first-time setup must be possible without an approver (a documented bootstrap/seed path); a single-person organisation cannot approve its own changes (policy decision, §6).
8. **Complexity/priority:** Medium–Large / **High** (precedes E-01..E-03).
9. **Security/migration:** the engine itself is a privilege boundary: appliers must re-check permissions at decision time; idempotency required; no change to existing workflows, so no regression there.
10. **Validation:** DB tests for requester ≠ approver, rejection, replay, stale request (value changed since request), protected topic requires Super Admin; API and e2e tests per topic.

---

## 3. Go-live readiness (these are about running the system, not about code correctness)

| ID | Finding and evidence | Proposal | Value | Approach | Complexity / priority | Validation |
|---|---|---|---|---|---|---|
| **G-1** | Never deployed; `.github/workflows/ci.yml` never executed on GitHub (only parts validated locally); e2e only on Edge. | Choose hosting, run CI, deploy to a staging environment, run the full suite there. | Without it nothing is proven outside this machine. | Follow docs/27 §3, §9; GitHub Actions; staging Supabase project. | Medium / **Critical for go-live** | CI green; e2e and perf baseline on staging; scheduler called every minute for a week without a miss. |
| **G-2** | Rate limiting and sign-in attempt limits are in process memory (`src/lib/auth/rate-limit.ts` comment: stopgap). Several instances or restarts would reset limits. | Shared store (Redis-compatible, or a database table) with the same interface. | Brute-force protection holds when scaled or restarted. | Replace `rateLimited()` implementation behind the same function; keep memory fallback for tests. | Small–Medium / **High** | Unit and API tests with two app instances; restart test. |
| **G-3** | No error tracking or alerting; logs go to stdout; `Server-Timing` exists. Only the scheduler's own audit rows (`JOB_FAILED`) signal failures inside the database. | Error tracking, uptime and scheduler-heartbeat alerts, alert on outbox backlog and `JOB_FAILED`. | Failures are noticed before users report them. | Provider-neutral (OpenTelemetry or the host's tooling); a `/api/health` route (not present today); heartbeat from `run_scheduled_jobs`. | Medium / **High** | Fault-injection test: stop the scheduler → alert fires within 5 minutes. |
| **G-4** | Restore drill ran only against the local Docker database (`scripts/backup-restore-drill.ts`). | Run the same drill on the hosting provider's real backup; enable point-in-time recovery; schedule a quarterly drill. | Audit and ledger data cannot be recreated. | docs/27 §4. | Small / **High** | Drill report stored; RPO/RTO measured. |
| **G-5** | No email provider chosen (owner withdrew the question). Mail is queued 48 hours then dropped when no transport is configured; in-app notifications always work. | Either accept in-app only at go-live (documented), or configure SMTP with SPF/DKIM when a provider is chosen. | Avoids silent expectation of email. | docs/27 §5; a visible banner in Administration when mail is off. | Small / Medium | Send test to a real mailbox; bounce handling check. |

---

## 4. Further findings (grouped, each with the ten required fields in compact form)

### Security and privacy

**S-1 Reports/notification bodies and exports contain personal data without a retention rule** — *Privacy, Medium, Small.* (1) Notifications, exports, audit. (2) No purge job exists in `run_scheduled_jobs()` (inspected: quarters, locks, finalisation, reminders only). (3) Data is kept forever; the audit log must be (immutable) but notifications, `email_outbox` and `import_batch_rows` need not be. (4) Add retention settings and a purge step for non-audit transient tables (e.g. read notifications > 12 months, sent outbox > 90 days, import rows > 180 days) — periods are the owner's decision. (5) Smaller database, lower exposure. (6) Scheduler step + settings (via E-04). (7) Must never touch append-only audit/ledger tables. (8) Small / Medium. (9) Retention applied only to named tables; dry-run mode. (10) DB tests that audit/ledger rows are untouched and old transient rows are removed.

**S-2 Single shared secret for the scheduler** (`x-jobs-secret`, constant-time compare in `api/internal/jobs/run/route.ts`) — *Security hardening, Low–Medium, Small.* No rotation procedure or network restriction is documented beyond docs/27. Proposal: support two valid secrets during rotation and recommend host-level IP/ signature restriction. Validation: API test for rotation window.

**S-3 Powerful service-role key in the web tier** — *Architecture risk inherent to the design, Medium (accepted), Small.* All mutations use it; compromise of the web host exposes all data. Proposal: document key custody, rotate on staff change, restrict network access to the database, ensure the key never appears in logs (add a log-redaction test). Not a redesign.

**S-4 Sessions: idle timeout, concurrent session list and "sign out everywhere" are *not inspected*.** Recovery-code use ends other sessions (verified), but a self-service "my sessions" view and an explicit idle timeout were not found. Proposal: review and, if absent, add. *Status: needs inspection before it can be rated.*

**S-5 `app_now()` has two override paths** (`app.test_now` for direct `postgres` sessions; `app.dev_clock` only when `app.environment = 'development'`). Low risk because both need database-level access, but a production database must never set them. Proposal: a startup/health check that fails if either setting is present in production, plus a test. Small / Low–Medium.

### Scalability and data

**P-1 Lists are unpaged.** `listAudit(limit = 100)` returns a fixed latest 100 events (`src/lib/data/index.ts` L191–193) with no search, date filter, paging or export; only 7 query sites use `.limit()/.range()` and no API route takes page/cursor parameters (grep). Proposal: keyset pagination and filters for audit, notifications, violations, ledger, reports lists; CSV export of the audit log (permissioned). Value: usable at 1–3 years of data. Medium / Medium–High. Validation: tests with 50k seeded rows, p95 within budget.

**P-2 Performance only measured on one laptop.** After this session's fixes all nine baseline targets pass sequentially, but with six simultaneous requests several exceed budgets on that machine (docs/27 §8). Proposal: re-run on staging with realistic volume (e.g. 200 users, 3 years of weeks), add composite indexes only where measured. Medium / Medium.

**P-3 Single-organisation assumption in code**: `select id from organisations limit 1` appears in 7 migration functions (grep). Fine for one company; incompatible with multi-tenant. Proposal: record as an accepted constraint (ADR), do not generalise unless needed. Small / Low.

**P-4 Currency and time zone are literals** (`Africa/Lagos`, NGN in UI text). Proposal: organisation settings (currency code, time zone) read by the calendar (E-02) and formatters. Small–Medium / Low–Medium.

### Architecture and maintainability

**A-1 Five similar correction workflows** (attendance amendment, holiday amendment, late-report exception/score amendment, session-outcome correction, ledger reversal) plus strategy change control — different tables, role sets and states. Proposal: do not rewrite; standardise new ones on E-04; consider migrating later. Value: lower maintenance. Large if migrated / Low now.

**A-2 Role-name literals in code** — resolved by E-01.

**A-3 Remaining raw tables outside `DataTable`** (last-week hint, charts text table, report-view sortable table) and two dashboard card styles. Small / Low.

**A-4 Large SQL functions** (e.g. `run_scheduled_jobs`, `finalize_reporting_week`) are tested through behaviour, not unit-by-unit; migrations are forward-only with `create or replace` copies of whole functions (risk of a later migration reverting an earlier fix). Proposal: add a test that lists functions whose latest definition differs from the intended one (for example a hash of critical functions), and keep one "current definitions" documentation. Small–Medium / Low–Medium.

### Quality assurance

**Q-1** No browser test for the strategy-change screens or the notification "Still waiting" badge; break-glass script untested; the concurrency suite was not re-run in the last pass. Small / Medium. **Q-2** Browser coverage is Microsoft Edge only; add Chromium/Firefox/WebKit in CI. Small / Medium. **Q-3** No automated "permission matrix" test that compares each role's API access against `docs/06` (a table-driven authorisation test); partial coverage exists by file. Medium / Medium–High (vital once roles are dynamic, E-01). **Q-4** No load or soak test and no security scan (dependency audit, secrets scan) in CI. Small / Medium.

### Usability and accessibility

**U-1** Axe automated checks show zero violations on the screens covered; **manual** screen-reader/keyboard walkthroughs and a mobile pass were not done. Medium / Medium. **U-2** Help/onboarding text and empty states exist per screen but there is no in-app guidance for first-time setup (bootstrap → strategy → calendar → import). Small–Medium / Medium. **U-3** Error messages come from a catalogue (`src/lib/domain/errors.ts`) and are English only; no localisation. Optional.

### Documentation

**D-1** `docs/10`, `11`, `16`, `17`, `06`, `07` and `README.md` have not been brought up to date with migrations 3–12 (AGENTS.md requires the spec to follow behaviour). Small / **High before handover**. **D-2** Operator and user guides (role-based "how do I…"), a data-dictionary export, and an architecture diagram are absent. Medium / Medium.

### Optional capabilities (not confirmed requirements; do not build without approval)

**O-1** Employee KPIs, KR targets, financial projection reports (no data model; listed as blocked). **O-2** Evidence file storage for attendance amendments and integrity corrections (today references only). **O-3** Historical data migration tooling for strategy and past weekly reports. **O-4** Real AI assistant (today a rule-based router; needs provider and data-protection approval). **O-5** Webhooks/API tokens for integrations, calendar (ICS) feeds for locks and sessions, push or chat notifications.

---

## 5. Answers to the old questions 7 and 8 (best practice, for your approval)

**Old Q7 — what must be true before go-live (recommended exit criteria):**
1. Staging and production environments exist, HTTPS only, secrets in the host's secret store (G-1).
2. CI green on the release commit: lint, type check, unit, database, API, browser tests (G-1).
3. Scheduler runs every minute with an alert if silent for 5 minutes (G-3).
4. Backups with point-in-time recovery and one successful restore drill on the real host (G-4).
5. Shared rate limiting (G-2) and error tracking (G-3).
6. E-01 to E-04 delivered, because roles and configuration must be right before real users are loaded.
7. At least two active Super Admins, authenticators enrolled, recovery codes stored; break-glass procedure rehearsed.
8. Employees and Business Units loaded by import; one quarter's strategy loaded and activated on a quarter boundary (go-live on a quarter start avoids the mid-quarter problem; row 7 stays your decision).
9. Documentation brought up to date (D-1) and an operator guide (D-2).
10. User acceptance sign-off by HR, Finance, a Presenter, an Executive and one BU Lead, using seeded or real data in staging.
11. Performance baseline repeated on staging within budget (P-2).
12. Email: provider configured **or** a signed decision to run in-app only (G-5).

**Old Q8 — inactive or non-reporting Business Units (recommended rule; matches the implemented default in docs/25 row 20, which you agreed):**
- A Business Unit that is inactive or has `reports_weekly = false` is **not expected** to report: no reminders, no non-compliance, not in the quarterly denominator and not in rankings; it is not shown as "missing".
- Data already recorded for it is kept and remains visible to authorised roles and in historical reports.
- Deactivation takes effect for weeks that are **not yet generated or not yet locked**; locked weeks are never rewritten. Reactivation starts the unit at the next unlocked week.
- Its people are not moved automatically; a deactivation warning lists people still assigned (as built, deactivation leaves people assigned).
- Changes to a Business Unit's reporting status follow E-04 approval.
No code change is needed for the rule itself; the effective-date handling and the approval step are the additions.

---

## 6. What I still need from you (only items that change the plan)

1. **Scope of "all updates must require approval" (E-04).** My recommendation: governance-critical configuration only — roles and permissions, the lock schedule, violation types/fees, the integrity penalty rate, reminder/email settings, role MFA requirement, Business Unit reporting status. Ordinary administration (adding a user, editing a profile, adding a Business Unit) stays audited but single-step. Agree, or should user and Business Unit changes also need approval?
2. **Rolling horizon (E-02).** Today a quarter's 13 weeks are generated at activation, so under your rule a new schedule would apply from the next quarter. Do you accept this, or should weeks be generated a few at a time (my recommendation: the current week plus the next 4) so a change takes effect within about a month?
3. **Who approves.** For roles and permissions: protected permissions need Super Admin approval (your rule 2); other role changes: Admin or Super Admin other than the requester? For the lock schedule and violation fees: Admin/Super Admin other than the requester, or a named role such as Executive?
4. **Small organisations.** If only one person can approve (for example a single Super Admin), may that person approve their own request in an emergency (audited and alerted, like the existing emergency overrides), or must a second approver always exist?
5. **Priorities and phases.** My proposed order is in section 7; tell me what to move, drop, or add (for example: whether any optional item O-1…O-5 is a real requirement).
6. **Retention periods (S-1)** if you approve that item, or leave them to me as defaults (read notifications 12 months, sent mail 90 days, import rows 180 days).

## 7. Proposed implementation order (needs your approval before any work starts)

| Phase | Items | Why this order |
|---|---|---|
| 1 | E-04 engine, E-03 | Smallest confirmed requirement, proves the engine |
| 2 | E-01 role management (with Q-3 permission matrix test) | Largest, riskiest; needs the engine and the matrix test first |
| 3 | E-02 configurable lock schedule | Needs the engine; touches the calendar |
| 4 | G-2 shared rate limiting, G-3 health/monitoring, S-5 production clock guard, S-2 secret rotation | Hardening, independent of the above |
| 5 | P-1 paging/filters and audit export, S-1 retention, P-4 currency/time zone settings | Scale and data hygiene |
| 6 | Q-1, Q-2, Q-4, D-1, D-2, U-1, U-2, A-3 | Quality and handover |
| 7 | G-1, G-4, G-5 (deployment, staging, CI run, restore drill, email decision) | Needs your hosting and provider choices |
| Later / only if you ask | A-1, A-4, O-1…O-5 | Optional |

**Approval needed:** please confirm which phases (or items) I may implement, and answer §6. Until then I will not modify the application.

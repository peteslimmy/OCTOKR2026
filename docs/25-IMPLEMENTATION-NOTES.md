# 4CORE-OKR Implementation Notes

Where the specification is silent, ambiguous or internally inconsistent, this file records what the implementation does
and why, so a business decision can later replace it. Nothing here is a silently invented business rule: each item is
the safest non-destructive behaviour (`00-SOURCE-OF-TRUTH.md` — Rule for ambiguity).

## A. Specification conflicts and how they were resolved

| # | Conflict | Resolution |
|---|---|---|
| 1 | `12-API-CONTRACT` lists `POST /governance-sessions/{id}/cancel`; every other document forbids a CANCELLED outcome. | Not implemented. Only SCHEDULED / HELD / SKIPPED exist. |
| 2 | `05-USER-JOURNEYS` UJ-15 debits the ledger on approval; ADR-022, `16-FINANCIAL-CONTROLS` and BR-FIN-007 separate approval from disbursement. | **Built:** the DEBIT posts at the DISBURSED step (ADR-041/046, DEC-009 still open). |
| 3 | Violation status vocabularies differ (ADR-022 vs `08-STATE-MACHINES`). | **Built:** `OPEN → PAID \| DEDUCTION_RECORDED` (ADR-046). |
| 4 | ADR numbering: the August package used ADR-033 for an attendance question; the current package uses ADR-031 / ADR-033 differently. | Current package numbering is used. |

## B. Behaviour chosen where the specification is silent

| # | Topic | Behaviour | Needs owner decision? |
|---|---|---|---|
| 1 | Task execution window | BU Leads can set `UNDEFINED → DONE/NOT_DONE` only **after content lock** (Tue 18:00) until final lock, exactly as `04-BUSINESS-RULES` BR-WR-010 reads. Before content lock the task definition is editable but its status is not. | Confirm. |
| 2 | Report creation cut-off | A BU can create its report from Monday 00:00 until content lock. After content lock nothing can be added, so a missing report stays missing (0.00 / NON_COMPLIANT at final lock). | Confirm. |
| 3 | Report review | ADR-038: Presenter/Admin/SuperAdmin marks a final-locked, submitted report REVIEWED (audited, non-blocking). Provides the "normal review" referenced by skipped-week rules. | **Yes** — the specification defines no review state. |
| 4 | Provisional quarter scores (DEC-020) | A quarterly snapshot is `PROVISIONAL` until the quarter is locked, every eligible week is finalised **and** every submitted report is reviewed. Pending review is never scored as zero. | **Yes**. |
| 5 | Week → quarter assignment (DEC-004) | A reporting week belongs to the quarter containing its Monday. Reporting weeks keep their own lifecycle even after their quarter locks (a week whose Monday is in the last days of a quarter finalises after the next quarter starts). | **Yes**. |
| 6 | Which BUs report weekly | **Every ACTIVE BU is expected to report** (including an "HQ"/admin BU if one exists). A BU created mid-quarter is excluded from earlier weeks (`created_at` after the week ended). | **Yes** — a "reports weekly" flag per BU is likely needed. |
| 7 | Go-live mid-quarter | Weeks that have already ended when a quarter is activated are finalised as missing-report zeros by the scheduler, per the fixed-denominator rule. | **Yes** — production go-live should align with a quarter start, or an authorised exception / start-week setting is needed. |
| 8 | Penalty rate | No default. APPLY is impossible until Admin/SuperAdmin configures a rate; WAIVE needs only a reason. | Provide the rate. |
| 9 | Integrity correction timing | Allowed after content lock. Refused (`QUARTER_LOCKED`) once the week is final-locked **and** its quarter is locked; the late-report amendment path (ADR-050) is separate and does not use integrity corrections. | Confirm. |
| 10 | Strategy edits after activation (DEC-007) | Titles/descriptions of an ACTIVE quarter's objective, KRs and Sub-KRs can be edited (audited); nothing can be deleted; new Sub-KRs can be added; KR count is capped at 4. Locked quarters are read-only. | **Yes**. |
| 11 | Edit lease (DEC-008) | 5-minute TTL, 2-minute heartbeat, one active lease per report; expiry is lazy. No admin takeover yet. | Confirm values. |
| 12 | Calendar quarters | Quarters are calendar quarters; the Annual Theme year is the calendar year. | Confirm. |
| 13 | Holiday scope | Whole reporting weeks only; declaring a week that already has submitted reports or is final-locked returns `HOLIDAY_AMENDMENT_REQUIRED` (the audited amendment path is not built yet). Reversal is not built yet. | Post-lock/after-submission declaration and reversal use the controlled amendment (ADR-051). |
| 14 | Role → permission matrix | See `supabase/migrations/…_foundation.sql`. Derived from `06-ROLES-PERMISSIONS` scope rules; new permissions: `weekly_report.review`, `reporting.week.manage`, `strategy.quarter.manage`, `dashboard.executive.view`, `presentation.view`. | Review. |
| 15 | Session ↔ week link | A session presents the week that final-locks on that Tuesday; Skip activates the summary requirement on that week's reports (ADR-042). | **Yes**. |
| 16 | Skip while a draft roster exists | Allowed (draft discarded); refused once finalised (ADR-043). | Confirm. |
| 17 | Disbursement commitments | Approved-but-unreleased requests reduce the *available* balance, so approvals cannot over-commit (ADR-046). | Confirm. |
| 18 | "Designated HR approver" | Implemented as per-user permission designations (ADR-047). Admin/SuperAdmin hold approve by default. | Confirm. |
| 19 | Reviewer comment on rejection | Recorded, **not** mandatory (DEC-016). | **Yes**. |
| 20 | BU that does not report | `reports_weekly` flag (ADR-048). | **Yes**. |
| 21 | Violation scope | Fine/criticality snapshotted per violation; one payment per violation (no partial payments); no dismissal/waiver flow is specified, so none exists. | **Yes**. |
| 22 | Ledger corrections | Compensating entries are required by the spec but no operation/permission/role is defined for them yet; the ledger table accepts a `REVERSAL` source for when it is. | **Yes**. |

| 23 | Late-report approval chain (ADR-050) | Admin/Super Admin authorise (`quarter.score.amend`); the BU Lead files; a `weekly_report.review` holder reviews; a `quarter.score.amend` holder who is **not the reviewer** applies. The authoriser may also apply. The spec requires a reason and an approval but names no segregation of duties, so reviewer ≠ applier is the added control. | **Yes** — confirm the chain. |
| 24 | Late report needs finished tasks | A late report is scored on submission, so every task must be Done/Not done before it can be submitted (`TASK_STATUS_REQUIRED`). | Confirm. |
| 25 | Compliance after an accepted late report | `weekly_compliance` stays `NON_COMPLIANT` (history is not rewritten); only the score is amended. | **Yes** — the spec leaves the compliance effect to the exception decision. |
| 26 | Rejected late reports | A submitted late report can be rejected (exception `REVOKED`, report relocked, score unchanged). Not re-submittable under the same exception; a new authorisation is needed. | Confirm. |
| 27 | Holiday amendment permission (ADR-051) | `quarter.score.amend` (Admin, Super Admin) for both directions, single step, mandatory reason; HR's `reporting.period.holiday.manage` covers only the ordinary pre-lock declaration. 06-ROLES says post-lock changes use "the separately authorised amendment path" without naming the permission. | **Yes** — confirm permission and whether a second approver is wanted. |
| 28 | Reversing a locked holiday | Missing-report zeros are recorded retroactively for every expected BU without a score, with `NON_COMPLIANT`; no automatic late-report exception. The spec says eligibility changes create a new snapshot but does not say whether reinstated weeks should score zero. | **Yes** — alternative is to require explicit exceptions before reversal. |
| 29 | Who must use MFA (ADR-052) | SUPER_ADMIN, ADMIN, FINANCE (legacy ADR-023). HR (approves attendance amendments) and Presenter (reviews reports) are optional. Table `mfa_required_roles` is the single place to change it. | **Yes** — confirm the role list. |
| 30 | Step-up window and scope | 15 minutes after the last TOTP check, on the routes listed in ADR-052. Not applied to routine writes. | Confirm. |
| 31 | Lost-authenticator recovery | Administrator reset only (no recovery codes, no email-based bypass): safest for elevated roles, but a locked-out sole Super Admin needs database access. | **Yes** — decide whether to add one-time recovery codes. |
| 32 | Password policy | 12+ characters, upper/lower/digit, small deny-list. No breached-password (HIBP) check and no expiry/rotation (NIST advises against forced rotation). | Confirm. |
| 33 | Organisation score (ADR-053) | The application defines none. Reports show "average of BU scores" labelled *pending approval*. | **Yes** — define the official organisation-level score, or confirm the average. |
| 34 | Compliance rate and "on time" | Compliance rate = compliant ÷ (compliant + non-compliant) finalised, non-holiday expected weeks, read from the compliance record. "Submitted before content lock" is shown as an informational, unapproved measure. | **Yes** — is the final lock the only deadline? |
| 35 | Governance priority bands | HIGH over 7 days, MEDIUM over 3, otherwise LOW. No service-level targets exist. | **Yes** — provide approved targets. |
| 36 | Sub-KR trend threshold | IMPROVING above +2 points/week, DECLINING below −2, over the last 6 weeks with goals. | Confirm. |
| 37 | Forecast method and minimum history | Average or fitted trend by back-test; none with under 4 scored weeks; 95% range. | Confirm; an approved forecasting policy would replace it. |
| 38 | Export row cap and snapshot scope | 20,000 rows; snapshots organisation-wide only; `reports.snapshot` held by Admin, Super Admin, Executive, Director. | Confirm. |
| 39 | Report access by role | `reports.view/export/build` for all eight roles (scope narrowed by RLS); finance report needs a finance permission. | **Yes** — confirm, e.g. whether HR/Presenter exports are allowed. |
| 40 | Percentage display | Shown to one decimal (`50.0%`); stored and exported precision unchanged (ADR-055). | Confirm that exports should keep full precision. |
| 41 | Week label | `Week 14, 30 Mar – 5 Apr 2026` everywhere, from one formatter; ISO week numbers and Africa/Lagos dates. | Confirm. |
| 42 | Last Week hint scope | Tasks recorded Not Done for the BU in the calendar week before; unfinalised weeks list recorded Not Done only and count undefined ones. | Confirm whether a presenter may open it for every BU or only the one on screen (today: any BU the role may view). |
| 43 | Import: first entity and policies | Employees; policies stop / skip / update; atomic commit; employee records only. | **Yes** — which other imports are needed (BUs, strategy, history)? |
| 44 | Import: limits | 2 MB, 2000 rows, .csv and .xlsx only. | Confirm or raise. |
| 45 | Import: update policy | Existing people can have name, Business Unit and status changed by import, with a Business Unit move shown as a notice. | Confirm that a move should be allowed by import. |
| 46 | What counts as a closed week | Final-locked, or in a locked quarter: those amendments need a request and a second Admin (ADR-058). | Confirm. |
| 47 | Ledger reversal roles | Request: Finance, Admin, Super Admin. Approve and post: Finance, Super Admin, never the requester. Emergency: Super Admin only (ADR-059). | **Yes** — confirm the roles and whether the approver may also post. |
| 48 | Reversing a violation payment | Posts the compensating entry only; the violation stays settled. | **Yes** — should the violation reopen, and may it be paid again? |
| 49 | Reversal and committed money | A payment cannot be reversed if that would take money already committed to approved disbursements. | Confirm. |
| 50 | Recovery codes | Ten codes of 60 bits for every role; using one removes the authenticator and ends other sessions (ADR-060). | Confirm, and say whether ordinary roles should be offered codes. |
| 51 | Break-glass | Server script with operator, reason and confirmation; two people present; a second Super Admin is expected. | **Yes** — who is the operator and the witness, and where is the incident log kept? |
| 52 | Reminder defaults | 24 and 6 hours before the content lock, at most two per person per week, Business Unit Leads only (ADR-061). | Confirm; say whether a final-lock or review reminder is wanted. |
| 53 | Which events are emailed | The list in `email_event_types`; security events mandatory; 48-hour expiry; plain text only. | Confirm the list and the expiry. |
| 54 | Email provider | None chosen. The application supports SMTP and a file transport for development. | **Yes** (ADR-054 #8). |
| 55 | Business Unit import | Codes upper-cased, 2 to 20 characters; deactivation leaves people assigned. | Confirm. |
| 56 | Who may correct a session outcome | HR, Admin and Super Admin ask; Admin and Super Admin approve and execute; three different people unless the Super Admin uses the emergency path (ADR-063). | **Yes** — confirm roles. |
| 57 | Correction blocked by amendments | A skipped session cannot be reopened if attendance amendments already refer to its roster; the earlier roster is archived, never deleted. | **Yes** — say whether amendments should instead be cancelled with it. |
| 58 | Who may change strategy in an active quarter | Admin and Super Admin ask; Admin, Super Admin and Executive decide; never the requester (ADR-064). | **Yes** — confirm roles. |
| 59 | Key-result limit | At most four key results per quarter, retired ones included, so history stays comparable (`KR_LIMIT_EXCEEDED`). | Confirm whether retired ones should free a slot. |
| 60 | Reversed violation payment | The violation returns to unpaid; the payment row stays immutable and a later payment is a new row (ADR-065). | **Yes** — confirm the default. |
| 61 | Refused-request audit | Permission and scope refusals are audited, at most one per person and route per minute, without request content (ADR-067). | Confirm the throttle and retention. |
| 62 | Performance budgets | Pages p95 1500 ms, API p95 600 ms at six concurrent requests, measured on a development laptop (docs/27). | **Yes** — set real budgets for the production host. |
| 63 | Which updates need approval | Governance-critical configuration only: roles and permissions, authenticator requirement, lock times, violation types and fines, penalty rate, reminders and email, Business Unit reporting status, retention. Ordinary administration (users, Business Units, profiles) stays audited and single-step (ADR-068). | Agreed in principle ("all updates must require approval"); say if user and Business Unit changes should also need approval. |
| 64 | Who approves | A different person with `config.approve` (Admin, Super Admin); protected changes need a Super Admin and a fresh authenticator check; a Super Admin may apply a change alone only through the audited emergency path. | **Yes** — I chose these for you; confirm. |
| 65 | Lock schedule effect | A new schedule applies to weeks generated after it is approved, which today means from the next quarter to be activated; time zone and Monday start are fixed (ADR-070). | **Yes** — say whether a faster effect (rolling generation of weeks) is worth rewriting the calendar readers. |
| 66 | Role deletion | Any role, including the shipped eight, can be deleted if holders are moved and the last holder of a critical permission remains (ADR-069). | Agreed by the owner. |
| 67 | Conflicting permissions | Disbursement create with approve or disburse, and attendance amendment request with approve, cannot be combined on a role by a change; the shipped roles' existing combinations are kept. | **Yes** — confirm the pairs. |
| 68 | Retention periods | Read notifications 12 months, finished emails 90 days (3–120 months and 7–730 days allowed); import rows are kept because they are immutable (ADR-072). | **Yes** — confirm the defaults. |
| 69 | Audit export | At most 10,000 rows per file, audited, for people with `audit.read`. | Confirm the cap. |
| 70 | Health thresholds | Scheduler silent over 5 minutes, oldest queued email over 60 minutes (`src/lib/health.ts`). | Confirm. |
| 71 | Currency and time zone | Not configurable: Naira everywhere and Africa/Lagos fixed (ADR-070, ADR-072). | Say if another currency or zone is ever needed. |
| 72 | Hosting, scheduler, email provider, data location | Recommended in docs/32 section 1: hosted Supabase with point-in-time recovery; the container image on any container host near it; a one-minute scheduler container or platform cron; any SMTP provider on a domain you control; data location decided with legal advice (ADR-073). | **Yes** — the owner chooses; nothing is decided or provisioned. |
| 73 | Who may approve integrations | A Super Admin (the topic is protected); an Admin may ask, test and see (ADR-076). | **Yes** — confirm. |
| 74 | Where secrets live | Encrypted in the database with a key in the server environment; losing the key loses only the secrets. A cloud key-management service was not used. | **Yes** — say if one is required. |
| 75 | One email service, one AI provider | Only one of each may be switched on at a time; webhooks may be many. | Confirm. |
| 76 | What a webhook carries | Audit action, entity type and id, outcome, actor role, time, correlation id; never values or reasons. | **Yes** — confirm what may leave. |
| 77 | AI provider | Configured and tested only; no feature sends data to it yet. | **Yes** — decide which features may use it and what data may leave (data-protection review) before any is built. |

## C. Not yet built (explicit backlog)

Milestone 3a is done (late-report score amendment, ADR-050). Milestone 3b is done (holiday amendment/reversal, ADR-051). Remaining milestone 3 / hardening:
session-outcome correction workflow, ledger reversal operation, Milestone 4 is done (MFA/TOTP, step-up, password forgot/reset/change, CSP; ADR-052). Milestone 5 is done (Playwright E2E + axe gate in CI). Milestone 6 is done for the data that exists (Reports module, ADR-053); decisions 2 (two-person holiday amendments), 3, 5, 6, 7, 8 and 9 of ADR-054 are recorded but not built. Remaining: production email provider (SMTP) setup, E2E + CI axe gate (axe was run manually on every screen: zero violations), dependency/performance review,
backup-restore rehearsal, data-migration tooling, evidence file storage for attendance amendments (references only today),
bulk imports, partial-quarter/BU lifecycle rules (DEC-004), per-user notification preferences and email delivery.

## D. Verification summary

- 34 unit tests (scoring vectors, penalty arithmetic, quarterly mean/N-A, WAT lock boundaries, SMART engine).
- 60 database integration tests: milestone 1 (lock boundaries, execution rules, final-lock idempotency, integrity workflow,
  holiday, RLS, audit immutability, privilege escalation) plus milestone 2 (PRESENT-by-default roster, atomic/idempotent/
  all-or-nothing Skip OKR, immutable finalised rosters, amendments incl. self-approval, stale and duplicate protection,
  violation→ledger atomicity, ledger immutability and non-negative balance, disbursement segregation of duties, commitments,
  reconciliation, finance RLS).
- 5 true multi-connection concurrency tests (`npm run test:concurrency`): simultaneous approvals cannot overdraw the fund,
  parallel releases post one debit, parallel payments credit once, parallel Skip is not mixed, parallel amendments leave one pending.
- Milestone 3a: 6 DB tests (`tests/db/late_report.test.ts`: full flow on a locked quarter, snapshot/compliance/audit immutability, permission, segregation, idempotency, scoping) and 3 HTTP tests (`tests/api/late-report.api.test.ts`).
- Milestone 3b: 4 DB tests (`tests/db/holiday_amendment.test.ts`: post-lock declare, retroactive reverse with backfill, locked-quarter amendment, dashboard/RLS) and 2 HTTP tests.
- Milestone 4: 4 DB tests (`tests/db/mfa.test.ts`), 4 unit tests (password policy), 13 HTTP tests (`tests/api/security.api.test.ts`: elevated-role challenge, wrong code, enrol/remove, admin reset guards, forgot/reset/change, full emailed-link flow against the real auth server, CSP). axe: zero violations on login (both steps), forgot/reset password and account security.
- Milestone 5: 25 Playwright tests (`tests/e2e`, `npm run test:e2e`; CI job `e2e`): auth/MFA journeys, the full weekly lifecycle (draft → submit → content lock → execute → final lock → score 50.00 → review), late-report and holiday amendments through the UI, axe (WCAG 2.2 A/AA + best practice) on every screen per role, signed-out screens, a dialog, and no horizontal overflow at 375 px. Defects found by writing them and fixed: the edit lease could be released after a quick remount (ordering guard added), and the holiday amendment reused one idempotency key for declare and reverse.
- Milestone 6: 12 DB tests (`tests/db/reports.test.ts`: reconciliation to snapshots and compliance, BU scope, MFA-incomplete sessions, finance blanks, snapshots immutable, saved-report sharing, export audit), 32 unit tests (statistics, forecast, insights rules, assistant, sanitising, canonical JSON), 12 HTTP tests (`tests/api/reports.api.test.ts`) and 8 Playwright tests (`05-reports.spec.ts`) plus axe on every report page.
- Display, hint, landing, import (ADR-055 to 057): 103 unit tests in total (formatters, metric easing, week label, import rules: 20 added), 8 DB tests for the Last Week hint (`tests/db/last_week.test.ts`: Week N versus N-1, Done / other BU / older excluded, year boundary, holiday, no report, scope, no mutation), 6 DB tests for the import commit (`tests/db/employee_import.test.ts`), 14 HTTP tests (`tests/api/last-week.api.test.ts`, `tests/api/import.api.test.ts`) and 18 Playwright tests (91 in the whole suite) (`06-last-week`, `07-landing-login`, `08-employee-import`, `09-metric-cards`).
- Milestone 8 (ADR-058 to 062): 128 unit tests in total, 138 DB tests (holiday two-person, ledger reversal, recovery codes, reminders and email, Business Unit import), 77 HTTP tests across 11 files, 112 Playwright tests (specs 08 to 13 cover the import wizards, metric cards, drill-down, ledger reversal, recovery and email settings).
- 17 HTTP tests (unauthenticated, CSRF origin, mass-assignment, RBAC, cross-BU, anti-enumeration, full violation→disbursement flow).
- axe-core (WCAG 2.2 A/AA + best practice): zero violations on login, dashboards, governance, roster (draft and skipped), amendments,
  violations, finance.

**Resolved defect.** `POST /api/internal/jobs/run` twice answered 500 during end-to-end runs. The cause was the development clock restarting the database REST layer while a request was in flight; the clock script now waits until the API answers again before returning. No data was affected (the jobs are idempotent). It has not recurred since; if it does in a real environment, check the REST layer's logs first.

| 63 | Branding (name, logo, favicon, main colour) is applied immediately and audited, with no second-person approval, because it changes no score, balance or permission. | Yes: confirm, or ask for it to go through the approval engine. |
| 64 | A Department is a unit that does not file weekly reports; it is not a unit inside a Business Unit. Staff belong to exactly one unit. | Yes: confirm there is no Department-under-BU hierarchy. |
| 65 | Dashboard completion rate = done tasks / all tasks; average score = mean of stored weekly scores of reportable, scored weeks; on-time = submitted before the content lock. | Yes: confirm the definitions. |

| 66 | Landing and sign-in content is applied on save and audited, with no second-person approval (ADR-077); it changes no score, balance or permission. | Yes: confirm, or ask for it to go through the approval engine. |
| 67 | The built-in landing page copy (features, steps, trust points) is the previous wording; the figures band, gallery and testimonial are hidden by default so no invented numbers or quotes appear. | Yes: confirm the default wording. |
| 78 | Historical import: who and how | Super Admin only, no second approver, authenticator code and typed confirmation, rehearsal first, recomputed through the normal engine (ADR-077). | Owner decided; confirm a no-approver action is acceptable with step-up as its only extra check. |
| 79 | Placeholder strategy for historical quarters | Where a past quarter has no strategy a placeholder objective, key results and Sub-KRs are created, titled "(historical, imported)". | **Yes** — supply real wording, or confirm placeholders. |
| 80 | Back-dating Business Units | A unit's creation date is moved back to its first week in the file so earlier weeks are not counted against it. | **Yes** — confirm. |
| 81 | Imported reports' state | Recorded as submitted and reviewed, so they score fully without a review step. | Confirm. |
| 82 | Weeks without rows | Not scored unless "also score weeks with no rows" is chosen; then a unit with no row is scored as a missed report. | **Yes** — choose the default per quarter. |
| 83 | Lock times of historical weeks | Weeks created by the import use the current lock schedule; they are already closed so nothing depends on the times. | Confirm. |
| 84 | No rollback after commit | The application never deletes reports, so a committed import is final; protection is the rehearsal and a backup. | **Yes** — confirm, or ask for a compensating "void batch" feature. |
| 85 | Reserved permissions | A reserved permission may only sit on a role that holds roles.manage (ADR-077). | Confirm the list. |
| 86 | Roster flag | A person taken off the attendance roster keeps their sign-in; existing rosters are not changed, only new ones (ADR-078). | Confirm. |
| 87 | Starting violation types | Phone violation (medium) 5,000; Late coming (low) 3,000; Absent (medium) 5,000 NGN, taken from the old fine types. The criticality levels are my choice, the old application had none. | **Yes** — confirm criticality, or edit under Governance. |
| 88 | Strategy import scope | Fills empty, non-active quarters only; ended quarters are stored locked, others planned. Active quarters keep the change-request rule (ADR-079). | Confirm. |
| 89 | Sign-in import control | No approval, a fresh authenticator code and the same role rules as Add user (ADR-080). | **Yes** — confirm, or ask for an approval step on both paths. |
| 90 | Sign-in links | One-time links are shown once and downloadable; they are not stored or emailed (no email provider is configured). | Confirm. |

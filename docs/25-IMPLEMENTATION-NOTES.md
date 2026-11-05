# 4CORE-OKR Implementation Notes

Where the specification is silent, ambiguous or internally inconsistent, this file records what the implementation does
and why, so a business decision can later replace it. Nothing here is a silently invented business rule: each item is
the safest non-destructive behaviour (`00-SOURCE-OF-TRUTH.md` — Rule for ambiguity).

## A. Specification conflicts and how they were resolved

| # | Conflict | Resolution |
|---|---|---|
| 1 | `12-API-CONTRACT` listed `POST /governance-sessions/{id}/cancel`; every other document forbids a CANCELLED outcome. | Not implemented. Only SCHEDULED / HELD / SKIPPED exist. The false entry was removed from `12-API-CONTRACT` on 2026-10-20. |
| 2 | `05-USER-JOURNEYS` UJ-15 debits the ledger on approval; ADR-022, `16-FINANCIAL-CONTROLS` and BR-FIN-007 separate approval from disbursement. | **Built:** the DEBIT posts at the DISBURSED step (ADR-041/046, DEC-009 still open). |
| 3 | Violation status vocabularies differ (ADR-022 vs `08-STATE-MACHINES`). | **Built:** `OPEN → PAID \| DEDUCTION_RECORDED` (ADR-046). |
| 4 | ADR numbering: the August package used ADR-033 for an attendance question; the current package uses ADR-031 / ADR-033 differently. | Current package numbering is used. |

## B. Behaviour chosen where the specification is silent

| # | Topic | Behaviour | Needs owner decision? |
|---|---|---|---|
| 1 | Task execution window | BU Leads can set `UNDEFINED → DONE/NOT_DONE` only **after content lock** (Tue 18:00) until final lock, exactly as `04-BUSINESS-RULES` BR-WR-010 reads. Before content lock the task definition is editable but its status is not. | Confirm. |
| 2 | Report creation cut-off | A BU can create its report from Monday 00:00 until content lock. After content lock nothing can be added, so a missing report stays missing (0.00 / NON_COMPLIANT at final lock). | Confirm. |
| 3 | Report review | ADR-038: Presenter/Admin/SuperAdmin marks a final-locked, submitted report REVIEWED (audited, non-blocking). Provides the "normal review" referenced by skipped-week rules. | Settled by ADR-038; whether a rejection comment is mandatory is still open (DEC-016). |
| 4 | Provisional quarter scores (DEC-020) | A quarterly snapshot is `PROVISIONAL` until the quarter is locked, every eligible week is finalised **and** every submitted report is reviewed. Pending review is never scored as zero (ADR-081). | Settled by ADR-081. |
| 5 | Week → quarter assignment (DEC-004) | A reporting week belongs to the quarter containing its Monday. Reporting weeks keep their own lifecycle even after their quarter locks (a week whose Monday is in the last days of a quarter finalises after the next quarter starts). | **Yes**. |
| 6 | Which BUs report weekly | **Every ACTIVE BU is expected to report** (including an "HQ"/admin BU if one exists). A BU created mid-quarter is excluded from earlier weeks (`created_at` after the week ended). The per-unit `reports_weekly` flag (default true) now decides this, and `unit_type` derives from it (ADR-048, ADR-078). | Settled by ADR-048; confirm that new units default to reporting. |
| 7 | Go-live mid-quarter | Weeks that have already ended when a quarter is activated are finalised as missing-report zeros by the scheduler, per the fixed-denominator rule. | **Yes** — production go-live should align with a quarter start, or an authorised exception / start-week setting is needed. |
| 8 | Penalty rate | No default. APPLY is impossible until Admin/SuperAdmin configures a rate; WAIVE needs only a reason. | Provide the rate. |
| 9 | Integrity correction timing | Allowed after content lock. Refused (`QUARTER_LOCKED`) once the week is final-locked **and** its quarter is locked; the late-report amendment path (ADR-050) is separate and does not use integrity corrections. | Confirm. |
| 10 | Strategy edits after activation (DEC-007) | Titles/descriptions of an ACTIVE quarter's objective, KRs and Sub-KRs can be edited (audited); nothing can be deleted; new Sub-KRs can be added; KR count is capped at 4. Locked quarters are read-only. | **Yes**. |
| 11 | Edit lease (DEC-008) | 5-minute TTL, 2-minute heartbeat, one active lease per report; expiry is lazy. No admin takeover yet. | Confirm values. |
| 12 | Calendar quarters | Quarters are calendar quarters; the Annual Theme year is the calendar year. | Confirm. |
| 13 | Holiday scope | Whole reporting weeks only; declaring a week that already has submitted reports or is final-locked returns `HOLIDAY_AMENDMENT_REQUIRED` and goes through the audited amendment path, which also handles reversal (ADR-051, ADR-058). | Settled by ADR-051/058; the zero-score effect on reversal is row 28. |
| 14 | Role → permission matrix | See `supabase/migrations/…_foundation.sql`. Derived from `06-ROLES-PERMISSIONS` scope rules; new permissions: `weekly_report.review`, `reporting.week.manage`, `strategy.quarter.manage`, `dashboard.executive.view`, `presentation.view`. | Review. |
| 15 | Session ↔ week link | A session presents the week that final-locks on that Tuesday; Skip activates the summary requirement on that week's reports (ADR-042). | **Yes**. |
| 16 | Skip while a draft roster exists | Allowed (draft discarded); refused once finalised (ADR-043). | Confirm. |
| 17 | Disbursement commitments | Approved-but-unreleased requests reduce the *available* balance, so approvals cannot over-commit (ADR-046). | Confirm. |
| 18 | "Designated HR approver" | Implemented as per-user permission designations (ADR-047). Admin/SuperAdmin hold approve by default. | Confirm. |
| 19 | Reviewer comment on rejection | Recorded, **not** mandatory (DEC-016). | **Yes**. |
| 20 | BU that does not report | `reports_weekly` flag (ADR-048). | Settled by ADR-048; row 6 covers the default. |
| 21 | Violation scope | Fine/criticality snapshotted per violation; one payment per violation (no partial payments); no dismissal/waiver flow is specified, so none exists. | **Yes**. |
| 22 | Ledger corrections | Compensating entries: a reversal is requested against a ledger entry, decided by an independent approver, and posted as a `REVERSAL` entry that references the original (ADR-059). Roles are in row 47. | Settled by ADR-059; confirm the roles in row 47. |
| 23 | Late-report approval chain (ADR-050) | Admin/Super Admin authorise (`quarter.score.amend`); the BU Lead files; a `weekly_report.review` holder reviews; a `quarter.score.amend` holder who is **not the reviewer** applies. The authoriser may also apply. The spec requires a reason and an approval but names no segregation of duties, so reviewer ≠ applier is the added control. | **Yes** — confirm the chain. |
| 24 | Late report needs finished tasks | A late report is scored on submission, so every task must be Done/Not done before it can be submitted (`TASK_STATUS_REQUIRED`). | Confirm. |
| 25 | Compliance after an accepted late report | `weekly_compliance` stays `NON_COMPLIANT` (history is not rewritten); only the score is amended. | **Yes** — the spec leaves the compliance effect to the exception decision. |
| 26 | Rejected late reports | A submitted late report can be rejected (exception `REVOKED`, report relocked, score unchanged). Not re-submittable under the same exception; a new authorisation is needed. | Confirm. |
| 27 | Holiday amendment permission (ADR-051) | Ordinary pre-lock declaration: HR's `reporting.period.holiday.manage`, single step, mandatory reason. Amendments that touch a submitted or final-locked week (and reversals) need `quarter.score.amend` to request and a second Admin/Super Admin to decide (ADR-058). | Settled by ADR-051/058; confirm the permission and the two-person rule. |
| 28 | Reversing a locked holiday | Missing-report zeros are recorded retroactively for every expected BU without a score, with `NON_COMPLIANT`; no automatic late-report exception. The spec says eligibility changes create a new snapshot but does not say whether reinstated weeks should score zero. | **Yes** — alternative is to require explicit exceptions before reversal. |
| 29 | Who must use MFA (ADR-052) | SUPER_ADMIN, ADMIN, FINANCE (legacy ADR-023). HR (approves attendance amendments) and Presenter (reviews reports) are optional. Table `mfa_required_roles` is the single place to change it. | **Yes** — confirm the role list. |
| 30 | Step-up window and scope | 15 minutes after the last TOTP check, on the routes listed in ADR-052. Not applied to routine writes. | Confirm. |
| 31 | Lost-authenticator recovery | Administrator reset, plus ten single-use recovery codes that remove the authenticator and end other sessions; no email-based bypass. A locked-out sole Super Admin still needs the break-glass script (row 51) and database access (ADR-060). | Settled by ADR-060; row 50 covers the code policy. |
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
| 48 | Reversing a violation payment | Posts the compensating entry only; the violation stays settled. | **Decided 2026-11-04: no.** A violation is never reopened and never paid twice (ADR-086). |
| 49 | Reversal and committed money | A payment cannot be reversed if that would take money already committed to approved disbursements. | Confirm. |
| 50 | Recovery codes | Ten codes of 60 bits for every role; using one removes the authenticator and ends other sessions (ADR-060). | Confirm, and say whether ordinary roles should be offered codes. |
| 51 | Break-glass | Server script with operator, reason and confirmation; two people present; a second Super Admin is expected. | **Yes** — who is the operator and the witness, and where is the incident log kept? |
| 52 | Reminder defaults | 24 and 6 hours before the content lock, at most two per person per week, Business Unit Leads only (ADR-061). | Confirm; say whether a final-lock or review reminder is wanted. |
| 53 | Which events are emailed | The list in `email_event_types`; security events mandatory; 48-hour expiry; plain text only. | Confirm the list and the expiry. |
| 54 | Email provider | None chosen. The application supports SMTP and a file transport for development. | **Yes** (ADR-054 #8). |
| 55 | Business Unit import | Codes upper-cased, 2 to 20 characters; deactivation leaves people assigned. | Confirm. |
| 56 | Who may correct a session outcome | HR, Admin and Super Admin ask; Admin and Super Admin approve and execute; three different people unless the Super Admin uses the emergency path (ADR-063). | **Yes** — confirm roles. |
| 57 | Correction blocked by amendments | A skipped session cannot be reopened if attendance amendments already refer to its roster; the earlier roster is archived, never deleted. | **Decided 2026-11-04: cancel them** with the correction, history kept (ADR-086). |
| 58 | Who may change strategy in an active quarter | Admin and Super Admin ask; Admin, Super Admin and Executive decide; never the requester (ADR-064). | **Yes** — confirm roles. |
| 59 | Key-result limit | At most four key results per quarter, retired ones included, so history stays comparable (`KR_LIMIT_EXCEEDED`). | Confirm whether retired ones should free a slot. |
| 60 | Reversed violation payment | The violation stays settled; the payment row stays immutable and is shown as reversed (ADR-086, supersedes ADR-065). | Decided 2026-11-04. |
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
| 78 | Historical import: who and how | Super Admin only, no second approver, authenticator code and typed confirmation, rehearsal first, recomputed through the normal engine (ADR-077). | Owner decided; confirm a no-approver action is acceptable with step-up as its only extra check. |
| 79 | Placeholder strategy for historical quarters | Where a past quarter has no strategy a placeholder objective, key results and Sub-KRs are created, titled "(historical, imported)". | **Yes** — supply real wording, or confirm placeholders. |
| 80 | Back-dating Business Units | A unit's creation date is moved back to its first week in the file so earlier weeks are not counted against it. | **Yes** — confirm. |
| 81 | Imported reports' state | Recorded as submitted and reviewed, so they score fully without a review step. | Confirm. |
| 82 | Weeks without rows | Not scored unless "also score weeks with no rows" is chosen; then a unit with no row is scored as a missed report. | **Decided 2026-11-04:** scoring is weekly, so the default is to score them as missed reports (ADR-086). |
| 83 | Lock times of historical weeks | Weeks created by the import use the current lock schedule; they are already closed so nothing depends on the times. | Confirm. |
| 84 | No rollback after commit | The application never deletes reports, so a committed import is final; protection is the rehearsal and a backup. | **Decided 2026-11-04:** a Super Admin-only void inside a rollback window is wanted. **Built for every import (ADR-087, ADR-088)**: employees, Business Units, strategy, sign-ins and history. |
| 85 | Reserved permissions | A reserved permission may only sit on a role that holds roles.manage (ADR-077). | Confirm the list. |
| 86 | Roster flag | A person taken off the attendance roster keeps their sign-in; existing rosters are not changed, only new ones (ADR-078). | Confirm. |
| 87 | Starting violation types | Phone violation (medium) 5,000; Late coming (low) 3,000; Absent (medium) 5,000 NGN, taken from the old fine types. The criticality levels are my choice, the old application had none. | **Yes** — confirm criticality, or edit under Governance. |
| 88 | Strategy import scope | Fills empty, non-active quarters only; ended quarters are stored locked, others planned. Active quarters keep the change-request rule (ADR-079). | Confirm. |
| 89 | Sign-in import control | No approval, a fresh authenticator code and the same role rules as Add user (ADR-080). | **Yes** — confirm, or ask for an approval step on both paths. |
| 90 | Sign-in links | One-time links are shown once and downloadable; they are not stored or emailed (no email provider is configured). | Confirm. |
| 91 | Branding | Name, logo, favicon and main colour are applied immediately and audited, with no second-person approval, because it changes no score, balance or permission. | Yes: confirm, or ask for it to go through the approval engine. |
| 92 | Department | A Department is a unit that does not file weekly reports; it is not a unit inside a Business Unit. Staff belong to exactly one unit. | Yes: confirm there is no Department-under-BU hierarchy. |
| 93 | Dashboard completion rate | Done tasks / all tasks; average score = mean of stored weekly scores of reportable, scored weeks; on-time = submitted before the content lock. | Yes: confirm the definitions. |
| 94 | Landing and sign-in content | Applied on save and audited, with no second-person approval (ADR-082); it changes no score, balance or permission. | Yes: confirm, or ask for it to go through the approval engine. |
| 95 | Landing page copy | The built-in landing page copy (features, steps, trust points) is the previous wording; the figures band, gallery and testimonial are hidden by default so no invented numbers or quotes appear. | Yes: confirm the default wording. |

## C0. Defaults accepted on 2026-11-04

The owner asked for the best option to be chosen on every other open row. Every row marked "Yes" or "Confirm" above is accepted exactly as written, with these choices where a row offered alternatives: #42 any Business Unit the role may view; #54/#72 no provider is provisioned until the owner picks one (SMTP is supported); #79 placeholders for historical strategy; #87 criticality as built (Phone medium, Late coming low, Absent medium), editable under Governance; #89 no approval step on the sign-in import, a fresh authenticator code stays required; #91 and #94 branding and landing content apply immediately and are audited; #62 budgets stay the development-laptop figures until a production host exists. Items that need an outside fact (email provider, hosting, production performance budgets, break-glass operator and witness in row 51, data location) are still open because no default can supply them.

## C. Not yet built (explicit backlog)

Built since this section was first written: session-outcome correction (ADR-063), ledger reversal (ADR-059), recovery codes (ADR-060), reminders and email outbox (ADR-061), employee, Business Unit, strategy, historical and sign-in imports (ADR-056, ADR-077, ADR-079, ADR-080), per-user notification preferences, and the Playwright + axe gate.

Still open:
- a production email provider and hosting (ADR-054 #8; the owner has not chosen),
- one calendar-configuration object (ADR-054 #4),
- evidence file storage for attendance amendments - the API stores references only (`attendance_amendment_requests.evidence_refs`),
- dependency and performance review against production hardware,
- backup-restore rehearsal,

## D. Verification summary (2026-10-20)

- `npm run test:unit`: 26 files, 216 tests passing.
- Database lane: 35 files under `tests/db`; HTTP lane: 19 files under `tests/api`; concurrency lane: 1 file under `tests/concurrency`. The database lane needs a seeded, reset database and is not part of documentation-only changes.
- End-to-end: 23 Playwright specs under `tests/e2e` (auth/MFA, full weekly lifecycle, amendments, imports, reports, ledger reversal, recovery, email settings), with an axe check (WCAG 2.2 A/AA + best practice) on each screen per role.
- axe: zero violations reported on the screens exercised.
- Earlier milestone counts were removed because they no longer matched the suites.

**Resolved defect.** `POST /api/internal/jobs/run` twice answered 500 during end-to-end runs. The cause was the development clock restarting the database REST layer while a request was in flight; the clock script now waits until the API answers again before returning. No data was affected (the jobs are idempotent). It has not recurred since; if it does in a real environment, check the REST layer's logs first.

## OKR Session Notes & Meeting Intelligence (ADR-089 to ADR-093)

Built as an extension of the app (no new identity, unit, calendar, permission, notification, audit or file system). Specification and assessments: `40-SESSION-NOTES.md`.

**Applying it.** Three additive migrations, `20261105000001` to `20261105000003`. They were applied only to the disposable **test stack**; the owner's real database has not been touched. Before applying them to the real database run `npm run db:backup`, then the usual migration step. The three files only add objects, plus two guarded in-place patches (the grant allow-list in `lock_down_function_grants()` and one line in `run_scheduled_jobs()`, each skipped if already applied).

**Known limits**
1. The editor now has a visual mode (default) and a text mode over the same safe markdown (ADR-091, ADR-094). Pasted rich content becomes plain text; tables are edited in the grid, column count is fixed at insertion.
2. Mentions work (ADR-094): only people who can read the note are told; there is no `@` autocomplete inside the text, only the Mention menu of the session's participants.
3. Attachments are checked by allowed type, file signature, size and the scan in ADR-094. Without ClamAV only the built-in inspection runs, which is not an antivirus. A removed attachment is hidden, not erased. Set `CLAMAV_HOST` in production.
4. Note history keeps every state that settled for 60 seconds or longer plus every amendment, reclassification, archive and restore; keystroke-level states inside a burst are not stored.
5. No live co-editing or presence: two editors are protected by version checks and a conflict screen.
6. Search uses PostgreSQL full-text search with the simple configuration (whole words, no stemming or typo tolerance).
7. The PDF of minutes is plain text (tables appear as lines with `|`); register exports use the Reports module's layout.
8. Reminders depend on the existing scheduler endpoint being called; in-app notices cannot be switched off per event (the app has no such setting), only email can (existing preference) and the global reminder switch.
9. Unit scope (`user_unit_scopes`) limits writing about a unit, as elsewhere; it does not hide sessions from readers.
10. `read_okr_people` lets anyone with a session permission see the names and units of active people (needed to invite and assign).
11. AI summaries are only as good as the configured provider and model; every proposal is discarded if it invents a reference or a figure.

**Open decisions for the owner**
1. Should recording and approving a decision be done by different people? Today a Presenter may do both (the facilitator is the authority in the room).
2. Should the person who reviews minutes differ from the person who drafted or finalises them? Today they may be the same.
3. Should an Executive or Director, rather than the Presenter, be the only holder of `session_decisions.approve`?
4. Should BU Leads be allowed to record risks or create actions for their own unit (today: Presenter only)?
5. Should confidential and management-only notes be covered by the retention settings (today session records are never purged)?
6. Should the Super Admin have an audited break-glass way to read content (today: none; only by being granted the permissions)?
7. Should verification be mandatory for high and critical priority actions (today it is chosen per action)?

**Regression.** No existing function, table or screen was changed apart from: three nav entries and one "+ Create" entry (`layout.tsx`, `shell.tsx` icon), a card on the Presentation page, six notification routes, six error codes, two lines of CSS-class block in `globals.css`, and the two guarded patches above.

**Test results (2026-11-04, test stack only).** Unit (`npx vitest run src`): 443 passed (55 are the session-notes tests: XSS, editor operations, autosave rules, minutes, AI guard, register reports). Database (`tests/db/session_notes.test.ts`): 40 passed. HTTP (`tests/api/session-notes.api.test.ts`): 9 passed (the storage service is not part of the test stack, so the upload test proves the clean-failure path). Browser (`tests/e2e/25-session-notes.spec.ts`): 10 passed, including zero axe violations. `tsc --noEmit` and eslint on the new code are clean. The role-matrix fixture `tests/db/fixtures/role-matrix.json` was updated for the new permissions. **Not yet run:** the whole database lane from a reset (`npm run test:db`), which the owner must run in their own terminal; the test database used here was not reset, so some older suites fail there for reasons unrelated to this module (leftover data).

## Executive Oversight, Commentary & Recommendations (ADR-096 to ADR-103)
Module description and security assessment: `41-EXECUTIVE-OVERSIGHT.md`. Migrations 20261106000001 to 20261106000004.

### Known limits
0. **Decided 2026-11-05 (owner):** commentary is advice only; no consequence for unanswered or declined items; a Presenter reads every unit (migration 20261106000005; this also lets Presenters read management-only comments); a unit lead cannot hide or share comments; closing is optional; the escalation defaults stay. The "open business decisions" below are settled by this.
1. **(Superseded by item 0)** Presenters read their own unit's commentary only.
2. **Compliance reports and attendance screens** do not have their own Executive Commentary button: commentary about compliance is made from Presentation mode, Performance, the weekly report or the historical snapshot, where the compliance status is shown. The `COMPLIANCE` module exists for later screens.
3. **Author filter** on the registers is "written by me" only; there is no list of authors to pick from.
4. **Visual editor**: comments use plain text with the safe markdown subset (bold, italic, lists, links), not the Session Notes visual editor.
5. **Attachments** are checked by type, signature, size and the built-in inspection (ADR-094); without ClamAV the built-in inspection is not an antivirus. A removed file is hidden, not erased.
6. **Reminders** run with the existing scheduler (hourly granularity of `run_scheduled_jobs`); the Resend/SMTP delivery of the optional emails is the existing outbox.
7. **No per-comment notification preferences** beyond the ten optional email event types.
8. **Browser coverage**: the browser suite was run in Chromium on the test stack only.

### Open business decisions
1. Who is the "relevant management contact" and the "senior authority"? Defaults are the author and the DIRECTOR role; Admin can change them (Oversight settings).
2. Should a persistently unanswered or declined advisory recommendation ever have a formal consequence? None is implemented (ADR-101); it needs an approved organisational rule.
3. Should Presenters see commentary on every unit they present?
4. Should a Director be able to close or withdraw an Executive's recommendation when the author is still active (currently: no; only when the author is no longer active)?
5. Retention: nothing is deleted; is a retention period wanted for management-only comments of departed staff?
6. Should the unit's lead be able to hide a SHARED comment from other members of the unit? (Currently every holder of the view permission in the unit reads it.)

### What the owner must run
- `npm run db:backup`, then apply the four migrations to the real local database (`npx supabase migration up --local`).
- In your own PowerShell, from the `4core-okr` folder: `npm run test:db` (resets the disposable test stack and runs every database test, including `executive_oversight.test.ts`).

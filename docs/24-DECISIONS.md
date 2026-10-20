# 4CORE-OKR Decision Log / ADRs

## ADR-001 — One Organisation, BU as Operational Tenant

**Status:** Accepted

Each BU is a tenant/security boundary inside one organisation.

## ADR-002 — BU Weekly Report Represents BU Commitment

**Status:** Accepted

The BU Lead is the operator; the report belongs to the BU.

## ADR-003 — Weekly Content Lock

**Status:** Accepted

Tuesday 18:00 WAT.

## ADR-004 — Weekly Final Lock

**Status:** Accepted

Following Tuesday 11:00 WAT.

## ADR-005 — Lock Independent of Physical Meeting

**Status:** Accepted

HELD and SKIPPED physical-session outcomes do not change reporting locks. An officially declared ORGANIZATION_HOLIDAY suspends the reporting obligation for the affected reporting week(s), suppresses missing-report consequences, and excludes those weeks from quarterly scoring.

## ADR-006 — Explicit Submission

**Status:** Accepted

Weekly report has a Submit Report action; submission does not immediately lock content.

## ADR-007 — Minimum Weekly Goals

**Status:** Accepted

Every BU must have at least one Goal; no fixed maximum.

## ADR-008 — Goal Weighting

**Status:** Accepted

Every Goal contributes equally to weekly score.

## ADR-009 — SMART Warning Only

**Status:** Accepted

SMART score is coaching/quality guidance and does not block submission.

## ADR-010 — Stretch Goal

**Status:** Accepted

A Goal may be explicitly classified as Stretch when no applicable Sub-KR exists. Stretch Goals contribute to score.

## ADR-011 — Integrity Correction

**Status:** Accepted

Presenter/Admin/SuperAdmin use the same correction workflow. SuperAdmin has no bypass.

## ADR-012 — Integrity Penalty Formula

**Status:** Accepted; business rule reaffirmed 2026-10-12

Each applied penalty is a percentage of the original BU weekly base score. Add all applicable applied penalty rates and apply the combined rate once to the original base score; do not deduct percentage points or compound sequentially. Formula: `finalScore = roundTo2Decimals(max(0, baseScore * (1 - sum(appliedPenaltyRates))))`, with rates represented as decimals. The final score floor is 0.00%. Round final scores to two decimal places consistently. Preserve original base score, individual rates, combined rate, formula/rule version and final score snapshot for audit. Worked examples: 80.00% with one 5% penalty = 76.00%; with two 5% penalties = 72.00%.

## ADR-013 — Financial Responsibility

**Status:** Accepted

HR/Admin raises disbursement requests; Finance approves/rejects.

## ADR-014 — NGN Only

**Status:** Accepted

All monetary values are NGN/₦.

## ADR-015 — Quarterly Execution

**Status:** Accepted; clarified by ADR-032 (Finding 3, confirmed 2026-10-13)

Quarterly execution score is the arithmetic mean over all non-holiday calendar reporting weeks in the quarter. NORMAL and SKIPPED-session weeks count; ORGANIZATION_HOLIDAY weeks are excluded. Missing-report zeros in reportable weeks remain in the denominator. See ADR-032 and ADR-033 for the full state and correction rules.

## ADR-016 — Strategy Lock

**Status:** Accepted

Previous quarter automatically becomes read-only at next quarter start.

## ADR-017 — Current Role Model

**Status:** Accepted

SUPER_ADMIN, ADMIN, BU_LEAD, PRESENTER, EXECUTIVE, DIRECTOR, HR, FINANCE.

## ADR-018 — Executive/Director Read Only

**Status:** Accepted

Executives/Directors are view-only unless another explicit role grants additional capability.

## ADR-019 — Ledger as Source of Truth

**Status:** Accepted

Financial ledger is append-only and authoritative.

## ADR-020 — No Generic High-Risk CRUD

**Status:** Accepted

Integrity, financial, locking, and other high-consequence operations use governed business endpoints/services.

## ADR-021 - Security Hardening: RLS Coverage, Route Guards, Append-Only Enforcement

**Status:** Accepted (2026-08 security audit remediation)

Decisions:

1. RLS is enabled on every table in the schema. Strategy hierarchy tables
   (annual_themes, quarters, quarterly_objectives, key_results,
   sub_key_results), reporting_weeks, report_edit_sessions, identity/RBAC
   tables and finance reference data now have explicit policies:
   authenticated read; mutation restricted to ADMIN/SUPER_ADMIN (strategy)
   or SUPER_ADMIN only (RBAC assignment). Implemented in migration
   006_security_hardening.sql.
2. mfa_otp_codes, email_logs and password_reset_tokens are RLS-denied to all
   client roles; server-side code accesses them exclusively through the
   service-role client.
3. financial_ledger_entries is append-only at the database layer via trigger;
   human roles may INSERT/SELECT but never UPDATE/DELETE (compensating-entry
   corrections only).
4. audit_logs are append-only at the database layer via trigger.
5. weekly_reports rows with status FINAL_LOCKED cannot be updated or deleted
   by any role at the database layer; the API additionally returns 403.
6. At most one payment per violation is enforced by a unique index on
   violation_payments(violation_id); payment APIs must remain idempotent.
7. Every API route handler performs application-layer authorization
   (getAuthContext + requireRole) in addition to RLS; mutating handlers use
   explicit field allowlists instead of raw body spread.
8. Identity resolution uses supabase.auth.getUser() (JWT verified) rather
   than getSession() (unverified cookie claim).

Consequences:

- Legacy ad-hoc updates to locked reports or ledger rows will now fail loudly
  at the database layer; any legitimate unlock/correction requires an
  explicit governed flow to be designed and audited.
- The duplicate-migration lineage (src/lib/db/migrations vs
  supabase/migrations) remains unresolved and is tracked as technical debt.

## ADR-022 - Financial Operations Are Transactional Database Functions

**Status:** Accepted (2026-08 security audit remediation)

Decisions:

1. All money movement executes inside Postgres SECURITY DEFINER functions
   (migration 007_finance_atomic.sql) rather than multi-step application
   calls: record_violation_payment() and decide_disbursement_request().
2. The authoritative fund balance is always SUM(ledger entries) computed
   inside the transaction while holding FOR UPDATE locks on the fund row.
   balance_after is derived server-side; clients never supply it.
3. Violation payment atomically inserts the payment, posts a ledger CREDIT
   and flips the violation to RESOLVED (the schema's CHECK constraint has no
   PAID status). Duplicate payments are rejected by the unique index on
   violation_payments(violation_id) and by conditional status checks.
4. Disbursement decisions enforce segregation of duties at the database
   layer (decider cannot equal requester), require a mandatory rejection
   reason, reject re-decision of non-PENDING requests, and validate
   available_balance >= requested_amount before approval. Decisions are
   audited inside the same transaction.
5. Approval does not post ledger entries; ledger DEBIT postings belong to
   actual cash release via the disbursements table (approval != cash release,
   per 16-FINANCIAL-CONTROLS.md).
6. API routes call these functions via RPC and map well-known raised
   exceptions to HTTP status codes; amounts are validated by
   parsePositiveAmount before invocation.
7. Violation routes were realigned to the actual migrated schema
   (violations table has no employee_id/fine_amount/notes/criticality
   columns; statuses are PENDING/CONFIRMED/DISMISSED/RESOLVED).

Consequences:

- The violations/finance frontend must send schema-aligned payloads
  (business_unit_id, violation_type_id, description, occurred_at); older
  field names will be rejected with 400s until the UI is updated.
- Ledger corrections remain compensating entries only; no code path can
  UPDATE or DELETE a posted entry.

## ADR-023 - Lock Enforcement, Edit-Session Leases, MFA Gate and Rate Limiting

**Status:** Accepted (2026-08 security audit remediation)

Decisions:

1. Final lock executes as one transactional Postgres function
   (finalize_reporting_week, migration 008): task status flips, score
   snapshots (real penalty_rate from integrity_penalty_configurations,
   final = base x (1 - rate)), compliance records derived from
   submission_status, report/week FINAL_LOCKED transitions and a single
   audit entry all commit or roll back together.
2. Edit sessions are single ACTIVE leases per report on the
   report_edit_sessions schema (status / lease_expires_at), enforced by a
   partial unique index plus an acquire_report_edit_session() function that
   raises session_conflict when another user holds a live lease. The phantom
   weekly_report_edit_sessions table is retired; BU Leads may only acquire
   leases on their own BU reports.
3. MFA is enforced in middleware for SUPER_ADMIN, ADMIN and FINANCE: access
   requires mfa_verified_at within the last 12 hours; unverified elevated
   users are redirected to /mfa-challenge (API calls receive 401 JSON).
   The verification stamp is written against the users row resolved by
   email, since users.id is not guaranteed to equal the Supabase auth UID.
4. Rate limiting is applied to login (per-IP + per-account), MFA verify,
   password forgot and password reset endpoints. The in-process store is a
   stopgap; production deployments must front it with a shared store
   (Redis/Upstash) for multi-instance correctness.
5. Password reset tokens are consumed atomically via conditional UPDATE;
   minimum password length raised to 12.
6. Seeding never overwrites the password of an existing auth user.

Consequences:

- Elevated users must re-verify MFA every 12 hours.
- Final-lock re-runs return already_final_locked instead of duplicating
  snapshots or compliance rows.

## ADR-024 - Identity Resolution via get_current_user_id()

**Status:** Accepted (2026-08, during live deployment verification)

Context: In this Supabase project users.id is NOT the GoTrue auth UID.
Policies comparing user_id = auth.uid() denied every legitimate user, which
broke role resolution through the anon client (login MFA branching, rbac.ts)
- and had silently broken migration 001's get_user_role_ids() helper since
its creation.

Decisions:

1. New SECURITY DEFINER function get_current_user_id() resolves users.id
   from the verified JWT email (migration 009). All identity-based policies
   use it instead of auth.uid() equality against users.id columns.
2. OTP codes and MFA stamps are keyed by the resolved app user id; the
   mfa_otp_codes.user_id FK now actually holds.
3. The middleware MFA gate exempts /mfa-challenge,
   /api/auth/mfa-verify and /api/auth/logout so the challenge can complete.
4. All migrations 004-009 were applied to the linked project and recorded in
   supabase_migrations.schema_migrations; 006 was rewritten to be fully
   idempotent after partial application.

Operational notes:

- PostgREST schema cache may need NOTIFY pgrst, 'reload schema' after
  out-of-band DDL applied outside the CLI/migration runner.
- Dev login requires reading the simulated OTP from the server console log
  or the email_logs table until a real mail provider is integrated.

## ADR-025 — No-op set_rls_context over HTTP (C6)

**Status:** Accepted (2026-09-24)

Context: migration 029 C6 — `set_rls_context(text, text, text, text)` is
SECURITY DEFINER and trusts caller-supplied role/BU/user arguments. GUCs set
via PostgREST are transaction-local and do not persist across statements, so
the RPC cannot establish request-scoped RLS context in this architecture.

Decisions:

1. `src/lib/supabase/rls.ts` is an intentional no-op; `withRLSContext` only
   sequences the callback.
2. DB: EXECUTE on `set_rls_context` revoked from `anon` / `authenticated`;
   retained for `service_role` / migrations only (029/030).
3. Identity for policies comes from `get_current_user_id()` /
   `get_user_role_ids()` resolving the verified JWT (ADR-024), not GUCs.

## ADR-026 — Migration apply path: exec_sql + apply-via-exec-sql.js

**Status:** Accepted (2026-09-24)

Context: Management API `sbp_` tokens are exposed-rotating (checklist P0);
`docs/MIGRATIONS.md` previously recorded 030 as unapplied. `exec_sql` is now
installed on the project.

Decisions:

1. Canonical runner: `scripts/apply-via-exec-sql.js` (service-role key from
   `.env.local`, statement splitter tolerant of dollar-quotes, benign
   already-exists skips, non-zero exit on real failures).
2. Migrations 030 and 031 applied 2026-09-24 through this path (76+6
   statements, 0 failures).
3. `supabase_migrations.schema_migrations` only lists 000â€“010; catalog probes
   (`probe-catalog.js`) are used to verify object state until a CLI resync.
4. One-off root probe/debug scripts are eslint-ignored and must not be
   treated as product code.

## ADR-027 — Audit write path reliability

**Status:** Accepted (2026-09-24)

Context: runtime logs showed `audit_logs` RLS violations and a NOT NULL
failure on `created_by` (migration 014 never reached this project). Spec
15-AUDIT-CONTROLS requires security/admin events (login failure, logout) to
be auditable; those paths often have no session JWT.

Decisions:

1. Migration 031: `audit_logs.created_by` DROP NOT NULL; `NULL` means system
   / no resolvable app user. Insert policy allows `created_by IS NULL`,
   self (`get_current_user_id()`), or ADMIN/SUPER_ADMIN. UPDATE/DELETE remain
   blocked by the append-only trigger; SELECT stays admin-only.
2. `writeAudit()` tries the caller client first; on RLS/privilege/not-null
   errors it retries via `getSupabaseAdmin()` (service_role BYPASSRLS).
   Failures are logged, never thrown (business op must not fail on audit).
3. Logout resolves `users.id` by email **before** `signOut({scope:"global"})`
   and writes AUTH_LOGOUT through the admin client (ADR-021 identity).
4. Failed-login audit uses the admin client (no session principal).

## ADR-028 — Real Session Revocation and Listing (F-18)

**Status:** Accepted (2026-09-25)

Context: audit finding F-18. GoTrue exposes no admin endpoint for listing or
force-revoking another user's sessions (probed live: `/admin/users/{id}/sessions`,
`/admin/users/{id}/logout`, `/admin/sessions/{id}` all 404), and auth-js's
`admin.signOut()` accepts a **JWT**, not a user id — so all three call sites
(`sessions/revoke-all`, `mfa/totp/disable`, `admin/mfa/reset`) were silent
no-ops. `admin.listUserSessions` does not exist in auth-js, so
`GET /api/auth/sessions` threw a TypeError and always returned 500.

Decisions:

1. Migration 034: SECURITY DEFINER functions `revoke_user_sessions(target,
   keep_session_id, only_session_id)` and `list_user_sessions(target)` over
   `auth.sessions`, EXECUTE granted to `service_role` only (PostgREST does
   not expose the auth schema).
2. Revocation epoch: `users.session_revoked_at` is stamped whenever ALL of a
   user's sessions are revoked. The proxy decodes `iat` from the
   access token (signature already validated by `getUser()` in the same
   request) and rejects tokens issued before the stamp minus a 5s clock-skew
   allowance — revocation takes effect immediately instead of at token
   expiry. Fresh logins carry a later `iat` and pass.
3. Semantics (matches settings UI): bulk revoke = ALL sessions including the
   current one (confirm dialog: "You will be signed out of all sessions"),
   then redirect to /login; `{revoke_session_id}` revokes a single session
   with ownership enforced inside the RPC; TOTP disable and admin MFA reset
   perform full revocation + epoch stamp for the affected user.
4. Ordering: stamp before session-row delete (bulk) so a partial failure
   still leaves tokens dead at the gate; revoke before state change (TOTP
   disable) so failures are retryable with nothing mutated.

Outcome: probe-verified — session list 200 with `current` flag; non-owned
single revoke returns `revoked: 0`; invalid id 400; bulk revoke followed by a
protected GET returns 401 immediately; fresh login returns 200.

## ADR-029 - Step-Up Issuance and MFA Stamp Invalidation at Login

**Status:** Accepted (2026-09 audit remediation F-02/F-03)

Decisions:

1. Step-up tokens are HMAC-SHA256 signed with STEPUP_SECRET (>=32 bytes,
   base64 encoded) and expire after MFA_STEP_UP_TTL_MINUTES (default 15).
   Signing/verification live in src/lib/auth/step-up-token.ts (pure module,
   no Next.js imports, unit-tested); cookie plumbing and password
   verification remain in src/lib/auth/step-up.ts.
2. The mfa_step_up cookie is issued at exactly two proof points:
   POST /api/auth/step-up (account password verified against the
   authenticated session's own user) and a successful POST
   /api/auth/mfa-verify (second factor verified). No other path issues it.
3. Step-up consumers (totp/disable, backup-codes/regenerate,
   mfa/recovery/email) keep their requireStepUpAuth gate. The settings UI
   obtains step-up lazily: on 401 "Step-up authentication ..." it prompts
   for the password once, calls POST /api/auth/step-up, and retries the
   original action.
4. A fresh password login clears users.mfa_verified_at (F-03, fail-closed
   if the clear fails): the proxy's 12-hour MFA gate (ADR-023 #3) must
   never be satisfied by a stamp minted for a previous authentication
   context. The stamp is re-minted only by a successful mfa-verify.

Consequences:

- Sensitive MFA actions are reachable again: disable and backup-code
  regeneration previously returned 401 unconditionally (the step-up cookie
  had zero issuance sites), the disable dialog never opened (its button
  navigated to /mfa/enroll/verify), and regeneration had no code input.
- Elevated users re-verify MFA after every password login, not merely
  every 12 hours; DISABLE_MFA contexts never depend on the stamp.
- Step-up tokens are stateless HMAC: revoking sessions does not expire an
  outstanding step-up cookie (<=15 min residual risk); consumers keep their
  own rate limits and TOTP/backup code verification.
- Ambiguity noted: the original audit also listed "gate widening" with
  F-02/F-03; no specification text defines widened step-up/MFA coverage, so
  no routes were added to or removed from the gates pending clarification.

## ADR-030 - SMART Evaluation Persistence (F-04)

**Status:** Accepted (2026-09 audit remediation F-04)

Context:

smart_evaluations held zero rows - every insert in the application's
history failed with a logged-but-swallowed error. Two independent root
causes: (1) migration 021 constrained dimension/overall scores to 0-10
while the engine, the UI and the specs (00-SOURCE-OF-TRUTH,
03-FUNCTIONAL-REQUIREMENTS, 04-BUSINESS-RULES, 07-SCORING-ENGINE) all
mandate 0-100%; (2) RLS granted BU_LEAD only SELECT on smart_evaluations
while smart_goals grants BU_LEAD ALL on own-BU goals, so the legitimate
goal-creation path could never insert its evaluation.

Decisions:

1. Score CHECK constraints widened to 0-100 (migration 035) - the spec
   scale wins; the engine was never rescaled down. Table was empty, so no
   data migration was required.
2. smart_evaluations_bu_lead_all policy mirrors smart_goals_bu_lead_all
   exactly: evaluation rows are readable/writable exactly where their goal
   row is readable/writable (BU_LEAD own BU, plus existing PRESENTER /
   EXECUTIVE / DIRECTOR SELECT and ADMIN / SUPER_ADMIN ALL).
3. persistSmartEvaluation fails loudly: insert failures throw
   SmartPersistError instead of returning null. Goal POST compensates by
   deleting the just-created goal (a goal never exists without its
   evaluation) and returns 500 SMART_EVAL_PERSIST_FAILED; goal PATCH
   returns 500 SMART_EVAL_PERSIST_FAILED with explicit partial-state copy
   (update applied and audited, evaluation self-heals via the
   smart-evaluation GET); the smart-evaluation GET returns an explicit 500
   when it cannot evaluate and persist.
4. The weekly-report editor reads the endpoint's flat 0-100 numbers
   directly (it previously read `.score` off a number, so every dimension
   bar rendered 0%).

Consequences:

- SMART quality guidance (ADR-009: warnings never block submission) is
  unaffected - only persistence error handling changed; submission paths
  were never gated on evaluations.
- A future evaluation failure after a goal update returns a 500 even
  though the update applied; retrying the save or reopening the report
  re-persists the missing row.

## ADR-031 — Attendance Amendments Preserve Finalised Roster History

**Status:** Accepted — business owner confirmed 2026-10-12 (Finding 2)

**Context:** A finalised attendance roster must be immutable to protect governance evidence, but genuine entry errors still need a controlled correction route. Direct edits or deletion after finalisation would erase or obscure the original record; permanently freezing incorrect values would undermine data quality.

**Decision:**

1. A finalised source roster and its `attendance_records` are immutable. No user, including SuperAdmin, may edit/delete source values in place.
2. HR users with `attendance.amendment.request` may request a correction at any time after finalisation; there is no fixed submission deadline.
3. The request must identify the attendance record, proposed status and a mandatory non-empty reason. Supporting evidence is optional.
4. An authorised independent Admin or designated HR approver with `attendance.amendment.approve` must approve or reject. The requester cannot approve their own request, regardless of any additional roles held.
5. A request remains pending until a decision is committed. The request and decision are audited, and the requester is notified of the outcome. A mandatory reviewer reason on rejection is recommended but was not separately confirmed; track it as a proposed control until the business owner decides.
6. Approval appends a decision/amendment and changes the effective attendance status as derived from approved history. The original record/status and earlier amendment history remain unchanged and retrievable.
7. Enforce one pending request per attendance record or equivalent transaction-safe control. The approval operation must reject stale source/effective status snapshots and require a new request when the current effective status has changed.
8. Requests, decisions and relevant effective-status changes are audited with actor, timestamp, reason, original/effective/proposed status, decision, optional evidence reference and correlation ID. Audit/request history is not physically deleted through normal application operations.
9. SKIPPED sessions and their generated VIRTUAL_PRESENT rows are not eligible for individual attendance amendments; correct an erroneous skip through a separate audited session-outcome correction workflow.
10. The default status for an attendee with no recorded status (current baseline PRESENT versus explicit selection) is a separate unresolved decision and is not settled by this ADR.

**Consequences:**

- The UI needs a dedicated amendment request and approval queue; it must not reopen the saved roster editor.
- The database/API must enforce immutability and self-approval prevention, not rely on hidden buttons.
- All views and exports must use a canonical effective-status projection while retaining source values.
- QA must test direct mutation attempts, role combinations, concurrency, stale requests, audit history and notification failure.

## ADR-032 — Quarterly Score Aggregation, Missing Reports and Late Corrections

**Status:** Accepted — business owner confirmed 2026-10-13 (Finding 3, Decisions 1–2)

**Context:** The previous phrase “average of final weekly BU scores” did not define the quarter denominator, how missing reports contribute, or how an authorised late report may correct a missing-report zero after a quarter locks.

**Decision:**

1. Quarterly execution score is the arithmetic mean across **all non-holiday calendar reporting weeks in the quarter**. NORMAL and SKIPPED-session weeks are included; an officially declared `ORGANIZATION_HOLIDAY` week is excluded because no report is due. Missing reports in reportable weeks do not shrink the denominator and contribute 0.00 unless an authorised exception applies. Each eligible reporting week contributes exactly once.
2. A physical OKR session marked `SKIPPED` does not remove that reporting week or change its weighting. Every BU must still manually enter a performance summary, submit its weekly report and complete normal review.
3. If a weekly report has not been submitted by its final lock, its weekly score is `0.00` and compliance is `NON_COMPLIANT`, unless an authorised exception applies. This zero contributes to the quarterly average. A submitted report with a score of zero is a distinct state.
4. An authorised exception may permit a late report to be accepted and reviewed, including after quarter lock. If accepted and reviewed, the calculated score can replace the missing-report zero in a new versioned quarterly score snapshot. Keep the original zero and previously published quarterly score snapshot immutable.
5. The amendment must record the authorising decision, reason, actor, timestamps, late report and review references, original/new weekly value, old/new quarterly snapshot references, recalculation inputs/version and audit/correlation identifier. The locked quarter is not generally reopened, and ordinary edits remain prohibited.
6. A submitted report awaiting review is not a missing report. Whether a quarter containing such a report remains provisional and the precise finalisation rule are not decided by this ADR and must be resolved before implementation of that edge case.
7. A durable, auditable zero-score state must be available for every missing BU/week, whether implemented as a dedicated snapshot or equivalent immutable scoring/compliance evidence.

**Consequences:** The denominator, report-state distinctions and amendment history must be consistent across business rules, scoring engine, master documents, UI, database/API design and QA. Quarter score corrections append a new score version; they never erase the prior score.



## ADR-033 — Organization Holiday reporting state (Agreed — 2026-10-13)

**Context:** A skipped physical OKR meeting is not equivalent to an organisation-wide holiday. Skipped sessions still require each BU to submit a report and a manual summary comment, whereas an organisation-wide closure means no reports are expected.

**Decision:** Introduce a reporting-period state `ORGANIZATION_HOLIDAY` separate from governance-session outcomes `SCHEDULED`, `HELD`, and `SKIPPED`. HR, Admin, Super Admin or a user with the explicit holiday-management permission can declare the affected full reporting week(s) as a holiday.

**Rules:**
1. NORMAL weeks require the standard BU report and normal review.
2. SKIPPED physical-session weeks remain reportable; immediately notify all BU Leads and activate the mandatory manual performance-summary comment in each BU report. The comment does not replace the weekly report or review.
3. ORGANIZATION_HOLIDAY weeks require no BU report. Suppress due/overdue notices and missing-report zero/non-compliance caused solely by non-submission. Notify all BU Leads of the declared period.
4. Exclude ORGANIZATION_HOLIDAY weeks from quarterly numerator and denominator. Include all NORMAL and SKIPPED-session weeks; missing reports for reportable weeks contribute zero unless an authorised exception applies.
5. Do not create `VIRTUAL_PRESENT` attendance rows solely due to a holiday declaration. Maintain separate session and reporting-period states; do not add a CANCELLED OKR state.
6. Record an append-only audit event for every declaration/change with actor, time, affected reporting week(s), reason and correlation ID. A post-lock change that affects quarterly scoring creates a new score snapshot/version and preserves prior snapshots.
7. If no eligible reporting weeks exist in a quarter, the score is `N/A` with reason `NO_ELIGIBLE_REPORTING_WEEKS`.

**Open boundary:** This rule assumes the holiday declaration applies to identified full reporting weeks. Partial-week holiday handling requires explicit business approval if needed.


---
# Rebuild ADRs (greenfield implementation, 2026-10-14)

The ADRs above (ADR-021…028) describe fixes to a previous implementation. This repository is a clean rebuild; those ADRs are kept as requirements/lessons. The following record rebuild-specific decisions.

## ADR-034 — Platform: Supabase (local via Docker) + Next.js
**Status:** Accepted (owner confirmed "go" on recommended defaults, 2026-10-14)
PostgreSQL 17 + Supabase Auth, run locally with the Supabase CLI; identical migrations deploy to a hosted project later. Next.js (App Router, TypeScript), Tailwind, Radix primitives with shadcn-style components.

## ADR-035 — All mutations are service-only RPCs; users get SELECT through RLS only
**Status:** Accepted
`users.id` equals `auth.users.id` (this removes the ADR-024 identity-mapping defect). Business tables grant `authenticated` SELECT only (row-filtered by RLS); no INSERT/UPDATE/DELETE grants exist. Every mutation is a `SECURITY DEFINER` function whose `EXECUTE` is granted to `service_role` only. The Next.js API layer verifies the JWT (`auth.getUser()`), resolves the actor, and passes `p_actor`; each function re-checks permission, BU scope and lifecycle state itself via `require_permission`/`actor_*` helpers. Consequences: direct PostgREST writes by a user are impossible; the service-role key is server-only; SMART evaluations (computed server-side) cannot be forged by a client.

## ADR-036 — Server time is authoritative; lifecycle phase is derived, not trusted from a column
**Status:** Accepted
`report_phase()` derives OPEN / CONTENT_LOCKED / FINAL_LOCKED from `app_now()` and the `reporting_weeks` lock timestamps on every mutation, so a failed scheduler cannot extend a lock. `app_now()` returns `now()` except for sessions whose `session_user` is `postgres` and that set `app.test_now` (used only by the test suite; unreachable through PostgREST).

## ADR-037 — Reporting-week and quarter calendar assumptions
**Status:** Accepted, assumptions flagged for owner confirmation
Reporting week = Monday 00:00 → next Monday 00:00 Africa/Lagos. Content lock = Tuesday 18:00 of the opening week; final lock = the following Tuesday 11:00. A week belongs to the quarter containing its Monday (DEC-004 straddling weeks stay open for owner decision). Quarters are calendar quarters (Jan–Mar …); the "year" of the Annual Theme is the calendar year. Reports cannot be created after the week's content lock (nothing could then be added); a BU with no report is non-submitted at final lock.

## ADR-038 — Report review (resolves "normal review" ambiguity)
**Status:** Proposed — needs owner confirmation
A Presenter/Admin/SuperAdmin with `weekly_report.review` may mark a submitted report REVIEWED (audited, non-blocking, only after final lock). Submitted-but-unreviewed reports are never scored zero for pending review; the quarter score stays `PROVISIONAL` until every eligible week has a final snapshot and every submitted report is reviewed (recommended resolution of DEC-020).

## ADR-039 — SMART engine is deterministic and rule-based
**Status:** Accepted
Five dimensions, 20% each, versioned (`smart-rules-1.0.0`), pure TypeScript module behind an interface so a model-backed evaluator can be added later. Goal and evaluation are persisted in one RPC transaction (no goal without its evaluation).

## ADR-040 — Integrity penalties require configured rate; additive and applied once
**Status:** Accepted
`integrity_penalty_configurations` holds versioned decimal rates (no invented default). APPLY is impossible until Admin/SuperAdmin configures a rate (`PENALTY_CONFIG_MISSING`); WAIVE needs only a reason. A corrected week gets a new `weekly_score_snapshots` version using `base × (1 − Σ applied rates)`, floored at 0, rounded to 2 dp. Corrections are refused once the week's quarter is LOCKED and the week is final-locked (route via the late-report/score-amendment path, milestone 3).

## ADR-041 — Disbursement ledger posting
**Status:** Proposed (DEC-009 open)
Finance approval and cash release are separate; the ledger DEBIT posts at the DISBURSED step, atomically with the balance check (ADR-022 / BR-FIN-007 take precedence over UJ-15 wording). The `/cancel` governance-session endpoint in the API contract is not implemented (no CANCELLED outcome).

## ADR-042 — OKR session ↔ reporting week
**Status:** Proposed (assumption; confirm)
A governance session is linked to the reporting week it **presents**: the week that final-locks on that session's Tuesday. Skipping that session activates the mandatory manual performance summary on that week's BU reports. The link is explicit (`create_governance_session(week)`), so it can be re-pointed by a controlled change if the owner prefers "the week in which the session occurs".

## ADR-043 — Attendance roster lifecycle and Skip OKR
**Status:** Accepted (follows `04-BUSINESS-RULES` attendance clarification)
`SCHEDULED` (roster `NONE`/`DRAFT`) → `HELD` + roster `FINALIZED`, or `SCHEDULED` → `SKIPPED`. The roster is created server-side from the active-staff snapshot, every row `PRESENT`. Skip is atomic and idempotent (session row lock + idempotency key): an unfinalised draft is discarded and replaced by one `VIRTUAL_PRESENT` row per active staff member; a finalised held roster cannot be skipped (`ATTENDANCE_SESSION_NOT_SKIPPABLE`); an organisation-holiday week cannot be skipped. Finalised and skip-generated rows are immutable through a database trigger. There is no CANCELLED outcome and no `/cancel` endpoint. The separate "session-outcome correction" workflow (`attendance.session.outcome.correct`) remains **unbuilt** by design: nothing may silently reverse a skip.

## ADR-044 — Controlled attendance status catalogue
**Status:** Accepted
`attendance_statuses` holds PRESENT, ABSENT, ON_LEAVE, EXCUSED, ILL and the system-only VIRTUAL_PRESENT; records reference it by foreign key. Additional statuses are added by configuration, never by editing labels in place.

## ADR-045 — Amendments: effective status is a projection; stale proposals are persisted as rejected
**Status:** Accepted (implements ADR-031)
`attendance_effective_status()` (original row + latest approved amendment) is the single projection for every screen/export. Requester ≠ decider is enforced in the decision function **and** by a table CHECK. One PENDING request per record is a partial unique index. A stale approval is recorded as `REJECTED` with a `STALE_REJECTED` event (so it stays auditable) and the API reports `409 ATTENDANCE_AMENDMENT_STALE`. A reviewer comment on rejection is recorded but not mandatory (DEC-016 unresolved).

## ADR-046 — Violations and the violation fund
**Status:** Accepted, DEC-009/DEC-012 recommendations adopted pending owner sign-off
Violation statuses `OPEN → PAID | DEDUCTION_RECORDED`; at most one payment per violation; fine and criticality are snapshotted onto each violation (later type changes affect future records only); a skipped session cannot generate a violation. Money is `numeric(19,2)`. The ledger is append-only (trigger + `seq` posting order), `DEBIT` is refused by the ledger itself if it would make the balance negative, and every money-moving function takes a row lock on the fund. `available = ledger balance − approved-not-yet-released requests`, so approvals cannot over-commit. Approval and release are separate; the requester can neither approve nor release their own request; `read_fund_summary` reconciles ledger credits/debits against recorded payments/disbursements. Ledger reversals (compensating entries) are specified but **not yet exposed** as an operation.

## ADR-047 — Individually designated permissions
**Status:** Accepted
"Designated HR approver" (ADR-031) is implemented as `user_permission_grants`, limited to a whitelist (amendment request/approve, session manage, holiday manage, report review), grantable only with `roles.manage`, audited, and honoured by `actor_has_permission` everywhere (RPCs, RLS, API).

## ADR-048 — Business Units that do not report weekly
**Status:** Proposed
`business_units.reports_weekly` (default true). When false: no weekly report can be created, no missing-report zero/compliance row is produced, and the BU is excluded from ranking and quarterly snapshots. Needed for an admin/HQ unit. Historical snapshots are not rewritten.

## ADR-049 — Read-model errors are domain errors
**Status:** Accepted
Errors from RLS-scoped read models pass through `toDomainError`, so a denied read is `403 PERMISSION_DENIED`, never a 500 and never raw SQL.

## ADR-050 — Late-report score amendment (milestone 3a)
**Status:** Accepted (implements ADR-032; approval-chain details are marked "Confirm" in `25-IMPLEMENTATION-NOTES.md`)
A Business Unit that filed nothing for a final-locked week can be authorised, through the explicit permission `quarter.score.amend` (Admin, Super Admin), to file that week late. The workflow is `late_report_exceptions`: `AUTHORISED → SUBMITTED → APPLIED`, or `REVOKED` from either live state, with an append-only `late_report_exception_events` trail.
- The late report is the BU's ordinary `weekly_reports` row, tagged with `late_exception_id`. Its effective phase is `LATE_OPEN` (editable **and** executable) only while the exception is `AUTHORISED` and the report is unsubmitted (`report_phase_of`). A draft that was frozen at final lock is reopened for this one exception through a session flag that only the authorise function sets; nothing else can move a `FINAL_LOCKED` report back to `OPEN`.
- A late report is scored on submission with no further execution window, so submission is blocked while any task is `UNDEFINED`.
- Review uses the existing `weekly_report.review` operation. Apply (`apply_late_report_amendment`) needs `quarter.score.amend`, a mandatory reason, a reviewed report and **a reviewer different from the applier**. It creates weekly snapshot version N+1 (`LATE_REPORT_AMENDMENT`) and a new quarterly snapshot version (`source = AMENDMENT`) with the same fixed denominator, and an immutable `quarterly_score_amendments` row linking original/new weekly and prior/new quarterly snapshots, scores, actors, and the audit id. The report is re-locked.
- Preserved: the original zero snapshot, every earlier quarterly snapshot, and the `NON_COMPLIANT` compliance row (the compliance effect of an accepted exception is not rewritten). The quarter is not reopened (ordinary strategy/report edits still return `QUARTER_LOCKED`).
- A week can be amended only once (a scored week is no longer "missing"); a revoked exception can be re-authorised.
- Revoking (before submission) or rejecting (after submission) relocks the report and changes no score.

## ADR-051 — Holiday amendment and reversal (milestone 3b)
**Status:** Accepted (permission and one-step decision marked "Confirm" in `25-IMPLEMENTATION-NOTES.md`)
The ordinary Organization Holiday declaration (ADR-033) still refuses a week that is final-locked or already has submitted reports. `amend_organization_holiday(actor, week, DECLARE|REVERSE, reason, key)` is the only other way to change `reporting_state`, and it requires `quarter.score.amend` (Admin, Super Admin), a mandatory reason and an idempotency key; the API also requires `confirm: true`.
- Because eligibility changes, every affected BU gets a **new quarterly snapshot version** (`source = AMENDMENT`, `holiday_amendment_id` set). Prior quarterly snapshots, weekly snapshots and `weekly_compliance` rows are never changed. The quarter is not reopened.
- DECLARE on a past week removes it from numerator and denominator; its earlier weekly scores and compliance rows stay as history, and consumers (executive dashboard) ignore compliance of holiday weeks.
- REVERSE on a week that has already final-locked makes it reportable retroactively: BUs without a score receive the missing-report zero and a `NON_COMPLIANT` row (weekly snapshot reason `HOLIDAY_REVERSAL`), as final lock would have produced; existing scores are kept. The late-report path (ADR-050) is then how a BU can still file. REVERSE before final lock is a plain state flip.
- Refused while a late-report exception is open for the week (`LATE_EXCEPTION_PENDING`) or while the week is awaiting the final-lock job (`FINAL_LOCK_PENDING`).
- `holiday_amendments` is append-only and records direction, states, reason, actor, whether the week/quarter were locked, backfilled zeros, per-BU old/new quarterly score and version, and the audit id; the state change is also appended to `reporting_week_state_events`.

## ADR-052 — Authentication hardening (milestone 4)
**Status:** Accepted (policy choices marked "Confirm" in `25-IMPLEMENTATION-NOTES.md`; extends legacy ADR-023/029 intent to the rebuild)
- **Second factor.** TOTP through the auth server's native MFA. Mandatory for roles in `mfa_required_roles` (SUPER_ADMIN, ADMIN, FINANCE), optional for everyone else. A password gives an AAL1 session; only a verified TOTP makes it AAL2. The rule is enforced in three independent places: the API handler (`MFA_REQUIRED` / `MFA_ENROLMENT_REQUIRED`), page gating (`requireActor`), and the database (`auth_aal_satisfied()` inside `auth_has_permission`, `auth_has_any` and `auth_bu`, so an AAL1 token cannot read protected rows straight from the REST API). Only the account/MFA endpoints are `partial`.
- **Step-up.** High-risk routes (`stepUp: true`: disbursement approve/release, role/permission/suspend/reactivate changes, penalty rate, late-report apply, holiday amendment, administrator MFA reset) require a TOTP check within the last 15 minutes, read from the verified JWT's `amr` claim. The client re-prompts and retries once on `STEP_UP_REQUIRED`. No new server state or secret is needed (replaces the legacy HMAC step-up cookie).
- **Lockout.** A wrong code counts toward the same 5-failure / 15-minute lock as a wrong password (`record_mfa_failure`), and all MFA and password endpoints are rate-limited.
- **Recovery.** Self-service password reset by emailed one-time link (`/forgot-password` → `/auth/confirm` → `/reset-password`): the request answer never reveals whether the account exists; the reset endpoint accepts only a recovery session less than 15 minutes old; users with an authenticator must pass it first; afterwards every session is ended, the lock is cleared, and the user is notified (in-app and, with SMTP, by email). A lost authenticator is reset by an administrator (`users.manage`, mandatory reason, Super Admin required to reset a Super Admin, step-up required, audited, user notified).
- **Password policy.** Minimum 12 characters with upper case, lower case and a digit (enforced by the auth server and mirrored in `password-policy.ts`), plus a small deny-list, no email name, no trivial repetition. Public self-registration is disabled on the auth server; accounts are created only by administrators.
- **CSP.** `proxy.ts` sets a per-request nonce policy: `script-src 'self' 'nonce-…' 'strict-dynamic'` (no inline scripts), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'` (the browser only talks to this origin). Development additionally allows `unsafe-eval` and websockets for hot reload. `style-src` keeps `'unsafe-inline'` because the UI uses style attributes; styles cannot execute code. HSTS and COOP are sent in production.
- **Audit.** `AUTH_PASSWORD_RESET_REQUESTED`, `AUTH_PASSWORD_RESET`, `AUTH_PASSWORD_CHANGED`, `AUTH_MFA_ENROLLED`, `AUTH_MFA_VERIFIED`, `AUTH_MFA_STEP_UP`, `AUTH_MFA_FAILED`, `AUTH_MFA_DISABLED`, `AUTH_MFA_RESET_BY_ADMIN`, plus the existing lock and login events.
- **Local development.** `npm run dev:seed` enrols a TOTP factor for each seeded elevated user and stores the secrets in the git-ignored `.dev-mfa.json`; `npm run dev:totp -- <email>` prints the current code; API tests complete the challenge automatically.

## ADR-053 — Intelligent Reports module (milestone 6)
**Status:** Accepted (metric definitions marked "pending approval" in the metrics catalogue await the business)
A first-class Reports module (`/reports`) that reads the existing authoritative data and never recalculates an official score.
- **Architecture.** Read-only SQL functions `read_report_*` (SECURITY INVOKER, so row-level security and `auth_can_view_bu` scope every row) return rows from `weekly_score_snapshots`, `quarterly_score_snapshots`, `weekly_compliance`, the workflow tables and the ledger. A TypeScript runner (`src/lib/reports/run.ts`) shapes each into one result type (columns, rows, summary, charts, notes) that drives the table, charts, CSV, XLSX and PDF identically, so on-screen figures and exports cannot disagree. The catalogue (`catalogue.ts`) and the metrics catalogue (`metrics.ts`, versioned) are the single place a report or figure is defined.
- **Permissions inside the existing RBAC.** `reports.view`, `reports.export`, `reports.build`, `reports.snapshot`; each report may add a data permission (`requires`). Row scope always comes from RLS: a BU Lead's report contains only their BU and omits organisation-wide comparisons. An elevated role's password-only session reads nothing.
- **Truthfulness rules.** Pending weeks are blank, never zero; holiday weeks are excluded, never zero; what a role cannot read is blank, never zero. Compliance is read from the compliance record and is never altered by a late-report exception (decision 2). Unofficial figures (e.g. the average of BU scores) carry a "pending approval" label because no official organisation score exists.
- **Forecasting.** Transparent baselines only (average of scored weeks, or a fitted trend), chosen by rolling-origin back-testing on the BU's own history; no projection with fewer than four scored weeks; 95% range stated with its assumptions; projections are drawn dashed and labelled and are never mixed with actuals. Floor and ceiling are arithmetic bounds.
- **Insights and assistant.** A deterministic rules engine produces findings that each carry evidence, comparison baseline, limits and a link to the supporting report; observations, anomalies and recommendations are separate kinds; no causal claim is made. The assistant maps a question to an approved report with the asker's own permissions; it generates no SQL and no text with a model. No AI provider, data-handling approval or evaluation set exists, so AI narrative is **not implemented** (recorded in the catalogue as blocked).
- **Exports.** CSV, XLSX (with a metric-definition sheet) and PDF, built from the same result, capped at 20,000 rows, carrying period, scope, filters, generation time and definition versions; text cells are defended against formula injection; every export is audited (who, which report, filters, format, rows; never the data).
- **Snapshots.** `report_snapshots` is append-only and organisation-wide only (`reports.snapshot` + `weekly_report.view_all`), so a stored result can never exceed any reader's scope; each carries parameters, definition version and a SHA-256 checksum over canonical JSON (key order is not preserved by jsonb) that is re-verified when viewed. Saved views hold definitions only; sharing validates that recipients can open reports and never widens anyone's data.
- **Not built because the data does not exist:** employee KPIs, KR targets/actuals and attainment, financial projections/revenue/variance, strategy-definition version history, review comments, session-outcome and ledger-reversal registers, scheduled email delivery. Each is listed with what would unblock it.
- **Development data.** `npm run dev:history` plays several weeks through the real workflow on the development clock so the module has history locally; it never writes score tables directly.

## ADR-054 — Owner decisions of 14 October 2026 (recorded; implementation status stated)
**Status:** Decisions accepted by the owner; implementation status stated per item (updated after the closing pass).
1. **Executive dashboard as decision support** — trends, BU status, compliance and finance, governance items, action view, filters, exports, metric transparency; rank never replaces trend. *Partly delivered by Reports (ADR-053); the Dashboard page itself is unchanged.*
2. **Holiday and late-report approvals** — one Admin for routine holiday amendments; two-person approval for amendments that change a locked period or compliance; Authorise → Review → Apply with the applier different; an accepted late report never makes the original week compliant. *Late-report chain and non-compliance are built (ADR-050). Two-person approval for amendments to a closed week is **built** (ADR-058); amendments to a week that has not final-locked stay a single Admin step.*
3. **Session-outcome correction and ledger reversal** — request, independent approval, separate execution; reversal entry references the original; Super Admin emergency override with MFA, audit and alert. *Ledger reversal is **built** (ADR-059). Session-outcome correction is **built** (ADR-063).*
4. **Session ↔ reporting week** — a session references its reporting week explicitly (`governance_sessions.reporting_week_id` already does); never inferred from the date; one authoritative calendar configuration. *Explicit reference exists; the single configuration object does not.*
5. **Strategy edits in an active quarter** — controlled baseline; semantic changes need a change request and independent approval; versions preserved; retirement instead of deletion. *Built (ADR-064): change request, independent approval, retirement instead of deletion.*
6. **Notifications** — in-app plus email for time-sensitive events, configurable reminders with frequency limits, holiday suppression, actionable status. *Reminders, an email outbox with retry, a personal email choice and links from notifications are **built** (ADR-061). No email provider is chosen, so mail leaves only where an operator configures one.*
7. **Lost authenticator** — one-time recovery codes plus a documented break-glass process; two Super Admins; sessions revoked after reset. *Recovery codes, session revocation, a Super Admin count warning and a break-glass script are **built** (ADR-060).*
8. **Hosting, scheduler, email provider** — to be decided and documented; managed scheduler independent of user activity; verified email delivery. *Scheduler endpoint, SMTP transport and runbook exist (docs/27); hosting and the email provider are still to be chosen by the owner. Open.*
9. **Legacy parity assessment** — structured old-versus-new comparison before declaring completion. *Done as a traceability matrix (docs/28). A comparison against the actual legacy application is impossible without its code or data.*

## ADR-055 — Display rules: one-decimal percentages and one week label
**Status:** Accepted (owner instruction, 14 October 2026).
- **Percentages.** Every percentage, and every 0–100 score shown with a % sign, is displayed to exactly one decimal place (`50.0%`). This is a display rule only. The scoring engine still calculates and stores weekly and quarterly scores to two places (docs/07), exports keep the unrounded value, and nothing is rounded before it is compared or summed. `src/lib/format.ts` is the only formatter (`formatPercent`, `formatFraction`, `formatDecimal1`, `formatSigned1`, `formatMetric`).
- **Week label.** A reporting week is always shown as `Week 14, 30 Mar – 5 Apr 2026`; inside one month `Week 15, 6–12 Apr 2026`; across a year end both years (`29 Dec 2025 – 4 Jan 2026`). The number is the stored ISO week number and the dates are the stored Monday start in Africa/Lagos plus six days, so the label can never disagree with the calendar. `src/lib/domain/week-label.ts` (`formatWeekLabel`, `formatWeekRange`, `formatWeekShort`) is the single implementation; screens, reports, exports, insights and the assistant use it. Business logic keeps using identifiers and timestamps, never the label.
- **Consequence.** The two-decimal examples in docs/07 describe stored precision, not what a person reads.

## ADR-056 — Bulk import (employees first)
**Status:** Accepted and implemented. There was no import feature before this ADR.
- **Where the authority sits.** The browser reads, previews and helps correct; the database decides. `commit_employee_import` (service-role only, actor passed explicitly) re-validates every row, applies the conflict policy and commits all rows in one transaction or none. The API also validates first, so the person normally never reaches a database refusal.
- **Scope.** Employee records only (email, first and last name, Business Unit, status). It never creates login accounts, roles or reports and never touches a locked period, finance or scoring data. Permission `users.manage`; the commit route requires a recent authenticator check (`stepUp`).
- **Untrusted input.** Only `.csv` and `.xlsx`, checked by extension and first bytes (macro workbooks, renamed archives and binary files are refused); 2 MB, 2000 rows, 30 columns. Workbook formulas are never calculated: they become text starting with `=` and are rejected. Text starting with `= + - @` (tab, CR) is rejected in every text field and in emails; the error report and results download neutralise such text again. Request bodies are strict allowlists.
- **Row classes.** ERROR (blocks), CONFLICT (the person already exists), WARNING (notice: spaces trimmed, Business Unit move, status change). Conflict policy is explicit: stop if anyone exists, skip existing, or update existing. Duplicates inside the file are errors.
- **Safe repeat.** Each commit carries an idempotency key. The same key returns the first result; the same key with a different file checksum, policy or user is refused. A file whose checksum was imported before is flagged, not blocked.
- **History.** `import_batches` and `import_batch_rows` are append-only, readable only with `users.manage`, and every commit writes `EMPLOYEE_IMPORT_COMMITTED` plus the per-person `EMPLOYEE_CREATED` / `EMPLOYEE_UPDATED` entries.
- **Not built:** other entities (Business Units, strategy, historical scores), background processing of very large files, partial commit of the valid rows.

## ADR-057 — Last Week quick hint, landing page and shared metric card
**Status:** Accepted and implemented.
- **Last Week hint.** `read_previous_week_outstanding(week, bu)` is SECURITY INVOKER, so BU scope and RLS apply to the caller. The previous week is the calendar week starting seven days before the current week's Monday in Africa/Lagos, so month, quarter and year boundaries need no special case; if that calendar row does not exist the answer is `NO_PREVIOUS_WEEK`, never an older week. It lists tasks recorded NOT_DONE for that BU and states separately when the week is not final (undefined tasks are counted, not listed), a holiday, or no report. It is `GET` only, needs `presentation.view`, and the presenter UI keeps its state because it opens over the page.
- **Landing page.** `/` is public (signed-in users go to the dashboard), uses only true statements about the product and no invented statistics. Sign-in keeps its behaviour: generic failure text, rate limiting, lockout, suspended-account handling, authenticator step, step-up, password recovery.
- **Metric card.** `MetricCard` + `AnimatedNumber` give headline figures a definition and a drill-down link. The count-up is cosmetic: the server renders the real value, assistive technology reads it, and reduced-motion users see it at once. No animation library was added.

## ADR-058 — Two-person approval for amendments to a closed week
**Status:** Accepted and implemented (owner decision 2).
- **When it applies.** A holiday amendment on a week that has final-locked, or whose quarter is locked, rewrites compliance and quarterly scores for the record. One Admin can no longer do it alone. A week that has not final-locked, in an open quarter, stays a single Admin step (`amend_organization_holiday`).
- **How.** An Admin REQUESTS (`request_holiday_amendment`: reason, idempotency key, one pending request per week). A DIFFERENT holder of `quarter.score.amend` APPROVES or REJECTS (`decide_holiday_amendment_request`; a rejection needs a comment). Approval applies the amendment in the same transaction through the unchanged `amend_organization_holiday`, which now refuses a closed week unless it is called from an approval. Scoring, versioning, compliance rows and audit behave exactly as before; the approver is the actor of the amendment and the request records who asked.
- **Guarantees.** The requester can never decide (checked in the database); requests are append-only apart from their single decision; every step is audited and notified; approval fails cleanly (and the request stays pending) if the week can no longer be amended, for example because a late-report exception is open.
- **Not decided:** whether a week in an open quarter that has final-locked should count as "closed" only after the quarterly score is final (today: yes, final-locked is enough).

## ADR-059 — Ledger reversal
**Status:** Accepted and implemented (owner decision 3, docs/16).
- **Compensating entry.** A wrong ledger entry is never edited. A reversal posts a NEW entry of the opposite type with `source_type = 'REVERSAL'` and `reverses_entry_id` pointing at the original (a unique index allows one reversal per entry; a reversal cannot itself be reversed). The ledger stays append-only and the balance can never go negative or below what approved disbursements have committed.
- **Three steps.** `ledger.reversal.request` (Finance, Admin, Super Admin) asks; `ledger.reversal.approve` (Finance, Super Admin) decides and cannot be the requester; `ledger.reversal.execute` (Finance, Super Admin) posts and cannot be the requester. The approver may also post. One open request per entry.
- **Emergency.** `ledger.reversal.emergency` (Super Admin only) does all three in one step with a reason of at least 10 characters, requires a fresh authenticator check at the API, is audited as `LEDGER_REVERSAL_EMERGENCY` and alerts every user who can view the ledger. It still posts a compensating entry; nothing is edited.
- **Reconciliation.** The fund summary counts reversal entries against the ledger side, so "ledger equals recorded payments and disbursements" still holds.
- **Violation payments:** reversing one now reopens the violation (ADR-065).

## ADR-060 — Lost-authenticator recovery
**Status:** Accepted and implemented (owner decision 7); procedure in docs/26-ACCOUNT-RECOVERY.md.
- **Recovery codes.** Ten one-time codes (12 Crockford base32 characters, 60 bits) are shown once when an authenticator is activated, and again on request (needs a fresh code, cancels the old set). Only an HMAC-SHA256 keyed with the server secret and bound to the user is stored; no browser session can read the table.
- **Using a code never grants the second factor.** It spends the code, removes the authenticator, cancels the remaining codes, ends every other session and sends the person to set up a new authenticator, like an administrator reset without the administrator. Wrong codes count toward the same lockout and are rate-limited. The same revocation now follows an administrator reset.
- **Break-glass.** `npm run break-glass:mfa-reset` (server access only) does the same for an account when no Super Admin can sign in; it needs an operator name, a reason and a confirmation, writes `AUTH_BREAK_GLASS_MFA_RESET` and alerts every Super Admin. Administration warns when fewer than two Super Admins are active.

## ADR-061 — Reminders and the email channel
**Status:** Accepted and implemented (owner decision 6); the email provider remains an open decision (ADR-054 #8).
- **Reminders.** `send_report_reminders()` runs inside the scheduler. For every expected Business Unit that has not submitted, it notifies the Business Unit Leads at configured hours before the content lock (default 24 and 6), at most N per person per week (default 2), once per slot, only the latest slot if the scheduler was down, never for a holiday week, never after the lock, never for inactive people. Settings (`reminders.configure`: Admin, Super Admin) are validated and audited.
- **Email.** The in-app notification is authoritative. A trigger queues an `email_outbox` row, in the same transaction, for the event types listed in `email_event_types`; any failure there is caught and never affects the notification. Security events (password, authenticator, break-glass, emergency reversal) are mandatory; the rest respect each person's choice and a global switch. The scheduler hands due rows to a transport, with leases, backoff (2, 4, 8, 16 minutes), a give-up after five attempts and a 48-hour expiry.
- **Transport.** `EMAIL_TRANSPORT=smtp` (nodemailer, `SMTP_URL`, `EMAIL_FROM`) for production, `file` for development and tests (one JSON file per mail), nothing otherwise: mail is parked and expires, reminders still appear in the application. Mail is plain text with a link back to the application.
- **Actionable.** Notifications link to the place the work is done. The notifications page shows a "Still waiting" state when the underlying request is still pending (`read_notification_states`).

## ADR-062 — Shared interface pieces and Business Unit import
**Status:** Accepted and implemented.
- **Shared pieces.** `DataTable` (one scrolling, captioned, keyboard-focusable table layout used by ten tables; its wrapper is positioned and size-contained so visually hidden text inside it cannot widen the page), `Field` (label, hint and error wired for assistive technology), `Drawer` (a side panel that returns focus to its opener) and `MetricCard` / `AnimatedNumber`.
- **Drill-down.** The executive ranking filters by missing reports, provisional scores and a score slider, and each Business Unit opens a read-only week-by-week drawer read through the reports API as the signed-in user.
- **Business Unit import.** The same wizard, API and database guarantees as the employee import (ADR-056), driven by one entity table: `imports/[entity]/(parse|validate|commit)` and `commit_business_unit_import` (code 2 to 20 characters, upper-cased; name; weekly reporting Yes/No; status). Permission `business_units.manage`. Making a unit inactive never moves its people.


## ADR-063 — Correcting a session outcome (skip or roster) in three steps
**Status:** Accepted and implemented; roles and the blocking rule are assumptions awaiting owner confirmation (docs/25).
- **Why.** "Skip OKR for this week" tags the whole roster VIRTUAL PRESENT and was irreversible. A skip entered on the wrong week needed a correction path that does not edit history.
- **Three steps, three people.** `attendance.session.outcome.request` (HR, Admin, Super Admin) asks with a reason; `attendance.session.outcome.approve` (Admin, Super Admin) decides and cannot be the requester; `attendance.session.outcome.correct` (Admin, Super Admin) executes and cannot be the requester. Asking changes nothing; executing returns the session to SCHEDULED with no roster.
- **Nothing is deleted.** The earlier attendance rows move to `attendance_record_archive` (append-only) and are linked from the correction record. Penalties, ledger entries and amendments already based on the old roster are not touched; if amendments to the roster exist the correction is refused (assumption).
- **Emergency.** `attendance.session.outcome.emergency` (Super Admin only) does all three steps at once, needs a reason of at least 10 characters and a fresh authenticator check, is audited as `SESSION_CORRECTION_EMERGENCY` and alerts everyone who runs sessions.
- **Idempotent and audited.** Every step carries an idempotency key and writes an audit row; each is a SECURITY DEFINER function callable only by the service role.

## ADR-064 — Strategy change control in an active quarter
**Status:** Accepted and implemented; approvers are an assumption (docs/25).
- Direct edits to objectives, key results and sub-key results are blocked once a quarter is ACTIVE. A change is a request (`strategy.change.request`: Admin, Super Admin) that a different person with `strategy.change.approve` (Admin, Super Admin, Executive: the Executive may decide but not ask) approves or rejects; approval applies it in the same transaction and stores before and after values.
- Key results are retired, never deleted. A quarter may hold at most four key results, retired ones included (`KR_LIMIT_EXCEEDED`) (assumption: retiring does not free a slot, so history stays comparable).
- `strategy/history` returns the applied changes. Reports already finalised are never recalculated.

## ADR-065 — Reopening a violation when its payment is reversed
**Status:** Accepted and implemented (closes the known gap in ADR-059); the default is an assumption.
- Reversing the ledger entry of a violation payment reopens the violation to UNPAID with a note "Reopened…" and keeps the original payment row immutable. The next payment is a new row. Fund reconciliation is unchanged. Both events are audited.

## ADR-066 — Row-level security evaluated once per statement
**Status:** Accepted and implemented (migration 20261019000012); guarded by `tests/db/rls_cost.test.ts`.
- **Finding.** The performance baseline showed report reads costing hundreds of milliseconds because policies called `auth_has_permission()`, `auth_bu()`, `auth_can_view_bu()` and `auth.uid()` as bare functions, which PostgreSQL runs for every row filtered.
- **Decision.** Every policy is rewritten to call them as sub-selects, which become InitPlans evaluated once per statement. Which rows each role may see does not change; the role-by-role DB tests still pass. New policies must follow the same pattern; the cost test fails if a bare call returns.
- **Budgets.** Pages p95 ≤ 1500 ms and API p95 ≤ 600 ms at six concurrent requests on a development laptop. They are targets for the baseline script, not service-level promises; production numbers must be measured on the production host (docs/27).

## ADR-067 — Refused requests are audited
**Status:** Accepted and implemented (migration 20261019000011); closes AC-OP-9.
- When a signed-in person is refused with PERMISSION_DENIED or BU_SCOPE_DENIED, the API calls `record_access_denied(actor, method, route, code)`, best-effort. The audit row (`ACCESS_DENIED`, outcome DENIED) holds the method, the route with identifiers replaced by `:id`, and the code, and never the request body. Repeats by the same person on the same route within one minute collapse into one row so a script cannot flood the audit trail. A failure to record never changes the response.

## ADR-068 — Phase 4 enhancement programme: decisions delegated to the lead (15 October 2026)
**Status:** Accepted by the owner ("select the best options for all your questions and proceed"); implementation in phases per docs/30.
- **Scope of "all updates need approval":** governance-critical configuration only: roles and permissions, role authenticator requirement, lock schedule, violation types and fees, integrity penalty rate, reminder and email settings, Business Unit reporting status. Ordinary administration (adding a user or Business Unit, editing a profile) stays audited and single-step.
- **Rolling weeks:** proposed (current week plus the next four) and **not built**: see ADR-070. A generated week is never changed; a new schedule takes effect from the next quarter to be activated.
- **Who approves:** a different person with `config.approve` (Admin, Super Admin). Changes touching protected permissions need `config.protected.approve` (Super Admin) and a fresh authenticator check.
- **Single approver:** a Super Admin may apply a change without a second approver only through an emergency path (`config.emergency`, reason of at least 10 characters, fresh authenticator check, audited, all Super Admins alerted), the same pattern as the existing overrides.
- **Retention defaults:** read notifications 12 months, sent or failed mail 90 days, import rows 180 days; audit and ledger records are never purged.

## ADR-069 — Roles are data, changed by approved requests
**Status:** Accepted and implemented (migration 20261020000001 and 20261020000002); owner decisions of 15 October 2026.
- **Engine (ADR-068 in practice).** `config_change_topics` (data) names who may ask and who may approve each kind of change; `config_change_requests` holds the request, the value in force when it was asked, and the decision. Approval applies the change in the same transaction by calling the existing function for that setting as the requester, so that function's own validation, permission check and audit entry still run. A request is validated when it is made by running the same function inside a sub-transaction that is always rolled back. Decided requests are immutable. A Super Admin can apply a change without a second approver only through `emergency_config_change` (`config.emergency`, reason of at least 10 characters, fresh authenticator check, audited as `CONFIG_CHANGE_EMERGENCY`, other approvers alerted).
- **Topics now:** `VIOLATION_TYPE`, `PENALTY_RATE`, `REMINDER_SETTINGS`, `BU_REPORTING`, `ROLE_CHANGE`, `LOCK_SCHEDULE`, `RETENTION`. New topics need data and an applier function, not a new workflow. The five older correction workflows (attendance amendment, holiday amendment, late-report exception, session-outcome correction, ledger reversal) and strategy change control keep their own tables; migrating them is optional and not planned.
- **No role name in code.** `role_is_privileged()` (a role that holds `users.manage`, `roles.manage`, `roles.request`, `config.protected.approve` or `config.emergency`) replaces the names ADMIN and SUPER_ADMIN; "the people who file a Business Unit's report" are holders of `weekly_report.submit` (replaces BU_LEAD in 8 functions); break-glass alerts holders of `config.emergency`; the first person set up receives the role that holds `roles.manage`; user-facing role lists come from the database. `mfa_required_roles` stays data and is changed with the role.
- **The five rules** (owner-approved): (1) no escalation: a request can add to a role only permissions its requester holds; (2) protected permissions (`permissions.protected`) and the authenticator requirement need a Super Admin to approve (`config.protected.approve`); (3) a change cannot add a combination listed in `permission_conflicts` (disbursement create with approve or disburse; attendance amendment request with approve), combinations that already exist in the shipped roles are left alone; (4) deleting a role requires naming a role to move its holders to, and the last holder of `roles.manage`, `config.protected.approve` or `users.manage` can never be removed (`ROLE_LOCKOUT`); (5) every change is audited with permissions before and after, and holders of `roles.manage` are notified.
- **Any role can be deleted,** including the eight that shipped (`roles.is_system` is informational only), subject to rule 4.
- **Guard rails kept as they were:** the "never the requester" rules are by person and apply to every role; the individual designations (`set_user_permission`) remain a short allowlist of five permissions.
- **Regression guard:** `tests/db/fixtures/role-matrix.json` is the approved permission matrix of the shipped roles; `tests/db/role_management.test.ts` and `tests/api/permission-matrix.api.test.ts` fail if a migration changes it without the fixture being updated on purpose.

## ADR-070 — Configurable lock schedule
**Status:** Accepted and implemented (migration 20261020000003); owner rule: a change never applies to a week already generated.
- `reporting_schedule_versions` (immutable) holds the weekday, time and week offset of the content lock and of the final lock. Version 1 is exactly the schedule that was fixed in code (content lock Tuesday 18:00 of the opening week, final lock Tuesday 11:00 of the following week). `ensure_reporting_week()` reads the version in force and stamps it on the week (`reporting_weeks.schedule_version_id`); a generated week is never regenerated or changed (the existing trigger already forbids it).
- **Deliberate deviation from ADR-068.** The rolling four-week horizon proposed there was **not** built: the quarterly denominator and 15 readers walk the complete calendar of a quarter, so weeks are still generated when a quarter is activated. A change therefore takes effect from the next quarter to be activated; the screen names the first affected week. A rolling horizon would need those readers rewritten and can be revisited if the owner wants faster effect.
- **Fixed on purpose:** the time zone (Africa/Lagos) and Monday as first day of week; changing either leaves a gap or overlap between weeks.
- Validation: the content lock at least an hour after the week starts, the final lock at least an hour after the content lock and within five weeks of the start, and not the schedule already in force. Reminders, error messages, dashboards and the landing page read the stored times or say nothing fixed.

## ADR-071 — Operations hardening
**Status:** Accepted and implemented (migration 20261020000004).
- **Shared attempt limiter:** `rate_limit_hit()` (unlogged table) is the default store in production (`RATE_LIMIT_STORE=database`); `memory` is the default elsewhere and is set by the test runners. If the database cannot be reached the instance falls back to its own counter.
- **Heartbeat and health:** every run of `run_scheduled_jobs()` writes `job_heartbeats`; `ops_health()` (service role only; named `ops_` because `read_` functions are open to signed-in users) feeds `GET /api/health` (public: ok, degraded or unavailable, no details) and `GET /api/internal/health` (secret; figures and alerts, rules in `src/lib/health.ts`): scheduler silent over 5 minutes, failed job steps, stuck or failed email, a development clock override on a production database, limits not shared in production, email not configured.
- **Secret rotation:** `JOBS_SECRET_PREVIOUS` is accepted alongside `JOBS_SECRET` (constant-time) during a switch-over.
- **Production clock guard:** `clock_override_present()` reads the database-level settings `app.dev_clock`, `app.test_now`, `app.environment=development`; health turns critical when one is present in production.
- **Dependency finding:** `npm audit` reported serious flaws in nodemailer 6.x; upgraded to 10.1.x. Two moderate advisories remain in `uuid` via `exceljs` (a bounds check when a caller passes its own buffer to v3/v5/v6, which the export code does not do); accepted, listed in the audit step, CI fails on high and critical only.

## ADR-072 — Retention and audit-log paging
**Status:** Accepted and implemented (migration 20261020000005).
- **Retention:** read notifications older than 12 months and finished email rows (sent, failed, skipped or expired) older than 90 days are removed once a day by the scheduler; unread notifications, the audit log, scores, ledger, violations, reports, import records and every other record are never removed (most are append-only and the database refuses). Periods and an on/off switch are a setting (`retention_settings`, topic `RETENTION`, 3–120 months and 7–730 days). Import rows were dropped from the original proposal because they are immutable by design.
- **Audit log:** newest first, keyset-paged on the audit sequence number, filters (action prefix, entity type, outcome, dates, entity id or words in the reason), page size up to 500, CSV export capped at 10,000 rows that is itself audited (`AUDIT_EXPORTED`), formula-injection defence on every cell.
- **Not done from the review:** a configurable currency and time zone (P-4) were not built: the time zone is fixed for the reason in ADR-070 and every amount in the application is Nigerian Naira; making the currency a setting touches every screen that formats money and has no confirmed requirement.


## ADR-073 — Deployment artefacts and the go-live runbook
**Status:** Accepted; artefacts built and tested locally. Hosting, the email provider and the data-location decision remain the owner's (docs/32 section 1 gives a recommendation, not a decision).
- **Container image** (`Dockerfile`): multi-stage, Node 22, Next's standalone output (`NEXT_OUTPUT=standalone`, ignored by a normal build), a non-root user, no secret and no data inside. The two public Supabase values are build arguments because they are compiled into the browser code; everything secret is a run-time variable. Tested: built (430 MB), started read-only with all capabilities dropped against the local stack, `GET /api/health` ok, the container health check healthy, the job runner answered, the shared sign-in limiter counted in the database (10 attempts, then 429).
- **Single-host deployment** (`deploy/docker-compose.yml`): the web container and a scheduler container that calls the job runner every minute (waits for the web container to be healthy). Tested: two minutes of running, heartbeat under 20 seconds. A call made before the web container was ready failed once and was retried by the next minute's call, which is why the dependency on health was added.
- **Scheduler options:** the compose scheduler, a platform cron, or `pg_cron` with `pg_net` (`deploy/schedule-with-pg-cron.sql`, **not tested**). GitHub Actions schedules are not suitable on their own (best every 5 minutes, often late).
- **Production-safety observation:** the production container refused to report healthy (503) while the local database still had a development clock set by the browser tests, exactly as ADR-071 intends. `npm run dev:clock -- off` clears it.
- **Email go-live check** (`npm run email:check`): connects and signs in, looks up SPF and DMARC for the sender domain, sends one test message. Tested against an in-process SMTP server only.
- **Not done, needs the owner's accounts and choices:** a hosted Supabase project, a container host, DNS and a certificate, a real email provider, a restore drill from a real backup, a performance baseline with production-sized data, the first CI run on GitHub.


## ADR-074 — Navigation, interactive dashboard, branding, Business Units and Departments
**Status:** Accepted; built and tested locally. Owner direction (2026-10-15): a left sidebar with groups, fully interactive charts, tasks per Business Unit/Department on the dashboard, and a CMS-style way to upload the logo and favicon.
- **Business Unit and Department are one concept.** Every staff member belongs to one unit. A unit with `reports_weekly = true` is a Business Unit (must report, is scored and ranked); `false` is a Department (no weekly report, never counted as missing). No new table: the existing flag is the type. The create form now asks for the type (`create_business_unit(..., p_reports_weekly)`).
- **Navigation:** grouped, collapsible sidebar (Overview, Execution, Governance, Finance, Insights, People & organisation, Administration), each entry still gated by the same permissions as its page. A global **+ Create** menu (report a violation, request a disbursement, add a user, add a unit, start a report) opens the target dialog on arrival (`?new=...`). Ctrl K searches every page and action the person may use. Administration was split into Units, People, Calendar & holidays, Settings and Branding pages with an overview hub.
- **Dashboard analytics:** `read_dashboard_cells(quarter)` returns one row per unit per week (tasks done/not done/unmarked, goals, stored weekly score, compliance, on-time submission). It is SECURITY INVOKER and limited by `auth_can_view_bu`, so a BU Lead sees only their unit. The page folds those rows into counters, a stacked task bar, a status donut, score trend lines, a completion/punctuality trend, a unit-by-week heat map and a ranking table, with filters (type, units, week range) and drill-down to a unit. No score is recalculated in the browser. Charts use Recharts; every chart has a text alternative (ranking table and heat-map table) and the tooltip detail is also available by keyboard focus on the heat map.
- **Branding:** `app_branding` (name, 1–3 character mark, main colour) and `app_branding_assets` (logo, favicon as base64) with permission `branding.manage` (Super Admin, Admin). Raster images only (PNG, JPEG, WebP, ICO); SVG is refused because it can carry script; the server checks size and the file signature. The colour must keep 4.5:1 contrast with white text. The logo and favicon are served from `/branding/{logo|favicon}` with `?v=` cache-busting and a sandbox CSP, and are readable without signing in (they appear on the sign-in page). Changes are audited (the image bytes are not).
- **Approval:** the owner rule "all updates need approval" is **not** applied to branding, because it is cosmetic and changes no score, balance or permission. Applied directly and audited. Recorded in docs/25 for the owner to confirm.
- **Not built:** a free-form theme editor (only the main colour), dark mode, per-role dashboard layouts that the user can rearrange, and a cohort/department hierarchy (a Department under a Business Unit).


## ADR-075 — Premium interface: motion, 3D charts, step forms
**Status:** Accepted; built and tested locally. Owner direction (2026-10-15): a polished, premium look with 3D interactive graphs and charts, interactive cards and counters, animations and slider forms.
- **Libraries:** `motion` (Framer Motion) for animation, `recharts` for the 2D charts, `three` with `@react-three/fiber` and `@react-three/drei` for 3D. The 3D code is loaded only on request (`next/dynamic`, no server rendering), so the dashboard stays quick to open.
- **3D scenes:** stacked task columns per unit, a score landscape (unit by week), and a task-status ring. Drag to rotate, scroll to zoom, hover for detail, click a column to open that unit. Labels are textures on sprites and tooltips are ordinary page elements: the DOM-in-canvas helper from drei was rejected because it mounts a second React root per label and raised "unmount while rendering" errors under React 19.
- **Accessibility and fallbacks:** every 3D view has the same figures in a table (units compared, week-by-week status). People who ask their system for reduced motion start on the 2D charts, no counter animates, cards do not tilt, forms swap steps without sliding. If the browser has no WebGL the page says so and the 2D chart is used. The weeks filter is two native range inputs, so keyboard and screen readers work.
- **Interactive cards and counters:** cards tilt a few degrees toward the pointer and lift; counters spring to their real value (the real value is what is rendered and read out); the first appearance of each block staggers in.
- **Step forms:** Add user, Report a violation and Request a disbursement are short steps with a progress bar, Back/Next, per-step validation and a review step before anything is sent. The same API calls and rules apply; nothing about authorisation, idempotency or audit changed.
- **Surface:** gradient welcome banner with shortcuts, glass header, soft layered cards, animated active pill in the sidebar, animated dialogs and toasts, shimmer placeholders while the dashboard loads. The colour comes from Administration → Branding, so the whole look follows the chosen colour.
- **Testing:** the browser suite runs with reduced motion on for stability; `19-premium-ui` switches motion back on and covers the grouped sidebar, the Create menu, Ctrl K, the step forms, the 3D/2D switch, the filters and the drill-down.
- **Not built:** dark mode, a user-arrangeable dashboard, 3D for the Reports module pages.


## ADR-076 — Integrations module: email, AI providers and webhooks configured in the application
**Status:** Accepted and implemented (migration 20261022000001); decisions below were taken by the lead under the owner's delegation of 15 October 2026 and are listed in docs/25 rows 73–77 for confirmation.
- **What it is.** Administration → Integrations lists what is configured, lets an Admin or Super Admin add, edit, switch on or off, test and remove an integration, and replaces editing server files for email. Three kinds of slot and four kinds ship: email (`SMTP`), AI (`ANTHROPIC`, `OPENAI_COMPATIBLE`) and `WEBHOOK`. The kinds and their fields are data (`integration_kinds`); the screen draws its forms from them and the database checks every saved value against them. A new kind is a row plus an adapter in `src/lib/integrations/adapters.ts`, not a new workflow.
- **What is functional today.** Email: an enabled SMTP integration is the transport for the email outbox (`resolveEmail()`), with the server's `EMAIL_*` settings as the fallback, so an installation that already works keeps working. Webhooks: every audit-log row is offered to each enabled webhook whose event list matches it (`*`, a name or a prefix ending in `*`), delivered by the scheduler through `webhook_outbox` (leases, back-off 2/4/8/16 minutes, give-up after five attempts, 24-hour expiry), signed `x-okr-signature: sha256=HMAC(secret, "<timestamp>.<body>")`; `TEXT` format posts `{"text": "..."}` for Slack and Teams. AI: the connection is stored, encrypted and tested; **no feature of the application sends data to an AI provider yet** (`activeAi()` exists for the first feature that will; what may leave is a data-protection decision for the owner).
- **Secrets.** Passwords, API keys and signing secrets are encrypted in the web tier with AES-256-GCM before they reach the database (`INTEGRATIONS_ENCRYPTION_KEY`, 32 random bytes in the server environment; the field name is bound into the ciphertext; `INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS` and `npm run integrations:rewrap` support rotation). The table is closed to browser sessions (no policy, no grant); `read_integrations()` returns only which secrets are set; the database refuses any secret that is not ciphertext; the change request and the audit log hold ciphertext at most; approvers see "changed (hidden)". Without the key, settings can be saved but secrets cannot, and the screen says so.
- **Approval.** Topic `INTEGRATION` is **protected**: an Admin asks, a Super Admin approves (or applies it in an emergency), because redirecting email or events to another place is a way to take data out. Permissions: `integrations.view` and `integrations.test` (Admin, Super Admin), `integrations.configure` (protected; Admin, Super Admin). One email service and one AI provider may be switched on at a time; the clash is refused when the request is made.
- **Outbound address safety.** An address an integration connects to must be https (http only where private hosts are allowed), carry no user name or password, and resolve only to public addresses (not loopback, private, link-local, shared, multicast or reserved, IPv4 or IPv6); redirects are never followed; the check runs when a change is asked for and again before every delivery. `INTEGRATIONS_ALLOW_PRIVATE_HOSTS=true` switches it off for development and the automated tests; health raises a critical alert if it is on in production. Residual risk: DNS can change between the check and the connection; restrict the application's outbound network at the host where it matters.
- **Tests send only fixed harmless content:** a message to the person who clicked Test, a fixed sentence to an AI provider, a `TEST_PING` event to a webhook. The result of testing a saved integration is stored and audited (`INTEGRATION_TESTED`).
- **What leaves in a webhook:** the audit action, entity type and id, outcome, actor role, time and correlation id. Never the old or new values and never the reason.
- **Not built:** other kinds (SMS, chat apps with their own APIs, calendar feeds, single sign-on), per-event field selection, a delivery log screen beyond the counts on each card, replaying failed deliveries.


## ADR-077 — Editable landing page and sign-in screens
**Status:** Accepted; built and tested locally. Owner direction (2026-10-16): the landing page looked plain and had no picture; the landing and sign-in pages must be customisable from a screen, granularly, including uploaded pictures.
- **What can be changed:** the header (menu links, button text, sticky or not); the hero (three layouts, three colour tones, headline size, alignment, eyebrow, headline, sentence, two buttons, and a picture: built-in dashboard illustration, an uploaded picture, a slowly turning 3D field, or none; picture darkening for the full-width layout); up to twelve sections in any order, each hideable (feature cards, numbered steps, figures band, picture gallery, testimonial, checklist, call to action, text with picture) with its own heading, introduction, background, column count, button, picture and items; the footer. For the sign-in screens: four layouts (panel left, panel right, plain, full-page picture), panel colour, headline, up to five icon points, logo, built-in illustration or an uploaded picture with darkening, and the form's title, sentence, note, forgot-password link and back link. The same layout frames forgot-password and reset-password.
- **Data, not code:** the saved value is plain JSON (text, choices from fixed lists, picture names) validated as a whole by a schema before it is saved (`src/lib/site-content.ts`), and again resolved against it on every read: a value that no longer fits falls back to the built-in content for that page, so a bad save can never break the public pages. Links are limited to this site, an anchor, https and mailto (`javascript:`, `data:` and `//host` are refused). Text is rendered as text, never as HTML.
- **Pictures:** `site_images` (raster only: PNG, JPEG, WebP; SVG refused; at most 40; 2 MB each, checked by size and file signature on the server). The editor shrinks large photos in the browser before upload. Pictures are served at `/site-image/{name}?v=` (public, cached by version). After each save, pictures the page no longer refers to are removed. The picture bytes are never written to the audit log; the content before and after is.
- **Permission and approval:** `branding.manage` (Admin, Super Admin), the same as the logo and colour. Applied on save, audited (`SITE_CONTENT_CHANGED`, `SITE_IMAGE_CHANGED`), not routed through the two-person approval engine because it changes no score, balance or permission (confirm in docs/25).
- **Editor:** grouped, collapsible fields; a live preview of the real page, scaled, with desktop and phone widths; unsaved-changes notice; Discard and Reset to the built-in content; a link to open the live page. The preview is hidden from assistive technology and not focusable.
- **Look:** flat colours only (the owner asked for no gradients); large type, generous spacing, motion that respects the reduced-motion setting, and a built-in illustration so no page is ever empty.
- **Not built:** custom fonts and free colour pickers per section (tones come from the brand colour), a draft/publish workflow with scheduling, multiple languages, and arbitrary HTML.

## ADR-077 — Historical weekly reports are loaded by a Super Admin through a rehearsed, recomputing import, and "reserved" permissions are added to RBAC

- **Status:** accepted (owner decisions: history is recomputed, goes back to January 2025, Super Admin only, no second approver; RBAC to be improved).
- **Decision:** a Super Admin uploads a spreadsheet of past weekly reports (Year, Week, BU/Depart, SubKR, Goal, Task 1..n with Status 1..n). The file is read as data, staged in `historical_import_batches` / `historical_import_rows`, checked by the database (`history_issues`), **rehearsed** (the real import and the real scoring run inside a sub-transaction that is always rolled back, and its quarterly scores are shown) and then **committed** in one transaction. Scores are produced by the ordinary `finalize_reporting_week` and `snapshot_quarterly_scores`; no legacy score is copied.
- **Who:** the new permission `history.import`, held only by Super Admin. Commit needs no second approver (owner decision) but needs a fresh authenticator code and the typed confirmation `IMPORT HISTORY`, is audited (`HISTORICAL_IMPORT_COMMITTED`), and the staged rows become immutable once committed. The same file (SHA-256) cannot be committed twice.
- **RBAC improvement:** `permissions.reserved`. A reserved permission can only sit on a role that also holds `roles.manage`; the role engine refuses anything else (`ROLE_RESERVED`) whoever asks, even a Super Admin. Marked reserved: `history.import`, `roles.manage`, `config.protected.approve`, `config.emergency`, `ledger.reversal.emergency`, `attendance.session.outcome.emergency`, `strategy.annual_theme.change_exception`. `read_permissions()` exposes the flag.
- **No side effects:** while the import runs the session flag `app.historical_import` is on: no FINAL_LOCKED notifications, no webhook outbox rows, and the per-week quarterly snapshots are skipped (one snapshot per quarter is taken at the end). Task history carries the new source `HISTORICAL_IMPORT`.
- **What it creates:** missing quarters as LOCKED with placeholder objective / key results / Sub-KRs (titles say "historical, imported"); missing weeks under the current lock schedule; reports recorded as submitted and reviewed; Business Units whose first week in the file precedes their creation date are back-dated so earlier weeks do not count against them (the quarterly calculation ignores weeks before a unit existed).
- **Refused:** a quarter that has not ended, a week not yet closed, an organisation-holiday week, a week the application already finalised, a unit that already has a report for the week, a duplicate goal, an unknown unit or malformed Sub-KR. All are listed with their spreadsheet row; nothing is written unless the whole file is clean.
- **Gap weeks:** by default only weeks that have rows are scored. An option scores the rest of each touched quarter, so a unit with no row for a week gets the normal "no report" result.
- **Not built / consequences:** there is no rollback after commit (the application never deletes reports); the safety is the rehearsal and a database backup. Sub-KRs are matched by number, so "2.10" typed as a number loses its zero. Placeholder strategy text should be replaced if the organisation wants real wording.

## ADR-078 — Conflicts with the previous application are settled in favour of the new rules

- **Status:** accepted by the owner on 2026-10-17 ("I agree with your suggestion" for every conflict in docs/33; week numbering left as built; role mapping left as built; three violation types preloaded).
- **Decisions:** (C1) weekly score stays done goals over all goals, old goal scores are never copied; (C2) Undefined tasks become Not Done at final lock; (C3) one penalty rule: rates summed, applied once, floor 0; (C4) ISO weeks in Lagos, no alternative numbering; (C5) versioned lock schedule, no bypass switch; (C6) a quarter locks when the next begins, strategy changes by approved request; (C7) the weekly score is the only score, with an optional read-only Sub-KR contribution view (Phase E, not yet built); (C8) roles stay as built, no Manager, Member or Viewer role is added; (C9) two-person approval stays; (C10) a person may have a sign-in and be left off the attendance roster; (C11) lateness is a violation type, not an attendance status; (C12) the owner enters violation types, with three preloaded.
- **Built under this ADR (Phase A):** `employees.on_attendance_roster` (default true) honoured when a roster is created and when a skipped session creates its virtual-present roster; `set_employee_roster` (users.manage, audited as `EMPLOYEE_ROSTER_CHANGED`); the People page now lists every employee with sign-in and roster state; starting violation types Phone violation 5,000, Late coming 3,000, Absent 5,000 NGN loaded by `npm run org:load`.
- **Consequences:** old weekly scores and penalties are not carried over; anyone who held Manager, Member or Viewer in the old application needs a new-build role chosen by the owner when their account is created.

## ADR-079 — Strategy is loaded from a sheet by the Super Admin tier, into empty quarters only

- **Status:** accepted as part of the gap-closure plan (docs/33, Phase B).
- **Decision:** a Super Admin uploads one row per Sub-KR (Year, Quarter, Objective, KR, KR title, Sub-KR, Sub-KR title). The database checks the whole sheet (`strategy_import_issues`) and writes it in one transaction (`strategy_import_commit`). Each quarter needs exactly one objective, 3 or 4 key results numbered from 1 without gaps, and at least one Sub-KR under each, numbered from 1 without gaps.
- **Scope:** it fills quarters that have no objective yet and are not active. A quarter that has ended is stored LOCKED (so historical reports can be attached to it); any other is stored PLANNED and is activated through the normal screen. An ACTIVE quarter is refused: its strategy is a controlled baseline changed only by an approved request (ADR-065), so the import cannot be used to bypass that.
- **Control:** reserved permission `strategy.import` (Super Admin tier only, see ADR-077), fresh authenticator code, typed confirmation `IMPORT STRATEGY`, no second approver (same owner position as the historical import). The file checksum is stored in `strategy_import_batches` (immutable) so the same file cannot be applied twice; the commit is audited as `STRATEGY_IMPORTED`.
- **Not built:** replacing or amending an existing quarter, annual themes in the same sheet (themes keep their own screen), per-row rollback.

## ADR-080 — Sign-ins and roles can be created in bulk for people who are already employees

- **Status:** accepted as part of the gap-closure plan (docs/33, Phase C).
- **Decision:** a sheet with Email and Roles (role codes or names) gives existing, active employees without a sign-in an account and roles. Each account is created through `provision_user`, the function behind Add user, so the same rules apply: the actor needs `users.manage`, handing out a privileged role needs `roles.manage` (checked before and again by the database), and the audit entry is `USER_CREATED`. Nobody chooses a password: each person gets a one-time set-your-password link, shown once on screen and downloadable as a CSV.
- **Difference from the earlier plan:** the earlier plan proposed an approval for imports that change reporting rights. The manual Add user screen has no such approval, so the import follows the same rule instead of being stricter than the manual path; a fresh authenticator code is required. Change this if the owner wants an approval on both.
- **Not atomic:** an identity is created per person, so a failing row is reported and the rest still go ahead; a failed row leaves no half-made account. Running the same sheet again reports "already has a sign-in" for the people already done.
- **Employees stay in the existing employee import**; this import never creates employees.

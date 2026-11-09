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
**Status:** SUPERSEDED by ADR-086 (4 November 2026): the owner decided a violation is never reopened.
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

## ADR-081 — An unreviewed report keeps its score, and the denominator includes weeks not yet finalised

- **Status:** accepted by the owner on 2026-10-20 (asked for the best option on each open question). This ratifies the behaviour already built in `20261014000004_scoring_integrity_jobs.sql` (`calculate_quarterly_score`); no code change was needed, only the documentation that still called these questions open.
- **Unreviewed report at quarter finalisation:** a submitted report whose review is pending keeps its computed weekly score. It is never zeroed because a review is outstanding, never auto-reviewed, and never counted as a missing report. The week is reported with contribution state `AWAITING_REVIEW` and counted in the awaiting-review total. The quarter stays `PROVISIONAL` while any submitted report is unreviewed, so a provisional result is published rather than withheld or overstated. Reviewing the report and recalculating writes a new FINAL version; the provisional snapshot is never overwritten.
- **Weeks not yet finalised:** the denominator is every non-holiday calendar reporting week of the quarter, excluding weeks that ended before the business unit existed (ADR-042), including weeks that have not reached final lock. Such a week contributes `0.00` as `PENDING` — not `MISSING_ZERO`, which stays reserved for a week whose final lock passed without a report — and keeps the quarter `PROVISIONAL`. Mid-quarter scores are therefore provisional by construction and must not be read as a finished-quarter result. This is the fixed denominator already required by AC-SC-012 and ratified here explicitly for future weeks.
- **Consequences:** `docs/00-SOURCE-OF-TRUTH.md`, `docs/07-SCORING-ENGINE.md` and `docs/20-ACCEPTANCE-CRITERIA.md` (AC-SC-013, new AC-SC-016) now state the rules instead of deferring them. Covered by the new DB test "a submitted but unreviewed report keeps its score and holds the quarter PROVISIONAL (ADR-081)" in `tests/db/scoring_integrity.test.ts`, next to the existing fixed-denominator and missing-report tests.
- **Lock ruling (2026-10-20):** review never blocks the quarter lock. Reports carry a non-blocking review marker (`NOT_REVIEWED`/`REVIEWED`, ADR-038); the lock is calendar-driven (`quarter_is_locked`), and at final lock any task still `UNDEFINED` is automatically recorded as `NOT_DONE` by `finalize_reporting_week` (`20261014000004_scoring_integrity_jobs.sql:259`) before the score is computed. The only effect of a pending review is that the quarterly snapshot stays `PROVISIONAL` until it is done. No code change was needed.

## ADR-082 — Editable landing page and sign-in screens
**Status:** Accepted; built and tested locally. Owner direction (2026-10-16): the landing page looked plain and had no picture; the landing and sign-in pages must be customisable from a screen, granularly, including uploaded pictures.
- **What can be changed:** the header (menu links, button text, sticky or not); the hero (three layouts, three colour tones, headline size, alignment, eyebrow, headline, sentence, two buttons, and a picture: built-in dashboard illustration, an uploaded picture, a slowly turning 3D field, or none; picture darkening for the full-width layout); up to twelve sections in any order, each hideable (feature cards, numbered steps, figures band, picture gallery, testimonial, checklist, call to action, text with picture) with its own heading, introduction, background, column count, button, picture and items; the footer. For the sign-in screens: four layouts (panel left, panel right, plain, full-page picture), panel colour, headline, up to five icon points, logo, built-in illustration or an uploaded picture with darkening, and the form's title, sentence, note, forgot-password link and back link. The same layout frames forgot-password and reset-password.
- **Data, not code:** the saved value is plain JSON (text, choices from fixed lists, picture names) validated as a whole by a schema before it is saved (`src/lib/site-content.ts`), and again resolved against it on every read: a value that no longer fits falls back to the built-in content for that page, so a bad save can never break the public pages. Links are limited to this site, an anchor, https and mailto (`javascript:`, `data:` and `//host` are refused). Text is rendered as text, never as HTML.
- **Pictures:** `site_images` (raster only: PNG, JPEG, WebP; SVG refused; at most 40; 2 MB each, checked by size and file signature on the server). The editor shrinks large photos in the browser before upload. Pictures are served at `/site-image/{name}?v=` (public, cached by version). After each save, pictures the page no longer refers to are removed. The picture bytes are never written to the audit log; the content before and after is.
- **Permission and approval:** `branding.manage` (Admin, Super Admin), the same as the logo and colour. Applied on save, audited (`SITE_CONTENT_CHANGED`, `SITE_IMAGE_CHANGED`), not routed through the two-person approval engine because it changes no score, balance or permission (confirm in docs/25).
- **Editor:** grouped, collapsible fields; a live preview of the real page, scaled, with desktop and phone widths; unsaved-changes notice; Discard and Reset to the built-in content; a link to open the live page. The preview is hidden from assistive technology and not focusable.
- **Look:** flat colours only (the owner asked for no gradients); large type, generous spacing, motion that respects the reduced-motion setting, and a built-in illustration so no page is ever empty.
- **Not built:** custom fonts and free colour pickers per section (tones come from the brand colour), a draft/publish workflow with scheduling, multiple languages, and arbitrary HTML.

## ADR-083 — Report review comments and rejection

- **Status:** built and tested locally (`20261030000002_report_review_comments.sql`, `20261030000003_report_rejection_notice.sql`, `tests/db/report_review.test.ts`). The specs did not define a rejection; this is the smallest behaviour that fits ADR-081 and ADR-038 and is flagged for the owner to confirm or change.
- **Review comments:** a reviewer (`weekly_report.review`) may attach up to 2000 characters of comments when marking a finalised, submitted report reviewed. Comments are stored on the report and in the `REPORT_REVIEWED` audit entry.
- **Rejection is a review event, not a status.** `reject_weekly_report` needs a mandatory reason (up to 2000 characters), records who and when, writes `REPORT_REJECTED` to the audit log and notifies the BU Leads of that unit. `review_status` stays `NOT_REVIEWED`, so the report still counts as awaiting review, the quarter stays `PROVISIONAL` (ADR-081) and the score is untouched. A report can be rejected more than once; each event is audited.
- **Closing a rejection:** a later review clears the rejection from the report view (the audit trail keeps it). A reviewed report cannot be rejected.
- **Immutability:** final-locked reports still reject every change except the review columns (`review_*`, `rejected_*`, `reviewed_*`).
- **Not built:** a resubmission loop (a rejected report is not reopened; reopening is only through the late-report exception path).

## ADR-084 — Weekly quote workflow, and repairs found while closing gap-plan phases D to F

- **Status:** built and tested locally (`20261030000005_quote_workflow.sql`, `20261030000004_unit_hierarchy_fix.sql`, `tests/db/quote_workflow.test.ts`, `tests/db/unit_hierarchy.test.ts`). Quotes were listed as "only if the owner still uses quotes" (docs/33 phase F); the table and the recording screen already existed, so the workflow was completed rather than removed. The owner may still choose to drop it.
- **States:** `draft` (recorded, `quote.record`) → `submitted` → `approved` → `published` → `archived`. One quote per reporting week (existing unique key), so at most one published quote per week. Each step is audited (`QUOTE_SUBMITTED/APPROVED/PUBLISHED/ARCHIVED`); submitting notifies everyone holding `quote.approve`.
- **Segregation of duties:** approving, publishing and archiving need the new `quote.approve` permission (Admin, Director, Super Admin). The person who recorded or submitted a quote cannot approve it (`QUOTE_SELF_APPROVAL`), enforced in the database.
- **Immutability:** the words, speaker and author never change and quotes are never deleted; the trigger allows only the four legal status steps.
- **Banner:** every signed-in user sees the active week's *published* quote on the dashboard (`read_published_quote`); nothing else about quotes is exposed.
- **Repairs:** (1) the earlier unit-hierarchy migration dropped the functions it had just created, so units could not be created through the API at all (the route sent fields the live function rejected); `create_business_unit` and `update_business_unit` are redefined, the hierarchy fields change only when the caller says so (`p_set_hierarchy`), and an approved `BU_REPORTING` change carries the unit type and hierarchy. (2) The quote routes called functions that did not exist. (3) The Sub-KR contribution card read the wrong response shape and could never render.
- **Not built:** rejecting a submitted quote (it simply is not approved), editing a recorded quote, and publishing a replacement after one is archived for the same week.

## ADR-085 — Super Admin holds every permission; fund purposes; Skip OKR reason; cumulative strategy scores

- **Status:** built locally (`20261101000001` to `20261101000004`). Database tests for these are not yet written.
- **Super Admin:** holds every permission that exists, including the ones that Finance and attendance keep apart for other roles. Self-approval stays blocked inside `approve_disbursement`, `release_disbursement` and the attendance amendment decision, so the Super Admin still cannot decide their own request. The Super Admin account is hidden from the People list and taken off the attendance roster; only a Super Admin sees it.
- **Fund-request purposes:** a managed list (`disbursement_purposes`), maintained by `finance.purpose.manage`; a trigger rejects a request whose purpose is not an active entry. Details go in the justification.
- **Skip OKR:** `skip_okr_session` now requires a written reason (stored as `skip_reason`, audited, put in the BU Lead notification and shown on the session and the weekly report).
- **Strategy scores:** Sub-KR execution counts every goal in a submitted report (not only final-locked ones) so figures move as tasks are marked; each Key Result carries the cumulative total of its Sub-KRs.
- **Default quarter:** Dashboard, Performance, Strategy and Reports open on the active quarter only if it already has reports, otherwise on the latest quarter that does.
- **Super Admin applies configuration changes directly** (`20261101000005`, `20261101000006`): owner decision, because there is only one admin-level user and two-person approval left every Settings change pending. The request row is still written, validated and audited; it is marked `emergency` and `direct_by_super_admin` so the record shows that no second person approved it. Admin and other roles still need a different approver.
- **Suspending a week's locks** (`20261101000007`): permission `reporting.locks.suspend` (Super Admin). A suspended week reports as OPEN, is skipped by the scheduled jobs and cannot be finalised; restoring hands control back to the clock. A final-locked week cannot be reopened. Both changes are audited with a reason. Admin: Calendar & holidays → Reporting locks.
- **SMART on every goal:** goals without a stored evaluation (imported history) get one computed on read by the same deterministic rules; nothing is written.
- **When reporting opens** (`20261101000008`): a week's opening time defaults to its start (Monday 00:00 WAT) and can be set per week (earlier or later, before the content lock) and reset, with a reason, by `reporting.week.manage`. Admin: Calendar & holidays → Reporting window and locks. Suspending locks does not change a holiday week: a Business Unit still sees "report not required" until the holiday is reversed.
- **Global reporting window** (`20261101000009`): the versioned lock schedule now also holds when reporting opens (day, time, week offset from the week before to three weeks after). A new version applies to weeks generated afterwards; `apply_schedule_to_existing_weeks` (`reporting.week.manage`, audited, reason required) moves every week that has not final-locked, is not suspended and is still on an older version onto the policy in force. Per-week opening times and suspended locks stay as exceptions. Admin: Calendar & holidays and Settings.
- **Speed:** filters change only the section they affect (Performance and the Dashboard sections stream inside their own loading boundaries; drop-downs use a transition and keep the page on screen); unused fetches on the Dashboard page were removed; `experimental.staleTimes` (dynamic 30s) opens recently visited pages from the browser cache. **Weekly:** an always-visible "Add weekly report" button states why it is disabled when no week can be started.
- **Filing on behalf of a unit** (`20261101000010`): permission `weekly_report.file_for_any_bu` (Super Admin). `actor_may_file_for` replaces the own-unit check in the functions that work a report (lease, edit, execute, delete, summary, submit), and `get_or_create_weekly_report` takes an optional unit honoured only with that permission. The Super Admin stays the actor in the audit trail; creating a report records `on_behalf_of_unit`. Only units that file weekly reports qualify, and locks, holidays and the one-report-per-week rule apply unchanged. Weekly page: "Working on behalf of" picker.
- **Report comment and bulk goals** (`20261101000011`): `weekly_reports.comment` (up to 4000 characters, editable until the week is scored) is written in a rich-text box; it is stored as plain text in a small markdown-like subset (`lib/rich-text.ts`) and rendered only from that subset with every character escaped, so no markup can run. `bulk_create_goals` adds up to 100 goals with their tasks from a .csv/.xlsx in one all-or-nothing step through `create_goal`; the API (`weekly-reports/[id]/bulk-goals`) checks the whole file first and returns every problem by sheet row.
- **SMART engine 2** (`smart-rules-2.0.0`, still deterministic and advisory): word-stem matching for action verbs and for the Sub-KR overlap, a larger verb and vague-word vocabulary, measures (counts, units, money, targets, checkable outcomes), exact deadlines (weekday, date, clock time) scored above general ones, plan size, repeated or thin tasks, all-or-nothing and long-horizon wording, and suggestions written from the goal's own text. A goal mapped to a Sub-KR starts at 72 for relevance (the mapping is the explicit claim) and rises with shared key words. The goal form no longer has a Description field (older goals keep theirs); the weekly comment card sits under the goals.
- **Business Unit goals** (`20261102000001`): `bu_goals` (a unit's own goals per quarter; permission `bu_goals.manage` for BU Lead, Admin and Super Admin; the Super Admin keeps any reporting unit's). A weekly goal is aligned twice: to the organisation Sub-KR and to a unit goal (`smart_goals.bu_goal_id`). Once a unit has active goals for the quarter, a KR-aligned weekly goal must name one (`GOAL_BU_GOAL_REQUIRED`); a stretch goal may; the goal must be the unit's, from the report's quarter and active (`GOAL_BU_GOAL_INVALID`). Retiring a goal keeps the weekly goals already pointing at it. The bulk upload has a BU goal column (by title). **Week by week**: an interactive line chart of goals done against tasks done (weekly score switchable) on the weekly report page and the weekly list. The "Not available yet" card was removed from the Reports page.
- **Intelligence** (`20261102000002`, `lib/insights/bu-intelligence.ts`): for each unit, whether its quarterly goals will be met, from the weekly goals aligned to them. Fixed, explainable rules, no model: each unit goal is projected from its weekly completion (recency-weighted, damped trend, held down by weeks without activity); On track from 70%, At risk from 50%, else Off track; the quarter score is forecast from the weekly score (share of goals done) with a range and the weekly average still needed for 70%; alignment compares weekly and unit goal wording; risks are ranked rules. A week still in progress (not ended, tasks unmarked) is not evidence yet. Shown on the weekly page and report, the dashboard (unit view and an organisation roll-up) and the presenter page. **Seed data**: `npm run seed:bugoals -- add|remove --yes` (local only; backs up first; `remove` deletes exactly what it created from `.local/seed-bu-goals-manifest.json`, and restores the locks it suspended).
- **Management brief** (`20261102000003`, `lib/insights/management-brief.ts`, page `/insights`): the weekly view for executives and administrators. Per unit: main reason a unit is not on track (one cause, in order of how fixable it is), last week against the week before, capacity (tasks planned against finished; over-committed under 55%) and goals set again without being finished, goal difficulty and score checks (late-marked tasks, corrections after the lock, late submissions, a near-perfect score from light goals), peers (units grouped by planned workload), and what-ifs (direct arithmetic on the quarter score: finishing last week's goals, every remaining week +10). Organisation: Sub-KR coverage (uncovered, concentrated), decision queues with their age, attendance and open violations, recognition, and an intervention log (`insight_actions`) that shows how a unit's weeks went after an action. Lateness is only counted where nobody authorised it: weeks with suspended locks and authorised late reports are back-fills, not lateness. Unit card and presenter page gain the reason, workload, difficulty and what would help.
- **Access control, deeper** (`20261103000001`): (1) every permission has a module and a risk level (low, medium, high, critical; protected and reserved are critical); (2) a person can be given any single permission directly, with a reason and an optional end date (`grant_user_permission`, `roles.manage`): reserved permissions are refused, a protected one only if the grantor holds it, a grant that would create a conflict of duties is refused, and an expired grant stops counting in the database check (`actor_has_permission`) and in the application. **Fixed:** the application built a person's permissions from roles only, so a direct grant (a "designation") was honoured by the database but invisible in menus and pages; it now includes unexpired grants. New page `/admin/access`: People (roles, permission and critical counts, direct grants, last sign-in), Roles & permissions (matrix by module, CSV), Access review (critical access on dormant accounts or without a required authenticator, conflicts of duties, grants with no end date or ending soon, people with several roles, empty roles); `/admin/access/[person]` shows what the person can and cannot do in plain terms, what is missing and which existing role would add it, every permission with its source, and direct grants. The role editor groups permissions by module with a search, risk labels, select-all, a change summary and "start from an existing role".
- **Unit scope and access reviews** (`20261103000002`): a person can be limited to chosen units (`user_unit_scopes`, set by `roles.manage` with a reason): `assert_unit_scope` is called by the violation functions (create, update, record payment, void) and by setting and amending a person's attendance; a person with no scope is unrestricted and organisation-wide work (holding a session, finalising a roster, skipping) is not limited. Reading is unchanged: scope limits what a person can do, not what they can see. **Access reviews** (`access_reviews`, `access_review_items`, `access_review_settings`): opened by hand or by the scheduled job when due (default every 3 months, on), a snapshot line for every active person, a decision for each (Right as it is / Needs a change with a note), nobody decides their own line, and a signed-off review (with a statement) is immutable; the signer's own line is recorded as not reviewed. Database tests: `tests/db/rbac_access.test.ts` (grants, scope, reviews). The role-matrix fixture and several older tests were updated for rules changed on purpose: a Super Admin holds every permission and applies configuration changes at once, a skipped session needs a reason, and fund purposes come from a list. Two policies that called a permission function per row were corrected.
- **Violations & Funds** (`/violations`): the violation module and the violation fund are one module with four tabs, shown by permission. **Overview**: fund balance, money in and out by month, runway at the recent rate of spending, violations raised and collected, unpaid by age, by type and unit, repeat violations, recent activity and rule-based insights (`lib/insights/violation-overview.ts`: low collection rate, old unpaid fines, rising violations, concentration, repeat violations, contested share, fund runway, slow request queue). **Violations**: report and track to payment, with status, unit and "unpaid over a week" filters; a contested violation is cleared by voiding it. **Fund**: requests with approval and release, and the ledger with reversals. **Settings**: violation types and fines (add and edit; a Super Admin applies at once, others need approval) and the purposes offered on fund requests. The old addresses (`/governance/violations`, `/finance`, `/finance/ledger`) forward to the right tab, keeping `status` and `new`. The menu has one entry, "Violations & Funds".

- **Payment methods and generated references.** Payment methods are a managed list (Violations & Funds > Settings), each with a unique three-character code that starts every payment reference, made by the database as `CODE-YEAR-000001`; nobody types a reference. A method flagged "salary deduction" settles as DEDUCTION_RECORDED, any other as PAID; codes never change. The quote of the week picks its speaker from the people list and takes the BU from that person.

- **SMART checks the goal only** (`smart-rules-2.2.0`): tasks are no longer an input of the SMART checker, so they never raise or lower a goal's score; Achievable now judges the scope the goal's own wording claims. A title that does not read as real words (shape rules: vowels, no triple letters, no q without u, no long consonant runs, no letters inside numbers) has every score scaled down, to a quarter at most. Scores are worked out on every read, so existing goals re-score at once.

- **Executive performance intelligence report** (`/insights/report`, from the management brief): 15 sections built by `src/lib/insights/executive-report.ts`, fixed rules over the data already held (no AI). Every finding is labelled fact, calculated, interpretation, forecast, hypothesis or recommendation; root causes are split into confirmed-from-data and plausible-needs-validation; a 5x5 risk register with inherent and residual scores, bands (1-4 Low, 5-9 Moderate, 10-14 High, 15-19 Very High, 20-25 Critical, proposed not approved), velocity and a basis for each rating; early-warning indicators with proposed thresholds; repeated goals classified from wording matched across weeks; actions and decisions as recommendations only. Goal owner, rollover, creation date and blockers are not recorded by the application, so owners and deadlines are never invented and accountability findings are hypotheses. The organisation average is shown to one decimal near the target (69.7
- **Executive performance intelligence report** (`/insights/report`, opened from the management brief): 15 sections built by `src/lib/insights/executive-report.ts`, fixed rules over the data already held (no AI). Every finding is labelled fact, calculated, interpretation, forecast, hypothesis or recommendation; root causes are split into confirmed from the data and plausible, needs validation; a 5x5 risk register with inherent and residual scores, bands (1-4 Low, 5-9 Moderate, 10-14 High, 15-19 Very High, 20-25 Critical: proposed, not approved), velocity and the basis of each rating; early-warning indicators with proposed thresholds; repeated goals classified from wording matched across weeks; actions and decisions are recommendations only. Goal owner, rollover, creation date and blockers are not recorded by the application, so owners and deadlines are never invented and accountability findings are hypotheses. The organisation average is shown to one decimal near the target (69.7%, not "70% against 70%").

- **Closing the open items.** The BU Lead settles an Undefined task by clicking its Undefined badge (Done / Not done appear). The requester can withdraw a fund request that is still waiting (status WITHDRAWN, no money committed). A running week with no report is not counted as missed until it is over. The dashboard shows three cards (tasks, goals, tasks-against-goals performance, each 70/30 with the units) for one chosen week, with a weekly dropdown; the charts below still show every week. The SMART rating shown for a goal is always computed from its wording with the current rules (before, a stored rating was shown when one existed, so older goals kept their old score). The Super Admin is hidden from person pickers for everyone else. Fixed a bug where six functions reported a missing record as success (the unit-scope check reset FOUND).

- **A passed final lock is final.** Locks suspended on a week hold it open only until its final lock time; after that the week is final-locked (immutable) and the scheduled job finalises it (migration 20261104000014). To add a report for a week that has already ended use an authorised late report or the history import. The dashboard's "this week" cards now show goals (total, done, not done, still open), tasks (total, done, not done, not yet marked), the score with whether it improved on the week before, and attendance at that week's OKR session. The "Units by week" and "Activity" panels were removed from the dashboard. "Performance week on week" charts task completion against goals completion (the average of each unit's rate) by week, month, quarter or year. Weekly Execution has a timeline of the quarter's weeks as score bars against the 70% target.

- 2026-11-04 The Executive Performance Intelligence Report is the management brief itself at `/insights` (it had first been added beside the brief at `/insights/report`, which left the brief unchanged). The earlier unit tables and the action log moved to `/insights/detail`; `/insights/report` redirects to `/insights`.

- 2026-11-03 4COREPAL (ADR): an additive AI Performance Agent module. Ownership is the business unit (a BU is a department; no assignee), a task is due at the end of its scheduled week, and a per-task remark (ai_task_remarks) is requested from BU Leads for tasks left unresolved after final lock. The language model never produces numbers or reads the database directly; it calls allowlisted read-only tools as the signed-in user. Autonomy is governed by risk: HIGH-impact actions (goals, targets, scores, history, ownership, cancellations) always need human approval. Feature flag `ai_settings.enabled` defaults off. Design: docs/38-4COREPAL-DESIGN.md.

- 2026-11-04 4COREPAL phase 2: the foundation (ai_ tables, 17 ai.* permissions, settings, action and escalation policies, jobs and usage) is applied. The module is OFF by default. A high-impact action can never be automatic (check constraint + function). Provider calls go through one door (src/lib/ai/provider.ts) that enforces the daily ceiling and the hourly allowance and records every attempt; prices start at 0 so no cost is invented. The scheduler hook is not wired to run_scheduled_jobs() until phase 4.

- 2026-11-04 4COREPAL phase 3: the read-only assistant. The model never gets the database: it asks 9 allowlisted, scoped tools through a JSON protocol, tool results are cleaned and fenced as untrusted data, every figure in an answer must appear in the tool results (otherwise the written answer is withheld), and business unit names are replaced by placeholders on the way to the provider. Scope is decided in code from who is asking and again by row-level security. Conversations are private to their owner, even from a Super Admin.

- 2026-11-04 4COREPAL phase 4: the daily review (findings + remark requests) runs from the existing scheduler through one guarded call. A task is eligible for a remark when its week is final, it is not Done and its unit reports weekly (due = end of its week); one batched request per unit and week, one reminder, one escalation to executives; a remark is append-only and never touches the task or a locked week. The Super Admin does not hold ai.remark.submit.

- 2026-11-04 4COREPAL phase 5: cases, adaptive engagement, monthly closure and corrective plans. Nothing an answer or approval does changes an official goal, target or score; an approved disposition is a recorded decision that stops re-asking. Plans are drafted by the agent, submitted by a person, decided by a different person; effectiveness is judged on later scores, never on actions ticked done. Admin gains ai.action.assign.

- 2026-11-04 4COREPAL phase 6: predictions come from the application's own forecasting rules, never the model; 13 deterministic reports with fixed-wording commentary and audited CSV export; the executive centre and reports reconcile with the Management brief because they use its engine; model-written explanations are shown only if every figure in them is in the report. Departments are business units, so no separate departmental report.

- 2026-11-04 4COREPAL phase 7: administration. Every severity must keep an escalation step that reaches the executives; the agent cannot change its own settings, policies, escalation or anyone's access (proved by a test over the function definitions); messages are purged after the retention days by one function only; the switch and every configuration change need a recent second factor and are audited with old and new values. Execution of approved changes and a document knowledge base are not built.

- 2026-11-04 4COREPAL phase 8: readiness. Security tests over every ai_ table and function, an end-to-end journey test, and 34 browser tests of every screen (zero accessibility violations); implementation report in docs/39. The module stays OFF by default and has not been run against a real AI provider or mail server.

## ADR-086 — Owner decisions of 4 November 2026
**Status:** Accepted; migration 20261104000023. The two DB behaviours were written without a running database (Docker was off), so `npm run test:db` must be run before release.
- **A violation is never reopened.** Reversing the ledger entry of a violation payment posts the compensating entry, writes `VIOLATION_PAYMENT_REVERSED` to the audit trail and leaves the violation settled. The payment is shown as reversed. Supersedes ADR-065.
- **Correcting a session cancels its attendance amendments.** The amendments that refer to the roster being replaced are marked cancelled (pending ones become `CANCELLED`; decided ones keep their decision and get a row in `attendance_amendment_cancellations`), a `CANCELLED` event and one audit row are written, and the correction proceeds. The roster is still archived, never lost. Supersedes the `SESSION_CORRECTION_BLOCKED` rule of ADR-063.
- **All scoring is weekly.** In a historical import, weeks of the touched quarters with no rows are scored as missed reports by default (the "also score weeks with no rows" box starts ticked; it can still be unticked for a sheet that lists only weeks where a report was sent).
- **Import rollback.** Only a Super Admin may void an import, and only inside a rollback window. See ADR-087.

## ADR-087 — Rolling back an import (step 1: employees and Business Units)
**Status:** Accepted; migration 20261104000024. Strategy, sign-in and history imports follow in ADR-088.
- **Who and when.** Only a Super Admin (checked in the database, with a fresh authenticator code, the typed words VOID IMPORT and a reason of at least 10 characters), only within 72 hours of the commit (`import_void_window()`; changing it needs an ADR). Never after the window; the only later route is the normal correction paths or break-glass database access.
- **What it does.** Nothing is deleted. Rows the import created are deactivated; rows it changed are restored from before-values the commit now stores in `import_batch_rows.before`. A permanent `import_voids` record, an `IMPORT_VOIDED` audit row and a notice to approvers are written. Voiding twice returns the first result.
- **What blocks it.** Any imported record changed after the commit (`updated_at` later than the commit), a created person who now has a sign-in, attendance or a violation, or a created unit that now has people or reports. All blockers are listed and nothing is changed (all or nothing). Imports made before this change have no before-values, so a batch that changed existing records cannot be voided; one that only created records can.
- **API/UI.** `POST /api/v1/imports/batches/{id}/void` (step-up) and a Roll back button on the import history for Super Admins.

## ADR-088 — Rolling back strategy, sign-in and historical imports
**Status:** Accepted; migration 20261104000025. Same rules as ADR-087: Super Admin only, fresh authenticator code, typed `VOID IMPORT`, reason of at least 10 characters, within 72 hours, all-or-nothing, refused with the reasons listed. A permanent `import_rollbacks` row, an audit entry and a notice to approvers are written.
- **Strategy.** The import's Sub-KRs, key results and objective are copied to `strategy_import_archive` and removed; a quarter the import created is removed, a quarter it locked is put back to PLANNED. Refused if the quarter is no longer in the state the import left it, if anything was edited after the import, or if weekly goals or other records now depend on it.
- **Sign-ins.** The import now records who it created (`sign_in_import_batches`, `sign_in_import_users`). A rollback removes only accounts that have never signed in, never acted and still hold the roles they were given, through the ordinary delete-user function, then deletes the sign-in identity. The whole rollback is refused if any account fails those tests. Safe to repeat if it stops part-way.
- **History.** `history_commit` now stores a picture of what existed before (`history_prestate`: quarter states, week ids, strategy ids, quarterly snapshot ids, unit creation dates). The rollback removes the reports, goals, tasks, task status history, weeks, weekly compliance and score snapshots, quarterly snapshots, placeholder strategy and created quarters that were not in that picture, restores quarter states and unit creation dates, marks the batch VOIDED so the same file can be loaded again, and is refused if a week that existed before was locked by the import, if the reports in the new weeks are not exactly the imported ones, or if anything else (amendments, exceptions, corrections, assistant records) now depends on them. Imports made before this change have no picture and cannot be rolled back.
- **How deletes are allowed.** The immutability triggers on these tables honour one transaction-local flag, `app.import_void`, which only the void functions set (the same pattern as the session correction). Audit entries, notifications, the batch and its staged rows are never removed.


## ADR-089 — OKR Session Notes: an OKR session is not the HR attendance session
**Status:** Accepted; migrations 20261105000001 to 3; full description in `40-SESSION-NOTES.md`.
- **Finding.** `governance_sessions` is one organisation-wide row per reporting week (unique on the week) that holds the HR attendance roster, the outcome (`SCHEDULED/HELD/SKIPPED`) and the quote. An OKR review is held per business unit, may be repeated in a week and produces notes, decisions and commitments. They are two business events with different owners and cardinality, so they are **not merged**.
- **Relationship.** `okr_sessions.governance_session_id` is an optional reference only. Nothing in the module writes to attendance, rosters, outcomes, violations, the quote, weekly reports, goals, tasks, scores or compliance (tests compare the rows before and after).
- **Several sessions per unit and week** are allowed on purpose (no unique key); accidental duplicates are prevented by request keys (ADR-090), not by a constraint.
- Sessions on a finalised week or locked quarter remain readable and usable; they never write to the week.

## ADR-090 — Session Notes: access model, request keys and optimistic concurrency
**Status:** Accepted.
- **Permissions are data** (ADR-069): `session_notes.view/view_all/create/update/finalise/archive/export/configure`, `session_decisions.create/approve`, `session_actions.create/assign/update/verify`, `session_risks.manage`. `view_all` and `approve` are protected (only a holder can delegate them).
- **No automatic content access** for HR, Finance, Admin or Super Admin. ADR-085's "Super Admin holds every permission" was a one-time grant of the permissions that existed then; the new codes are **not** granted to it, and Admin and Super Admin receive only `session_notes.configure` (session types). This differs from the 4COREPAL grants on purpose, at the owner's instruction for this module.
- **Visibility** is decided once in `okr_session_visible_to` / `okr_note_visible_to` and used by row-level security and by every function. Notes carry a classification `SHARED / MANAGEMENT / CONFIDENTIAL`. Not found and not permitted look the same in the app.
- **Approval authority.** Presenters hold `session_decisions.approve` (the facilitator is the authority in the room); Executives and Directors are read-only. A four-eyes rule between the person who proposes and the person who approves is **not** enforced (open decision 1 in `25`). The approver is recorded, with an optional authority text (for example "Management committee").
- **Concurrency and duplicates.** Every mutable record has a `version`; writes carry `expectedVersion` and a stale one is `409 VERSION_CONFLICT` with nothing overwritten. State-changing acts accept a request key (`okr_idempotency`); a repeat returns the first answer, the same key for another act is `IDEMPOTENCY_KEY_REUSED`; note, decision, action and risk creation also accept a `clientKey`.
- **Nothing is deleted.** Notes are archived with a reason; participants are removed with a date; attachments are withdrawn; versions, events and finalised minutes are immutable.

## ADR-091 — Session notes: format, autosave and version history
**Status:** Accepted.
- **Format.** Notes are stored as text in a safe markdown subset (headings, bold, italic, code, lists, checklists, tables, quotes, rules, links) and rendered to HTML only by `src/lib/session-notes/markdown.ts`, which escapes every typed character, emits a fixed tag set, and keeps only http, https and mailto links. The editor is a toolbar-driven text area with a live preview that keeps the browser's own undo and redo; no new rich-text dependency is added and no HTML is ever stored. A visual (WYSIWYG) editor is a possible later enhancement; the stored format would not change.
- **Autosave.** 1.5 s after the last keystroke, with states Saved / Unsaved changes / Saving / Retrying / Save failed (and a conflict state). Retries after 2 s, 5 s and 15 s on network or server failure, then manual *Retry now*. Unsent text is kept in the browser's storage and offered back; leaving the page warns and makes a last attempt.
- **History.** Each save increments the note's version. The state being replaced is written to `okr_session_note_versions` when it had settled for 60 seconds, was written by someone else, or the change is an amendment, reclassification, archive or restore. Intermediate keystroke states are not stored; every settled state is. After a session is completed a change needs a reason and is recorded as an amendment.

## ADR-092 — Session registers: decisions, actions, risks and carry-forward
**Status:** Accepted.
- **Decisions** are `PROPOSED` until a holder of `session_decisions.approve` approves; an approved decision is replaced by *supersede* (new approved decision, old one `SUPERSEDED` and linked), never edited. Rejecting or withdrawing needs a reason.
- **Actions** are one row for the life of a commitment. Carrying forward writes an `okr_session_carryovers` review (unique per session and item) and an event; it never copies the action. Deadline extension needs a justification and keeps the original date; escalation notifies the executives and the facilitator once. Reassignment needs a reason and keeps both people in the history. An assignee who is suspended or no longer employed cannot be chosen. Completion requires remarks, and evidence or verification where the action asks; the verifier cannot be the person who completed it. **Completing an action never changes an OKR task, goal, report or score.**
- **Risks** are formal records (`session_risks.manage`); an observation stays a note. Repeated issues are recognised by unit and normalised title across sessions.
- **Reminders.** `run_okr_session_reminders` (in the scheduler) sends one "due soon" notice (due within 2 days) and one "overdue" notice per action and due date, and respects the global reminder switch; email follows each person's preference.

## ADR-093 — Session minutes and AI assistance
**Status:** Accepted.
- Minutes go `DRAFT → SUBMITTED → REVIEWED → FINALISED`. The proposed text is assembled deterministically from the records (twelve headings; confidential notes never, management notes only for management minutes; proposed decisions are labelled not formal). Finalising requires a completed session, freezes the revision with a snapshot of the records and a SHA-256 hash, and notifies the participants; a later change is a new revision that amends the earlier one (kept). Reviewer and drafter may be the same person (open decision 2).
- **AI** reuses 4COREPAL (`complete()`): off by default, needs `ai.assistant.use`. It returns **text for the editor only**; it creates no decision, action or risk and changes no record. A proposal that names a `DEC`, `ACT`, `RSK` or `OKS` reference not in the session, or a figure not in the records, is discarded. Notes reach the model fenced as data. A draft that started from an AI proposal is flagged and still has to be saved, submitted, reviewed and finalised by people; every request is audited.

## ADR-094 — Session notes: mentions, the visual editor and upload scanning
**Status:** Accepted; migration 20261105000004. Closes three limits listed in `25` (no mentions, no visual editor, no malware check).
- **Mentions.** A note may contain `@[Full name](user:<uuid>)`. The visual editor and the text editor insert it from the session's participants. A database trigger (`okr_notify_note_mentions`) tells each mentioned person **once per note** (`SESSION_MENTION`, dedupe `okrment:<note>:<person>`), but only if that person may read that note (session access plus the note's classification). A person who could not read it is never told it exists, so a mention cannot leak a management-only or confidential note; the author is never notified; a bad token or a notification problem never breaks saving. The notice names the session, not the note's words, and follows the existing email preference. The reading view shows `@Name`, never the id.
- **Visual (what-you-see) editor.** The default mode, with a switch to the text editor (the choice is remembered per browser). The person edits the rendered note; every change is converted back to the same markdown text by `src/lib/session-notes/html-to-markdown.ts`, an allow-list walk (headings, bold, italic, code, lists, checklists, tables, quotes, rules, links through the same `safeUrl`, mentions with a real uuid; scripts, styles, frames, attributes and unknown tags contribute nothing, typed markup characters are escaped so they stay literal). The editor's HTML is never stored and never trusted: it is rebuilt from the text by the safe renderer, pasted content is inserted as plain text, and the stored format, versions, search, minutes, exports and AI input are unchanged.
- **Upload scanning.** `src/lib/security/attachment-scan.ts` runs before a session attachment is recorded or stored. (1) Built-in inspection, always on: the EICAR test signature, programs and scripts behind an allowed type, PDFs with script/launch/embedded files (disguised names decoded, compressed stream bodies not searched), Word/Excel files with macros, Office zip files with macros, embedded objects or programs (entry names read from the zip's central directory), script hidden in an image. (2) ClamAV when `CLAMAV_HOST` (and optionally `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`) is set: the bytes are streamed to clamd (INSTREAM) and its verdict is final; if the daemon cannot be reached the upload is refused (`503 SCAN_UNAVAILABLE`, fail closed) unless `ATTACHMENT_SCAN_REQUIRED=false`. A refused file is `422 MALWARE_DETECTED`, is never recorded or stored, and leaves `REJECTED_BY_SCAN` in the session timeline and audit log; an accepted one logs `SCANNED_CLEAN` with the engine. **The built-in layer is not an antivirus and cannot recognise unknown malware; production should run ClamAV.** The evidence upload route used elsewhere is unchanged.

## ADR-095 — The 4COREPAL assistant can search the OKR session notes
**Status:** Accepted. No migration.
- Five read-only tools join the assistant's allow-list (`src/lib/ai/tools/sessions.ts`): `search_session_notes` (full-text over notes, decisions, actions and risks, with the library's filters), `get_session_record` (one session with its notes, decisions, actions, risks and minutes status; by id or reference), `list_session_actions`, `list_session_decisions`, `list_session_risks`. The system prompt tells the model to search them before saying something is not known, to quote the notes, to name whose note or which decision a statement comes from, and to keep PROPOSED apart from APPROVED decisions.
- **Access is the person's own.** The tools need `session_notes.view` (and the existing `ai.assistant.use`), and read through the same functions the screens use, as the signed-in person, so row-level security already hides other units' sessions, management-only notes from a BU Lead and confidential notes from everyone but the author and facilitator. A session the person cannot read gets the same answer as one that does not exist. "Mine" means the asker, never a name from the model. Unit names become placeholders; note text is stripped of markup and tag characters and fenced as data like every other tool result; every result names the sessions it came from, and the answer is still checked so every figure comes from a tool result.
- Nothing here writes. It does not change the minutes AI summary (ADR-093), which stays a draft for a person to review.
- Known limit: the assistant is off until the AI module is switched on, and the quality of its answers depends on the configured model; this was verified against fake models in tests, not against a live provider.

## ADR-096 — Executive Oversight: advice, not instruction; comments, recommendations and Session Notes stay three different things
**Status:** Accepted; migrations 20261106000001 to 4; `41-EXECUTIVE-OVERSIGHT.md`.
- **Three records, three rules.** A *comment* (`eo_comments`) is an observation or a question and starts no response workflow. A *recommendation* (`eo_recommendations`) is a formal piece of advice with its own lifecycle. A *Session Note* (`okr_session_*`) is a record of what happened in a meeting. They reference each other (ADR-100); none writes another.
- **A recommendation is advice.** It is addressed to one or more units, each of which accepts, partly accepts or declines it with a reason. Declining is a legitimate answer and has no compliance consequence. The response vocabulary has no "approve the change" and no status that reads as an order.
- **No write path to operational data.** Every function in the module writes only `eo_*` tables (and notifications / audit). No role gains any operational permission. This is verified by tests that snapshot weekly reports, goals, tasks, objectives, key results, attendance sessions, violations, the ledger and quarters before and after complete journeys.
- **Not a new approval mechanism.** Where the unit agrees, it makes the change through its own workflow and *links* that record to the recommendation (a reference only).
- A decision (`okr_session_decisions`) is not reused for a recommendation: it is an outcome of a meeting with its own approval lifecycle. A recommendation may link to one.

## ADR-097 — Executive Oversight: access model
**Status:** Accepted.
- **Commenting never exceeds viewing.** Executives and Directors already read every unit (`weekly_report.view_all`, `dashboard.executive.view`). The module adds the right to write about what they may read, not to change it. A subject is accepted only if it exists, belongs to a unit the item is about and the author may read it; otherwise `LINK_TARGET_INVALID` (the same answer as a missing record).
- **Permissions are data.** Fourteen codes (`executive_comment.*`, `executive_recommendation.*`, `executive_oversight.*`) are inserted with their module and risk and mapped to roles by the migration; `executive_oversight.view_all` is protected (critical). Executives and Directors author; BU Leads answer for their own unit and report progress; Presenters read and reply for their own unit; Admin and Super Admin only configure categories and timelines; HR and Finance hold nothing.
- **Visibility has one meaning, two implementations that are tested against each other.** The write functions use `eo_comment_visible_to`, `eo_rec_visible_to` and `eo_target_visible_to`; the row-level policies express the same rules with per-statement caller facts so that reads stay fast (a per-row call of the full functions measured 3 s for a dashboard of 18 records). A *management-only* comment is hidden from the unit. A draft is visible only to its author. A unit's person sees only their own unit's record of a multi-unit recommendation.
- **The unit answers for itself.** `respond` and `update_progress` act only on the person's own unit. `view_all` never allows answering for a unit (tested).
- **Super Admin.** Its "every permission" grant (ADR-085) predates these codes and deliberately does not include them (same approach as ADR-090). It can reach content only through the governed, audited role process.
- **Open decision recorded:** Presenters currently read only their own unit's commentary (ADR-097 is deliberately narrow); `25` lists the alternative.

## ADR-098 — Executive Oversight: one lifecycle per addressed unit
**Status:** Accepted.
- A recommendation addressed to several units has **separate acknowledgement, response, contact, history and closure for each unit** (`eo_rec_targets`); one unit's answer changes nothing for another.
- Record level: `DRAFT → ACTIVE → CLOSED`, `DRAFT/ACTIVE → WITHDRAWN`. Unit level: the thirteen statuses of the specification; the transitions, the actors and the mandatory words (decline reason; explanation for partial, alternative, clarification) are enforced in the functions. `awaiting` (`BU`/`EXECUTIVE`) says whose move it is; a unit waiting for an Executive's answer is not overdue.
- **Closing is not resolving.** Closing means the author has finished following it up; the event says so and nothing else changes. Closing before a requested response is allowed, needs a reason and is flagged and shown. The author closes; if the author is no longer active, another holder of `executive_recommendation.close` may.
- **A published recommendation cannot be edited** (trigger and function); a correction is a withdrawal and a new recommendation, or a message. Drafts are editable by the author, with a version check.
- A duplicate (same author, title and set of units within 10 minutes) is refused as `DUPLICATE_RECOMMENDATION`; a retried request is recognised by its key (ADR-102).

## ADR-099 — Executive Oversight: history is kept
**Status:** Accepted.
- Nothing is deleted. `eo_events` (replies, responses, updates, status changes, reassignment, escalation, links, files) and `eo_comment_versions` refuse update and delete (`forbid_mutation`); every event is also written to `audit_logs` in the same transaction (`EXEC_OVERSIGHT_*`). Attachments are withdrawn with a reason, not erased.
- Comments: only the author amends, with a reason and a version check; the earlier wording stays readable to everyone who can read the comment and the repliers are told. A trigger refuses a change of content that has no saved earlier version, and any change of author, unit, module or subject. Withdrawing a comment keeps it readable, marked withdrawn.
- Database triggers also refuse deletion of comments, recommendations and (once published) their addressed-unit records, so even a privileged SQL session cannot silently rewrite the history without defeating a named trigger.
- Archiving a unit or an OKR record does not touch the commentary: links keep their label and unit; the unit's page says it is archived; the unit can still answer.

## ADR-100 — Executive Oversight: links by validated reference
**Status:** Accepted.
- A comment or recommendation links, by id, to sessions, notes, decisions, actions, risks and OKR components (theme, quarter, objective, key result, Sub-KR, unit goal, weekly goal, task, weekly report). It is stored without a foreign key (as in ADR-089) so it still reads after the target is archived, but every link is **validated on write** by a resolver (`eo_assert_ref`): the record exists, belongs to a unit the item is about, and the author may read it (a confidential note the author cannot read cannot be linked).
- A link is **shown only to people who may read the target**: row-level security hides a link to a session record the viewer cannot open, so a unit cannot learn a management-only title from a link.
- Linking never writes to the target. Session Notes shows nothing new; the search runs both ways (`read_eo_recommendations` and `read_eo_comments` accept a linked record).
- The addressed unit may *add* the workflow item it uses to carry the advice out (never remove the author's links).

## ADR-101 — Executive Oversight: follow-up and escalation
**Status:** Accepted.
- Configurable in `eo_escalation_rules` (Admin / Super Admin, audited): four stages — approaching deadline (days before), reminder to the unit's leads, management contact (default: the author), senior authority (default: the DIRECTOR role) — with days and recipient kind. Seeded defaults are configuration, not code.
- `run_eo_follow_up()` runs with the existing scheduler (patched into `run_scheduled_jobs`, and honouring `notification_settings.reminders_enabled`). It is idempotent per target, stage and deadline (dedupe keys; one `ESCALATED` event per stage). A suspended responsible contact is reported once to the unit's leads.
- **No automatic consequence.** Nothing marks a unit non-compliant, changes a score or blocks anything because an advisory recommendation is unanswered, declined or unimplemented. Any formal consequence needs an explicitly approved organisational rule (open decision in `25`).

## ADR-102 — Executive Oversight: duplicates, concurrency and notifications
**Status:** Accepted.
- Every write that could create or advance a record accepts a request key (`okr_idem`): a repeat returns the first answer; the same key for another act is `IDEMPOTENCY_KEY_REUSED`. The forms keep one key per deliberate act and keep what was typed on failure, so a network interruption cannot post twice or lose text.
- Concurrency: replies lock the comment row and are stored in order; a recommendation locks the record then the unit's row (a fixed order, so two operations cannot deadlock); drafts, comments and unit records carry versions (`VERSION_CONFLICT`).
- Notifications go through `notify_users` (idempotent by dedupe key, never failing the act) via ten optional email event types (`EO_*`), honouring preferences. Priority `HIGH`/`CRITICAL` is shown in the notification title; priority changes nothing else. Notification routes open the oversight page (`src/lib/notification-actions.ts`).

## ADR-103 — Executive Oversight: the contextual panel, exports and files
**Status:** Accepted.
- One server component (`ExecutiveCommentary`) drops an "Executive Commentary" button onto Performance, the weekly report, Presentation mode, Strategy (objective and each key result), the executive dashboard, the Management brief, Business unit goals, the Session workspace, the commitments registers and historical report snapshots. It draws nothing for roles that cannot read commentary. It opens a side panel beside the record, with the unit, quarter, week and record already filled in; people reply in place and open the full page for more.
- Exports reuse `src/lib/reports/export.ts` (CSV, Excel, PDF: formula-injection defence, row cap) behind `executive_oversight.export`, built from the caller's own readable rows, and recorded in the audit log (`record_eo_export`).
- Files reuse the private `evidence` bucket and every upload check of ADR-094 (type, signature, size, malware inspection); the database records and authorises first, and withdraws the record if storage fails.

## ADR-104 — The 4COREPAL AI assistant is removed
**Status:** Accepted (owner decision, 2026-11-05).
- **Why.** The assistant needs a language model, either a paid external provider or a locally installed one, and the owner does not want that dependency.
- **What was removed.** The pages (`/ai` and everything under it), the API routes (`/api/v1/ai/*`), the library (`src/lib/ai`), the navigation entry, the AI provider card on the Integrations page, the "Propose a summary with AI" button and route in session minutes, the AI notification routes and access-map entry, and their tests (database, HTTP and browser).
- **What was kept, on purpose.** The database objects (tables, functions, the `ai.*` permissions and the `ai_run_jobs` call inside the scheduler) stay: applied migrations are never edited, dropping tables risks data, and with the module switched off they do nothing. Minutes keep the `ai_drafted` marker so old minutes that were started from an AI proposal still say so. Nothing in the running application calls an AI provider, and nothing asks for an AI key.
- **If it is ever wanted again.** Restore from the git history before this commit (`src/lib/ai`, `src/app/(app)/ai`, `src/app/api/v1/ai`). The database side is still in place.

## ADR-105 — Session types, Oversight settings and the late-report workflow are removed
Decided by the owner: session types and Executive Oversight settings had no purpose, and no report may be submitted late. The pages, API routes and menu entries are deleted; OKR sessions no longer ask for a type (the API defaults to the weekly review type) and the escalation defaults stay as built. At the final lock, tasks still UNDEFINED become NOT_DONE automatically (unchanged behaviour); there is no exception route. Database objects for late-report exceptions and session types are left dormant (immutable history is not dropped); the late-report reports metric is historical only.

## ADR-106 — People lifecycle journey
`employee_lifecycle_events` is an immutable, trigger-fed record of joins, sign-in creation, transfers between business units, role grants/removals (flagged as promotions when a lead role is granted), and (de)activation or suspension. Admins move or promote a person with a required reason through `transfer_or_promote`; reports and history are untouched by a move. A person reads their own journey at /account/journey; Admins read anyone's at /admin/people/{id}.

## ADR-107 — Audit event model: extend `audit_logs`, layers are views
**Status:** Accepted (owner approved the approach, 2026-11-05).
- One table, one writer. `audit_logs` gains the enterprise event fields (category, severity, channel, request/session/workflow ids, actor snapshot, parsed device, metadata); `write_audit` keeps its signature so ~175 action codes and every existing test keep working. A BEFORE INSERT trigger completes every row (also direct inserts). Outcomes widen to SUCCESS, FAILURE, DENIED, REJECTED, PARTIAL.
- "audit / security / system logs" are the views `security_logs` and `system_logs` over the same rows (same ids, `security_invoker`, no copies). Domain timelines (`okr_session_events`, `eo_events`, `employee_lifecycle_events`) stay as they are; system-made lifecycle events are mirrored into the audit log by a trigger.
- Category and default severity come from data (`audit_action_rules`); a refusal or failure is never below MEDIUM. Secrets are redacted by key name at any depth before storage.
- Event id, affected record id and request id are three separate fields.

## ADR-108 — Audit request context is passed by the app server
Every write uses the service-role client, so Postgres saw the server's headers. The API wrapper now builds an audit context per request (client address counted from the right by `TRUSTED_PROXY_HOPS`, user agent, a one-way reference to the sign-in session, a fresh request id, channel) and sends it as `x-audit-*` headers on its service calls; the trigger stores them (`ip_trusted = true`). Only service-key calls reach these headers. Refusals that never reach a business function (no sign-in, second factor missing, rate limit, cross-site) are recorded by `record_security_event` (collapsed per address and route for 5 minutes); evidence downloads and audit access (viewing, CSV/PDF export) are recorded too. Recording a refusal never changes the answer the caller gets; a download is recorded before it is served.

## ADR-109 — Tamper evidence: hash chain, revoked privileges, history left alone
Owner decision: the chain starts at a recorded genesis (`audit_chain_meta`); rows written before are not modified or back-filled. Each new row stores `chain_seq`, `prev_hash` and `row_hash = SHA-256` over its meaning-bearing fields; inserts are serialised by an advisory lock. `audit_verify_chain` reports the first changed, relinked or missing row; a failed verification is itself a CRITICAL event. INSERT, UPDATE, DELETE and TRUNCATE on `audit_logs` are revoked from every application role (the immutability trigger remains as a second layer). Residual: the database owner can still bypass both and is *detected*, not prevented; a full rebuild needs an off-box copy of the latest hash (docs/42 section 7). Online archiving/removal of old rows is deliberately not built.

## ADR-110 — Detection rules produce indicators, not accusations
Rules are data (`audit_detection_rules`: patterns, window, threshold, group-by, severity); the scheduler evaluates them and writes `audit_alerts` (no repeat for the same events within the window) with the wording "a signal to review, not a finding about anyone", notifying holders of `audit.alerts.manage`. Reviewers set an investigation status; closing needs a note; every status or rule change is itself audited. Changing a rule needs `audit.rules.configure` (Super Admin only, protected), a recent second factor and a reason. Ten rules ship (failed sign-ins, repeated denials, administrator role granted, own roles changed, role/permission definition changed, Super Admin volume and off-hours, schedule/lock change, unusual exports, integrity failures).

## ADR-111 — Audit & Security Centre
`/audit` becomes the Centre on the existing design system: KPI cards, category chips, filters (dates, person, role, business unit, action, entity, outcome, severity, channel, address, session, request), expandable events with who / where from / identifiers / field-level before-and-after, a trace of related events (same record or workflow, request, session, person), indicators, rules and an integrity tab. Viewing is audited (one entry per person per minute); CSV and PDF export (10,000-row cap, formula-safe CSV, PDF with the chain verified at export time) are audited with their format and filter. Access stays `audit.read` (Super Admin, Admin); the two new permissions govern indicators and rules.

## ADR-112 — The Super Admin holds every session-notes permission
**Status:** Accepted (owner decision, 2026-11-06); migration 20261106000006. Reverses the part of ADR-090 that withheld the session permissions from the Super Admin.
- The Super Admin is granted all `session_notes.*`, `session_decisions.*`, `session_actions.*` and `session_risks.manage` permissions that exist today, as ADR-085 did for every other permission. Admin keeps only `session_notes.configure`; HR and Finance still hold none.
- **No limit (extended the same day, migration 20261106000007).** The Super Admin also reads CONFIDENTIAL notes of other people and may verify a completion they recorded themselves. What does not change is integrity, not access: every act is audited, and versions, the session timeline, finalised minutes and request/version checks stay as they are.
- Permissions added to this module later are not granted automatically; a migration must grant them, as with ADR-085.

## ADR-113 — Weekly quote rota, and a simple Note Taker role
**Status:** Accepted (owner request, 2026-11-06); migration 20261106000008.
- **Rota.** HR (`quote.assign`, also Admin and Super Admin) chooses which business unit gives the quote in each weekly session. The allocation is configured with the calendar (Calendar & holidays, "Weekly quote allocation"); the unit's own page is Weekly quote. The unit's leads (`quote.submit`) are notified (`QUOTE_TURN_ASSIGNED`), enter the quote and pick who said it from the unit's own active team. The Super Admin can do this for any unit; the record says it was entered on the unit's behalf. Table `quote_turns` with an immutable `quote_turn_events` trail; one active turn per week.
- **No approval step.** A submitted quote goes straight to the Presenter's Quote review; it may be changed until it has been presented. HR/Super Admin can correct before the session.
- **A skipped session moves the quote, it does not invalidate it.** The row is never rewritten: the session in which a turn is shown is computed (`read_quote_effective_week`: its own week, or the next normal week whose session is not SKIPPED). The unit is told (`QUOTE_TURN_MOVED`) that nothing needs to be redone.
- **Quote review** on Presentation mode lists the quotes for the presented week (with any moved in, labelled), shows each on the whole screen, marks it presented (`presentation.view`, which the Super Admin holds). The earlier single-quote tables and screens (`weekly_quotes`) are left untouched and used only when no rota turn exists.
- **Note Taker.** A non-system role (`NOTE_TAKER`) holding only `session_notes.view / view_all / create / update / export`. Its screens (`/notes`) open ONE organisation-wide minutes page per weekly session, not one per unit (`get_or_create_notes_session(actor, week)`, migration 20261106000009, idempotent), with a single rich-text note seeded with Notes, Recommendations, Actions and Next steps. It is an ordinary OKR session and note underneath, so the full module sees the same record; a person holding only this role does not see the advanced navigation.

## ADR-107 — "OKR session notes" and "Commitments & registers" are removed from the menu; Take notes is the one place
Decided by the owner: the session notes are captured in Take notes (/notes), so the separate OKR session list, session workspace, Commitments & registers page, "Start an OKR session" action and the Presentation-mode notes card are deleted. Take notes keeps working on the same session records underneath. The tables, functions and API routes for decisions, actions, risks and exports stay in place but unused, so no history is dropped; notifications and Executive Oversight links now open Take notes.

## ADR-114 — Only the Super Admin changes a unit between Business Unit and Department
**Status:** Accepted (owner request, 2026-11-08); migration 20261109000002.
- **What the type is.** Audit of the code and migrations: `unit_type` is a classification label. Weekly reports, scoring, rankings, compliance, goals, the quote rota, reminders and dashboards key off `reports_weekly` and `status`; access scope keys off the unit id. So promoting a Department or demoting a Business Unit moves it between the two groups (admin Units screen, performance picker) and changes nothing else.
- **Rule.** `change_business_unit_type(actor, unit, type, reason)` needs the new permission `business_units.change_type`, held only by SUPER_ADMIN (not Admin; not requestable). It takes a row lock, requires a reason, refuses an invalid or unchanged type and an unknown unit, and writes `BU_TYPE_CHANGED` (old/new type, reason, counts of child units, people and reports for context). It never changes `reports_weekly`, status, parent, people, reports or scores; whether a unit files weekly reports stays the separate, approved reporting control. It is a one-step Super Admin change (no second approver), with step-up on the route.
- **No bypass.** `update_business_unit` (behind PATCH and approved BU_REPORTING requests) now requires the same permission when the type differs; PATCH answers `USE_TYPE_CHANGE`. Creating a unit with a type and the unit import are unchanged.
- **Ambiguity recorded, safest behaviour chosen.** The specification does not say whether a Department may parent a Business Unit, or whether a promoted unit must report weekly. No rule was invented: the hierarchy allows any combination and the reporting flag is left as it is; the confirmation dialog says so and points to the reporting control. Finalised scores and filed reports are untouched; the audit entry keeps the history.

## ADR-115 — Automated OKR report summaries by email
**Status:** Accepted (owner request, 2026-11-09); migrations 20261109000004 (feature) and 20261109000005 (classes `business_units.change_type` critical, as every protected permission must be).
- **What it is.** Weekly, monthly, quarterly and annual summaries of Business Unit results, emailed to people an Admin chooses. A *schedule* (frequency, send weekday or day of month, time, recipients, sections, on/off) produces a *run* for one period; a run has one *delivery* per recipient. Page: Reports → Email reports (`/reports/email`).
- **Periods.** Calendar weeks (Monday to Sunday, ISO week), months, quarters and years in Africa/Lagos. Only a period that has ended is ever summarised. Weekly goes out on the chosen weekday after the week ended; the others on the chosen day (1 to 28) of the month after the period ended. A schedule never reports on a period that ended before it was created. The annual summary is built from the four quarters.
- **Once per period.** `report_email_runs` has a unique (schedule, period) rule, so a repeated job run, a manual send of an already-sent period and a race between the two are all refused (`REPORT_EMAIL_ALREADY_SENT`). A run missed because of an outage is picked up at the next job (the last two periods are considered), and a run left half-sent by a crash is finished.
- **How the job reads the data (changed from the first proposal).** The first proposal was a read-only service account that runs the existing reports. Every report read depends on the caller's second-factor state (`auth_aal_satisfied`), so a login-based account cannot work without weakening that rule. Instead two service-role-only functions, `email_report_weekly_rows` and `email_report_quarter_rows`, read the same sources as `read_report_weekly_scores` and `read_report_quarter_scores` (latest snapshot per unit and week; latest quarterly snapshot and the one before) and return Business Unit rows only. No person, no finance figure and no free text is read. Neither function nor the three new tables can be used by a signed-in user or by anonymous callers (tested).
- **Content.** Built by `src/lib/report-email/summary.ts` from those rows: average score and change, reports on time and missed (holiday weeks excluded), ranking with movement, trend, top scores and biggest improvements, attention items, and up to four insights from the same rules engine as Insights (no AI). Empty periods say so instead of showing zeros.
- **Email format.** HTML made of tables with inline styles (bars are table cells, no images, no scripts, no style sheets) plus a plain-text version. `Mail` gained an optional `html` and the three transports (SMTP integration, environment SMTP, Resend; the file transport spreads the mail) pass it on. One email per recipient, so nobody sees the other recipients. Everything that came from data is HTML-escaped. The subject is `4CORE OKR — <Weekly|Monthly|Quarterly|Annual> summary · <period>`.
- **Recipients.** Active people with an account only (checked when the schedule is saved and again at send time); up to 50. Free-typed outside addresses are not allowed, so figures cannot leave the people who can already sign in.
- **Permissions.** `report_email.manage` (schedules, preview, test), `report_email.send` (send now, retry), `report_email.history`; Admin and Super Admin. Every change goes through a database function that checks the permission and writes an audit record (`REPORT_EMAIL_SCHEDULE_CREATED/CHANGED/DELETED`, `REPORT_EMAIL_SENT_MANUALLY`, `REPORT_EMAIL_RETRIED`, `REPORT_EMAIL_TEST_SENT`, `REPORT_EMAIL_PREVIEWED`, `REPORT_EMAIL_RUN_STARTED`).
- **Delivery and retry.** The scheduler (`/api/internal/jobs/run`) sends due summaries after the other jobs and reports the result as `reportEmails`; a failure there never fails the job. Each recipient's result is stored; Retry re-sends only the failed deliveries (people who got it are not mailed again). A run is Sent, Partly sent, Failed, Empty (no recipients) or Pending. The email provider is the one already in force (SMTP integration, else environment); with none configured, deliveries fail visibly and can be retried.
- **Own table, not the notification outbox.** The outbox carries one plain-text notification per event; summaries need HTML, per-recipient history and a retry button, so they have their own run and delivery tables and share only the transport.
- **Not included (decided).** Per-recipient scope (everyone gets the organisation-wide summary; there is no unit-limited variant), attachments (PDF or Excel), and quarter definitions other than the calendar quarters.

## ADR-116: Word-style notes editor with section cards

**Status:** Accepted (owner request, 2026-11-09). No database change.
- **What changed.** The Take Notes visual editor is now built on Tiptap (ProseMirror) with a ribbon (Home, Insert, Table, View): styles, bold, italic, underline, strike-through, text colour, highlight, clear formatting, bulleted, numbered and checklist lists, three levels of nesting, alignment, quote, link, table (add or delete rows and columns), horizontal line, date, @mention, an action item with owner and due date, preview, full screen and zoom. On the central Take Notes page the note is shown as one card per `## ` heading (Notes, Recommendations, Actions, Next steps, and any the person adds); cards can be renamed, reordered, collapsed and deleted. The ribbon works on the card being edited.
- **Storage is unchanged in kind.** A note is still one markdown text; the cards are cut from it at `## ` lines and joined back (`src/lib/session-notes/format.ts`), so existing notes, versions, amendments, autosave and the minutes export keep working. The format gained only fixed vocabulary: `++underline++`, `~~strike~~`, `{c:name}text{/c}`, `{h:name}text{/h}` (colour and highlight names from a fixed palette), `{center}` / `{right}` / `{justify}` at the start of a block, and two-space nesting of list items (three levels).
- **Safety is unchanged.** The editor's HTML is never stored or trusted: every change is converted back to text by `html-to-markdown.ts`, an allow-list walk that keeps only the names above (anything else, including a colour that is not in the palette, is dropped). The renderer emits only fixed tags, classes and `data-align` values; a typed marker is escaped so a person cannot create formatting by typing it. Pasted content is always inserted as plain text. `u` and `s` were added to the tags a note can produce.
- **Not included (decided).** Merging table cells and a toggle for the header row (a markdown table cannot store them: its first row is always the header), font sizes and fonts, and print layout.
- **Why a library.** The earlier editor relied on `document.execCommand` (deprecated) and a hand-built toolbar; Tiptap gives predictable behaviour for lists, tables and undo, and each feature maps to something the note format can store.

## ADR-117: Scripted notification emails and invitation emails

**Status:** Accepted (owner request, 2026-11-09). Migration 20261109000006 (audit function only).
- **Problem.** Notification emails were the in-app notification's title and message in plain text, with a generic "Open the application" link and no greeting. People added to the platform were never emailed: the Add user, Give sign-in and sign-in import screens only showed the set-up link to the administrator.
- **One layout.** Every email the application sends (`src/lib/email/layout.ts`) has a greeting by first name, a short scripted message, an optional box with the specifics, optional "If this was you / If this was not you" notes, one button, the signature "4Core BizOps Team" and a footer that says why the person got it (security, operational, reminder, or account). HTML plus a plain-text twin; everything is escaped and only http(s) links are made.
- **Per-event copy.** `src/lib/email/events.ts` holds the words for every emailed event type (subject prefix such as "Action required:", an opening sentence, the button and the page it opens). The notification's own specifics (unit, week, amount, reason) are always kept in the box. The quote emails and the security emails are written out in full. An event type with no entry still gets the layout, with the notification's own words. A test fails if an emailed event type has no copy. The outbox row is enriched with the event type and the person's first name by `src/lib/email/enrich.ts` when it is claimed; no change to the outbox tables.
- **Password-changed wording (decided).** The security email says "Your password was changed", not "unusual activity", because it is sent for the person's own change; it keeps the If-this-was-you / not-you structure. The authentication service's own password-changed notification is switched off (`supabase/config.toml`) so one change does not produce two emails.
- **Invitations.** After an account is created (Add user, Give sign-in, sign-in import) the person is emailed an invitation (`src/lib/email/invite.ts`, `send-invite.ts`) with a one-time set-up link to `/auth/confirm`. The link is made fresh at send time and is never stored; each attempt is audited with its outcome (`USER_INVITATION_SENT`, `_NO_PROVIDER`, `_FAILED`) through `record_user_invitation` (service role only). The administrator's screen still shows the link and the initial password as a fallback and says plainly when the email could not be sent. People who have never signed in get a Resend invitation button (`POST /users/:id/invite`, `users.manage`); an earlier link stops working when a new one is made.
- **Link lifetime (decided).** 24 hours (`otp_expiry = 86400`). Reset links share this setting, so the password-reset email now says 24 hours instead of one.
- **Authentication emails.** The reset-password, invitation and password-changed templates in `supabase/templates/` use the same layout. On hosted Supabase they live in the dashboard (Authentication > Emails) and must be pasted there, with the one-time link expiry set to 24 hours and the password-changed notification turned off.
- **Not included (decided).** A backfill of first names into existing accounts' authentication profile (the reset email says "Hello," for them until they have one), and per-person language or time zone.

## ADR-118: Super Admin accounts are invisible to everyone who is not a Super Admin

**Status:** Accepted (owner request, 2026-11-09). Migration 20261109000007.
- **Rule.** A person holding the Super Admin role is invisible to every signed-in person who does not hold it: not in people lists, pickers, rosters or counts, with no readable audit trail of what they did or what was done to the account. Super Admins see each other and everything. The server (no signed-in person) is not shielded.
- **Decisions (owner, "as recommended").** (1) A Super Admin disappears entirely, including from rosters, @mention lists and recipient lists, even though they are also a working employee. (2) Where a Super Admin acted on a record others share (an approval, finalised minutes), the others see the neutral name "Administration" instead of a person (`person_name`, `eo_person_name`). (3) The role "Super Admin" still exists by name on the roles screens, but its holders and member count are not shown.
- **One rule, enforced in the database.** `viewer_is_shielded`, `hidden_user_ids_for`, `hidden_employee_ids_for` (and the no-argument forms for the signed-in person) are the single definition. The select rules of `users`, `user_roles`, `user_permission_grants`, `user_unit_scopes`, `access_review_items`, `okr_session_participants`, `employees`, `employee_lifecycle_events`, `audit_logs` and `audit_alerts` are narrowed by it; so are the people pickers (`read_okr_people`, `read_quote_speakers`, `read_hidden_employee_ids`). Because the names of people on shared records are resolved through these tables, a hidden person's name simply does not resolve for others.
- **Audit.** Rows a Super Admin performed, rows about their account or employee record, and rows stamped with the Super Admin role are readable only by Super Admins, in the log, its export, its summary figures and its event trace (`audit_centre_kpis`, `audit_centre_trace`). An alert about a Super Admin's activity is hidden from others and its notification goes only to people who may see it. The hash chain itself is untouched.
- **Server code.** Code that reads with the service role applies the same rule through `src/lib/auth/shield.ts` (Email Reports recipients, schedules and delivery history). A request that names a Super Admin's account id or employee id, in the path, the body or the query, is answered "not found" for everyone else, by the API handler, whatever the route. An email address is deliberately not treated that way: creating an account with a Super Admin's address is refused like any other taken address.
- **Residual and decided.** An opaque id column on a shared record (for example "created by") may still hold the account's id; it resolves to nothing and to "Administration". Business totals (scores, attendance counts) still include the person's work, because they are the unit's results. A non-Super Admin who saves an Email Reports schedule that a Super Admin set up with themselves as a recipient removes that recipient without being told.
- **Tests.** `tests/db/super_admin_shield.test.ts` (the rule in the database) and `tests/api/super-admin-shield.api.test.ts` (generated: the account's id, employee id, email and name are searched for in every readable route and every page as every other role, and every route that takes a person's id is refused as "not found"). A new screen is covered automatically.

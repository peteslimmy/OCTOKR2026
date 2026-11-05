# 4CORE-OKR RLS and Data Security Specification

## Security objective

A user can only access records permitted by:

- identity;
- role;
- permission;
- BU scope;
- resource scope;
- lifecycle state.

## BU tenant isolation

For BU-scoped operational tables, BU Lead access is constrained to the user's BU.

Primary examples:

- weekly_reports
- smart_goals
- tasks
- weekly_score_snapshots
- weekly_compliance

## RLS principles

1. Never trust a client-supplied BU ID.
2. Derive user BU from authenticated identity/profile.
3. Apply RLS to every tenant-scoped table.
4. Test RLS directly, not only through UI.
5. Keep read and write permissions separate.

## Role scope

### BU Lead

Own BU only for weekly execution.

### Presenter

Organisation-wide presentation visibility.

### Executive/Director

Organisation-wide read-only.

### HR

HR/governance domains according to permissions.

### Finance

Finance/fund domain according to permissions.

### Admin/SuperAdmin

Broader scope according to explicit permission model.

## Lock enforcement

RLS is not sufficient for time-based business rules. The API/domain layer must reject content mutation when server time >= Content Lock.

Likewise Final Lock must be enforced regardless of whether a scheduler has already updated the status column.

## Privileged access

Service-role credentials must never be sent to browsers.

Privileged writes must go through controlled server-side services/RPCs.

## RLS abuse tests

### SEC-RLS-001
Finance BU Lead attempts to read HR report by UUID → DENY.

### SEC-RLS-002
Finance BU Lead changes request parameter BU to HR → DENY.

### SEC-RLS-003
Finance BU Lead tries direct database access outside Finance → DENY.

### SEC-RLS-004
Executive can read cross-BU data but cannot update it.

### SEC-RLS-005
Presenter can read all BU reports but cannot edit Goal content.

## Attendance amendment security

- Source attendance records are readable according to HR/governance scope and immutable after finalisation; no RLS policy grants ordinary UPDATE/DELETE on finalised source rows.
- `attendance.amendment.request` governs creating a request; HR requesters may read their own requests and other authorised HR/Admin users may read the queue according to scope.
- `attendance.amendment.approve` governs the decision operation. An approval/rejection RPC must resolve the reviewer from the authenticated identity and reject when reviewer = requester, even if the reviewer has both permissions.
- Client-supplied `requested_by`, `decided_by`, role, or scope values are ignored for authorization; identities are server-derived.
- Evidence references are not public URLs by default; reads/downloads require the same authorized request scope and expiring access where applicable.
- Add RLS and API tests for direct table access, RPC invocation by non-approver, requester self-approval, cross-scope request discovery, and attempted UPDATE/DELETE of source attendance rows.


## Attendance roster creation and Skip OKR controls
- Enforce `attendance.session.manage` in the server-side operation/RPC for roster creation, draft status updates, finalisation and Skip OKR.
- The server, not the browser, determines active staff in the roster snapshot. Clients cannot submit a partial list to the skip operation.
- Skip is a privileged bulk state transition: validate session state, execute atomically, enforce `(session_id, staff_id)` uniqueness and idempotency, and audit actor/time/count/outcome.
- A SKIPPED session produces `VIRTUAL_PRESENT` for all staff in scope; do not generate absence violations. There is no CANCELLED OKR outcome. Ensure the skip operation cannot bypass weekly report creation/submission/review requirements for any BU; the skipped-week performance summary must be manually entered by the BU.
- The source roster remains immutable after finalisation. Skip-generated rows are not editable individually; any correction to a mistaken session outcome must use a separately authorised, audited exception operation.


## Organization-holiday authorization and RLS

- `reporting.period.holiday.manage` is required to change reporting-week state to/from `ORGANIZATION_HOLIDAY`; grant by default to HR, Admin and Super Admin roles according to explicit RBAC mappings.
- Direct client UPDATE of holiday state and direct writes to `reporting_week_state_events` are denied; declarations go through a server-side privileged operation that derives actor identity from the authenticated session.
- BU Leads may read the applicable reporting state and their own BU report/comment, but cannot declare holidays or alter the reporting state. Do not rely on hidden UI controls for security.
- RLS/authorization tests cover role combinations, direct RPC/endpoint calls, forged actor IDs, cross-BU access, and attempted mutation of historical holiday/audit events.


## Policies written for speed, and the new tables (ADR-066, ADR-068 to 072)

- A policy must call `auth_has_permission()`, `auth_has_any()`, `auth_bu()` and `auth.uid()` as sub-selects (`(select auth_has_permission('x'))`) so PostgreSQL evaluates them once per statement, not once per row. `tests/db/rls_cost.test.ts` fails if a bare call returns. New policies follow the same form.
- `config_change_topics`, `permission_conflicts`, `reporting_schedule_versions`: readable by every signed-in person (they are rules, not secrets). `config_change_requests`: readable by people who handle configuration (the requesters' and approvers' permissions). `retention_settings`: readable by `retention.configure`, `config.approve` and `audit.read`. `job_heartbeats`, `rate_limit_hits`: no policy and no grant, so invisible to every browser session.
- Refused requests by a signed-in person are written to the audit log (`ACCESS_DENIED`), without identifiers or request content.

## Tables added after ADR-072 (branding, integrations, imports, unit type)

- **Public-before-sign-in reads.** `app_branding`, `app_branding_assets`, `site_content` and `site_images` grant `select` to `anon` and `authenticated` with a `using (true)` policy, because the sign-in page and landing content render before a session exists. They are read-only to browsers: writes go through service-role functions requiring `branding.manage` (`set_branding*`, `set_site_content`, `set_site_image`, `delete_site_image`, `prune_site_images`), and image bytes/settings are audited without the bytes. No public storage bucket is involved.
- **Integrations stay closed.** `integration_kinds` is readable by signed-in people. `integrations` and `webhook_outbox` have RLS with **no policy and no grant**, so browsers cannot select, insert, update or delete; the screen reads through `read_integrations()`, which requires `integrations.view` and returns secret **names only**, never values. Secrets are AES-256-GCM ciphertext from the web tier, and the database refuses plaintext. Every audit-log row is offered to matching enabled webhooks by a trigger, with the payload limited to event, entity type/id, outcome, actor role, time and correlation id — never old/new values or the reason.
- **Import staging is invisible.** `historical_import_batches`, `historical_import_rows` and `strategy_import_batches` have RLS with no policy and no grant. They are touched only by service-role functions requiring `history.import` or `strategy.import`; committed history is immutable, and raw uploaded rows are never browsable. During a historical import the `app.historical_import` session flag suppresses notifications and score snapshots.
- **New columns keep their table's policy.** `business_units.unit_type` and `employees.on_attendance_roster` are ordinary columns behind the existing table RLS and BU scope. The type is set through `create_business_unit` (`business_units.manage`); the roster flag through `set_employee_roster` (`users.manage`), and both roster queries honour it.
- **Deletion keeps authority inside the function.** `delete_business_unit` (`business_units.manage`), `delete_user` (`users.manage`) and `delete_weekly_report` (`weekly_report.create`, plus BU scope) check permission and referential guards in the database — employees/reports attached, the last unit, self-deletion, the last active Super Admin or Admin, non-draft/non-open reports — and audit the deletion. No client-side delete path exists.

## OKR Session Notes row-level security (ADR-090)

Every `okr_*` table has RLS enabled with a select policy only; `authenticated` has no insert, update or delete grant on any of them, and the write functions are revoked from `anon` and `authenticated` by `lock_down_function_grants()` (a catalogue test lists them). Policies use `(select auth_okr_session_visible(session_id))` and, for notes, `(select auth_okr_note_visible(session_id, visibility, author_id))`; both fail closed for an enrolled user whose session has not completed MFA (`auth_aal_satisfied()`). Versions and links follow the note they belong to (`exists` over the note, which is itself row-secured), so a hidden note hides its history and links. Actions are also visible to their assignee and creator. Minutes with the management audience need `session_notes.view_all`. Read functions (`read_okr_*`) are `SECURITY INVOKER`, so the same policies apply to every list, search, dashboard and export; the people picker `read_okr_people` is the one definer read and returns names and unit only to holders of a session permission.

## Executive Oversight row-level security (ADR-097, ADR-099)
Reads only; no insert, update or delete grant on any `eo_*` table. Policies compute everything about the caller (permission, own unit, own id, second-factor level) once per statement as an uncorrelated sub-select and compare columns per row, so the registers stay fast as the records grow (the first version called the full visibility functions per row and cost milliseconds per row). The only module functions executable by signed-in people are `eo_rec_is_mine` and `eo_rec_in_my_unit` (they answer only about the caller), `auth_eo_link_target_visible`, the `read_eo_*` read models and their label helpers; a catalogue test lists them. The full visibility functions (`eo_comment_visible_to`, `eo_rec_visible_to`, `eo_target_visible_to`) are used by the write functions, which run as the service role. A comment is visible to its author, to `executive_oversight.view_all` holders and, if shared, to the target unit. A recommendation: author (drafts: author only), `view_all`, and addressed units — each seeing only its own unit's record, files and timeline entries. A link to a session record is hidden from anyone who cannot read that record. HR, Finance, Admin and Super Admin see nothing. All write functions are revoked from `anon` and `authenticated`.

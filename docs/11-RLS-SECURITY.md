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

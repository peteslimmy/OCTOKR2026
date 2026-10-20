# 4CORE-OKR PostgreSQL / Supabase Database Specification

## General conventions

- PostgreSQL.
- UUID primary keys.
- `snake_case` names.
- `timestamptz` timestamps.
- Exact numeric types for money.
- Explicit foreign keys.
- Strong CHECK/UNIQUE constraints.
- Conservative cascades.
- RLS on tenant-scoped data.

## Core tables

### organisations

Key columns:

- `id uuid primary key`
- `name text not null`
- `code text unique`
- `timezone text not null default 'Africa/Lagos'`
- `currency_code char(3) not null default 'NGN'`
- status/timestamps

### business_units

- id
- organisation_id FK
- code
- name
- status
- timestamps

Unique: `(organisation_id, code)`.

### employees

- id
- email (case-insensitive unique)
- first_name
- last_name
- business_unit_id FK
- employment_status
- timestamps

### users

- id
- employee_id unique FK
- email unique
- status
- last_login_at
- locked_until
- failed_attempts
- timestamps

### roles / permissions / role_permissions / user_roles

Implement normalised RBAC with optional BU scope on role assignments.

## Strategy tables

### annual_themes

Unique `(organisation_id, year)`.

### annual_theme_changes

Preserve old/new theme and reason.

### quarters

Unique `(organisation_id, year, quarter_number)`.

`status` is `PLANNED` / `ACTIVE` / `LOCKED`, enforced by CHECK: `LOCKED` is the
terminal state the state machine in `08-STATE-MACHINES.md` and BR-STR-007 name.
The code used to write `ARCHIVED` for the same state, so two names for one
state were in circulation until migration 055 renamed the rows and closed the
vocabulary.

### quarterly_objectives

Unique `quarter_id`.

### key_results

Unique code and sequence within Objective.

### sub_key_results

Unique code and sequence within KR.

## Weekly tables

### reporting_weeks

Fields must include:

- year
- week_number
- week_start_at
- week_end_at
- content_lock_at
- final_lock_at
- status
- `reporting_state text not null default 'NORMAL' CHECK IN ('NORMAL','ORGANIZATION_HOLIDAY')`
- when `reporting_state='ORGANIZATION_HOLIDAY'`: holiday declaration metadata may be projected from the latest state event; do not depend on a mutable field alone for audit

### weekly_reports

Key fields:

- business_unit_id
- reporting_week_id
- status
- submission_status
- version
- submitted_at/by
- content_locked_at
- final_locked_at
- `skipped_session_summary_comment text null` (mandatory and non-blank for submitted report if the linked governance session is SKIPPED; prohibited as a requirement for ORGANIZATION_HOLIDAY weeks)

Unique `(business_unit_id, reporting_week_id)`.

### report_edit_sessions

Enforce one ACTIVE lease per report.

### smart_goals

- weekly_report_id
- business_unit_id
- goal_type
- sub_key_result_id nullable
- title/description
- deletion metadata

CHECK:

`KR_ALIGNED => sub_key_result_id is not null`

`STRETCH => sub_key_result_id is null`

### smart_evaluations

Store dimension scores, overall score, warnings, suggestions, engine version.

### tasks

- smart_goal_id
- business_unit_id
- description
- status
- deletion metadata

CHECK status is one of UNDEFINED/DONE/NOT_DONE.

### task_status_history

Append-only execution history.

## Scoring tables

### weekly_score_snapshots

Unique report snapshot with base/final score, penalty rate, count metrics, calculation version.

### weekly_compliance

Unique report; COMPLIANT or NON_COMPLIANT.

### quarterly_execution_scores

Logical current score for `(quarter_id, business_unit_id)` is calculated using all non-holiday calendar reporting weeks in the quarter. `ORGANIZATION_HOLIDAY` weeks are explicitly recorded among excluded week references and are absent from both numerator and denominator. Maintain versioned, immutable quarterly score snapshots (either a dedicated `quarterly_score_snapshots` table or an equivalent versioned design), with a unique `(quarter_id, business_unit_id, version_number)` key. Do not overwrite old published snapshots. Each snapshot records at least: version number; calculation status (e.g. provisional/final where relevant); fixed denominator week count; ordered reporting-week references and per-week contributing values; missing-report zero count; numerator/total; resulting score; calculation/rule version; calculated-at timestamp; prior-snapshot link; actor/source (scheduler or authorised correction); amendment reference where applicable.

A quarter with zero eligible reporting weeks has score `N/A` and reason `NO_ELIGIBLE_REPORTING_WEEKS`; do not divide by zero or fabricate a zero score.

At weekly final lock, a BU/week with no submitted report must produce stable, auditable `0.00` score + `NON_COMPLIANT` evidence and remain represented in the quarterly denominator only if the reporting week is reportable (`NORMAL`, including a SKIPPED session). Never create missing-report zero evidence for a week declared `ORGANIZATION_HOLIDAY`. The implementation may use an explicit missing-week score snapshot or equivalent immutable state, but a transient query-only zero without auditable finalisation evidence is insufficient.

A late report correction after quarter lock creates an append-only score amendment and a new quarterly snapshot/version. Preserve original zero, prior quarterly snapshot and calculation inputs. Do not mutate historical snapshots or reopen ordinary quarter editing. A submitted-but-unreviewed report must be represented separately from a missing report; quarter-finalisation treatment remains a business decision required.

### integrity_penalty_configurations

Versioned rates with effective windows.

### integrity_corrections

Immutable correction record with reason, penalty rate, decision, actor.

## Governance, attendance amendments and violations

### `governance_sessions`
Session metadata and SCHEDULED/HELD/SKIPPED state only. Store the outcome actor/time and skip operation reference where applicable. Do not model a CANCELLED OKR outcome.

### `attendance_records`
Source roster entries. For HELD sessions, create one row for every active staff member in the roster snapshot with status defaulted to PRESENT; authorised HR may change draft statuses before finalisation. Once finalised, database constraints/privileges/triggers reject UPDATE/DELETE. For a SKIPPED session, an atomic server-side operation creates one VIRTUAL_PRESENT row for every staff member in the session roster snapshot and records the skip operation; retries are idempotent. Keep original status and finalisation metadata unchanged.

### `attendance_amendment_requests`
Suggested fields: `id`, `attendance_record_id`, `source_status_snapshot`, `effective_status_snapshot`, `proposed_status`, `reason` (non-empty), optional `evidence_refs`/attachment metadata, `requested_by`, `requested_at`, `status` (`PENDING`/`APPROVED`/`REJECTED`), `decided_by`, `decided_at`, optional `decision_reason`, `correlation_id`, timestamps. Protect decisions so a terminal request cannot be reopened or rewritten; write a decision event/audit record.

### `attendance_amendment_events` (or equivalent append-only audit/event table)
Records request submission, approval/rejection, stale-request rejection and any later correction lifecycle event. Each event records actor, timestamp, old/new/effective status, reason, request reference and outcome. Approved event history is used to derive effective attendance status without changing `attendance_records`.

Constraints and database operations:
- Enforce non-empty request reason and valid status values.
- Allow amendment requests only for finalised held-session attendance records under the accepted correction policy. Skip-generated VIRTUAL_PRESENT rows are controlled outputs of a SKIPPED session and cannot be individually edited; correction of an erroneous skip requires a separate audited session-outcome exception workflow. Every BU must still submit a weekly report with a manually entered performance summary for a skipped week, and the report must be reviewed.
- Allow at most one PENDING request per attendance record using a partial unique index or equivalent serialised transaction.
- Enforce requester != reviewer inside the privileged approval function, not only the UI/API.
- Approval validates that the source/effective status snapshot is still current; if stale, do not apply and require a fresh request.
- Only roles/services with explicit request/approval permissions can create or decide requests. Never trust requester/reviewer IDs from the client without resolving them from the authenticated session.
- Keep evidence in approved secure storage; store object references/metadata rather than unbounded binary payloads in the request row. Evidence is optional.
- Effective status is calculated from the original record plus approved amendment history in deterministic sequence; there must be a single canonical query/view/service for all UI, reports and exports.

Additional governance tables:
- weekly_quotes
- violation_types
- violations
- violation_payments

## Financial tables

- violation_funds
- financial_ledger_entries
- disbursement_requests
- disbursement_decisions
- disbursements

## Cross-cutting

- notifications
- audit_logs

## Delete policy

Normal user operations must not physically delete:

- audit records;
- ledger entries;
- integrity corrections;
- finalised weekly reports;
- finalised source attendance records;
- attendance amendment decisions/events and approved amendments.

Goal/Task deletion before Content Lock should be implemented as soft deletion so history can remain auditable.

## Referential integrity

Prefer RESTRICT for historical business records. Avoid destructive cascades across audit/finance/history.

## Concurrency

Use optimistic versioning on weekly_reports plus an edit lease.

Use transactional locking/serialization for financial approvals.

## Monetary values

Use `numeric(19,2)` or a deliberately selected exact precision. Never use JS floating point as authoritative money storage.

## Database functions

Privileged operations should use controlled functions/services for:

- finalising reports;
- integrity corrections;
- violation payment;
- finance approval;
- quarter locking;
- exceptional Annual Theme change;
- submit_attendance_amendment;
- approve_attendance_amendment / reject_attendance_amendment (or equivalent service transaction), with independent-actor and stale-state checks.


### Attendance default and skip transaction requirements
- The server-side roster creation transaction snapshots the eligible active staff list and creates one DRAFT attendance row per staff member with status `PRESENT`. Do not rely on a frontend-only default.
- The `skip_okr_session(session_id, idempotency_key)` service/RPC must validate `attendance.session.manage`, verify the session is eligible to be skipped, and atomically set session outcome to `SKIPPED`, create/set every roster-snapshot row to `VIRTUAL_PRESENT`, record actor/time/count/reference, and append an audit event.
- The skip operation must be idempotent under retries and concurrency. It must not leave a partially skipped session or a mixed roster. Use a transaction and uniqueness constraint on `(session_id, staff_id)`.
- The skip operation must reject if a held/finalised roster already exists unless the separate session-outcome exception workflow is used.
- Store statuses as controlled enum/configuration values. Minimum values: `PRESENT`, `ABSENT`, `ON_LEAVE`, `EXCUSED`, `ILL`, `VIRTUAL_PRESENT`; additional values require controlled configuration and must not alter historical labels/meaning silently.
- `VIRTUAL_PRESENT` means “OKR week skipped” and is not a claim of physical attendance. Reports/exports must include the session outcome so this status is not misinterpreted. No absence violation/penalty is generated for a SKIPPED session. Weekly reporting, submission, review, scoring and compliance obligations remain in force for all BUs.


## Tables and functions added after the closing pass (migrations 20261019000007 to 20261020000005)

| Migration | Adds |
|---|---|
| 20261019000007 | `session_outcome_corrections`; request, decide, execute, emergency functions; roster archive link |
| 20261019000008 | `strategy_change_requests`, `strategy_item_versions`, retirement status on key results and Sub-KRs |
| 20261019000009 | `read_notification_states` |
| 20261019000010 | reopening a violation when its payment is reversed |
| 20261019000011 | `record_access_denied` (throttled one per person and route per minute) |
| 20261019000012 | `rls_initplan()` and the rewrite of every policy so permission checks run once per statement |
| 20261020000001 | `config_change_topics`, `config_change_requests`, the request, decide, withdraw and emergency functions, `config_dry_run`; permissions `config.*` |
| 20261020000002 | `roles.description`, `roles.is_system`, `permissions.protected`, `permission_conflicts`, `roles.request`; role-name-free privilege functions; `apply_role_change`; `read_roles`, `read_permissions` |
| 20261020000003 | `reporting_schedule_versions`, `reporting_weeks.schedule_version_id`, `active_schedule()`, `schedule_content_lock/final_lock`, `apply_lock_schedule`, `read_lock_schedule` |
| 20261020000004 | `rate_limit_hits` (unlogged), `rate_limit_hit()`, `job_heartbeats`, `ops_health()`, `clock_override_present()` |
| 20261020000005 | `retention_settings`, `purge_transient_data()`, `maybe_purge_transient_data()`, `record_audit_export`, table-driven topics (`applier`, `current_fn`) |

Conventions kept: every mutation is `SECURITY DEFINER` and callable by `service_role` only (`lock_down_function_grants()` at the end of each migration); functions named `read_` are the only ones open to signed-in users, so operational functions are named `ops_`.

# 4CORE-OKR RBAC and Authorization

## Roles

- SUPER_ADMIN
- ADMIN
- BU_LEAD
- PRESENTER
- EXECUTIVE
- DIRECTOR
- HR
- FINANCE

## Permission model

Authorization is:

**Permission + Resource Scope + Business State + Role Context**

Role names alone are not sufficient.

## Core permissions

### Strategy

- `strategy.annual_theme.view`
- `strategy.annual_theme.create`
- `strategy.annual_theme.change_exception`
- `strategy.objective.create`
- `strategy.objective.edit`
- `strategy.kr.create`
- `strategy.kr.edit`
- `strategy.subkr.create`
- `strategy.subkr.edit`

### Weekly reporting

- `weekly_report.view_own_bu`
- `weekly_report.view_all`
- `weekly_report.create`
- `weekly_report.edit`
- `weekly_report.submit`
- `goal.create`
- `goal.edit`
- `goal.delete`
- `task.create`
- `task.edit`
- `task.delete`
- `task.execute`

### Integrity

- `integrity_correction.create`
- `integrity_penalty.configure`
- `integrity_penalty.waive`

### Attendance/violation

- `attendance.session.manage`
- `attendance.record`
- `attendance.amendment.request` — request changes to finalised attendance; granted to authorised HR users.
- `attendance.amendment.approve` — approve/reject attendance amendments; assigned to authorised Admins or specifically designated HR approvers, never automatically to the requester as a result of requesting.
- `attendance.amendment.view` — view amendment requests/history within granted HR/Admin scope.
- `violation.create`
- `violation.edit`
- `violation.payment.record`

### Attendance amendment segregation of duties

Permission checks must be performed against the authenticated requester/reviewer identities, not client-supplied IDs. Request creation requires `attendance.amendment.request`; decisions require `attendance.amendment.approve` and a reviewer different from the requester. A role having both permissions does not permit self-approval. A user may hold both permissions for separate requests but cannot decide a request they initiated.

### Finance

- `finance.fund.view`
- `finance.ledger.view`
- `disbursement.create`
- `disbursement.approve`
- `disbursement.reject`

### Administration

- `users.manage`
- `roles.manage`
- `business_units.manage`
- `business_units.change_type` — change a unit between Business Unit and Department (promote or demote). **Super Admin and Admin** (protected; not available through a config request). Changes the label only (ADR-114).
- `audit.read` (summary of the audit log: Admin and Super Admin)
- `audit.read_detail` (the technical detail of audit entries: address, location, device, raw values, integrity chain; protected, Super Admin only, ADR-121)
- `report_email.manage` / `report_email.send` / `report_email.history` — automated report emails: set up schedules, preview and test; send now and retry; see the delivery history. Admin and Super Admin (ADR-115).

### Bulk import

- `bulk.template.download`
- `bulk.template.download_reports` (the historical reports template)
- `bulk.business_units`
- `bulk.users`
- `bulk.weekly_reports`
- `bulk.goals`

These are the codes the four bulk routes guard with, one literal per entity at
the call site rather than a role list in the route (ADR-038). The grants are
the roles already listed for those screens: SUPER_ADMIN + ADMIN for business
units and users, SUPER_ADMIN for historical weekly reports, SUPER_ADMIN +
ADMIN + BU_LEAD for goals. `bulk.template.download_reports` is separate from
`bulk.template.download` because the reports template exposes the historical
import format.

The database holds the same grants for these codes as the route guard expects
(74 permissions in total), so a check made in the route and a check made in SQL
- `has_permission`, and `rpc_authorize` where a guarded RPC prologue exists as
of migration 057 - cannot disagree about who is allowed.
`scripts/verify-044-permission-matrix.js` asserts that agreement.

## 4COREPAL permissions (module `AI Performance Agent`, off by default)

`ai.assistant.use`, `ai.insights.own`, `ai.insights.bu`, `ai.insights.org`, `ai.remark.submit`, `ai.case.view`, `ai.case.manage`, `ai.action.assign`, `ai.approval.decide` (reserved, critical), `ai.escalation.manage` (protected, critical), `ai.communication.view`, `ai.communication.manage`, `ai.knowledge.manage`, `ai.config.manage` (reserved, critical), `ai.schedule.manage`, `ai.audit.view`, `ai.report.export`.
Defaults: BU Lead (assistant, own BU insights, remarks, cases); Executive and Director (organisation insights, cases, communications, export); Admin (the same plus case management and audit); Super Admin (all). Scope: a BU Lead reads only their own unit's AI records; organisation-wide reading needs `ai.insights.org`. See docs/38-4COREPAL-DESIGN.md.

## Scope rules

### BU Lead

Own BU only for weekly operational data.

### Presenter

All BUs for presentation/read and governed integrity correction.

### Executive/Director

Organisation-wide read-only.

### HR

HR operational domains; financial request creation where authorised.

### Finance

Finance approval and fund/ledger domains; no self-approval.

### SuperAdmin

Organisation-wide administrative capability, but no integrity or financial workflow bypass.

## Example policy

A BU Lead can edit a Goal only when all conditions are true:

1. authenticated;
2. has `goal.edit` permission;
3. Goal belongs to user's BU;
4. report is not FINAL_LOCKED;
5. current WAT time is before Content Lock;
6. no conflicting edit session;
7. Goal is not deleted.

## Explicit denials

A BU Lead cannot:

- access another BU report;
- edit historical locked reports;
- configure penalties;
- perform integrity correction;
- approve financial disbursement;
- change Objective/KR/Sub-KR;
- change Annual Theme.

## Segregation of duties

Finance cannot approve a request created by the same user.


## Attendance operational permissions (clarified)
- `attendance.session.manage`: create weekly session/roster, update draft status values, finalise held-session roster, and invoke `Skip OKR for this week`. Grant to HR and any specifically authorised substitute roles.
- `attendance.amendment.request`: submit post-finalisation correction requests.
- `attendance.amendment.approve`: approve/reject amendment requests; requester and reviewer must be different authenticated users.
- `attendance.session.outcome.correct` (proposed least-privilege permission): correct an erroneously recorded HELD/SKIPPED session outcome through an audited exception workflow; do not grant by default. There is no CANCELLED OKR outcome.
- Skip action permission is independent of the ability to edit a staff roster. UI visibility is not sufficient: API/RLS/service layer must enforce each permission.


## Organisation-holiday reporting-period control

Add explicit permission `reporting.period.holiday.manage`, granted by default only to HR, Admin and Super Admin roles subject to the organisation's RBAC policy. It allows a reporting week to be declared as `ORGANIZATION_HOLIDAY` through a server-side operation requiring a selected week/period, mandatory reason, explicit confirmation and audit event. A broader role name alone must not bypass the permission check. Users may not forge actor identity or change the week state via direct table writes. Post-lock changes affecting a quarterly score use the separately authorised amendment path and preserve prior snapshots.


## Permissions added in milestone 7 (ADR-058 to 062)

| Permission | Default roles | Purpose |
|---|---|---|
| `ledger.reversal.request` | Finance, Admin, Super Admin | Ask for a compensating reversal of a ledger entry |
| `ledger.reversal.approve` | Finance, Super Admin | Approve or reject a reversal request (never your own) |
| `ledger.reversal.execute` | Finance, Super Admin | Post an approved reversal (never your own request) |
| `ledger.reversal.emergency` | Super Admin | One-step emergency reversal (audited, alerted, step-up) |
| `reminders.configure` | Admin, Super Admin | Report reminder and email settings |
| `attendance.session.outcome.request` | HR, Admin, Super Admin | Ask to reopen a skipped session |
| `attendance.session.outcome.approve` | Admin, Super Admin | Approve or reject that request (never your own) |
| `attendance.session.outcome.correct` | Admin, Super Admin | Execute an approved correction (never your own request) |
| `attendance.session.outcome.emergency` | Super Admin | One-step emergency reopen (audited, alerted, step-up) |
| `strategy.change.request` | Admin, Super Admin | Ask for a change to strategy in an active quarter |
| `strategy.change.approve` | Admin, Super Admin, Executive | Approve or reject a strategy change (never your own) |

Holiday amendment requests use the existing `quarter.score.amend`; the requester and the decider must be different people. Business Unit import uses `business_units.manage`; employee import uses `users.manage`.


## Roles are data (ADR-069)

The eight roles that ship are only the starting set. Roles, and the permissions they hold, are created, changed and deleted in the application (Administration → Roles) as approved configuration changes; no role name is written into code. What decides everything is the permission.

| Permission | Default roles | Purpose |
|---|---|---|
| `roles.request` | Admin, Super Admin | Ask for a role to be created, changed or deleted (a different person approves) |
| `roles.manage` | Super Admin | Hand out roles that can administer people or roles; remove them; individual designations |
| `config.approve` | Admin, Super Admin | Decide a configuration change someone else asked for |
| `config.protected.approve` | Super Admin | Decide a change that touches protected permissions or the authenticator requirement (fresh authenticator check) |
| `config.emergency` | Super Admin | Apply a configuration change in one step in an emergency (audited, others alerted) |
| `retention.configure` | Admin, Super Admin | Ask for a change to how long read notifications and finished emails are kept |
| `violation.edit` | HR, Admin, **Super Admin** | Ask for a violation type or fine to be added or changed (owner decision 15 October 2026) |

**Protected permissions** (flag `permissions.protected`): `roles.manage`, `users.manage`, `audit.read`, `config.approve`, `config.protected.approve`, `config.emergency`, `roles.request`, `ledger.reversal.emergency`, `ledger.reversal.approve`, `ledger.reversal.execute`, `attendance.session.outcome.emergency`, `strategy.annual_theme.change_exception`, `integrity_penalty.configure`, `disbursement.approve`, `disbursement.disburse`. Adding or removing one of them on a role, or changing whether a role needs an authenticator, can only be approved by someone holding `config.protected.approve`.

**The five rules for changing roles:** (1) a request can add to a role only permissions its requester holds; (2) protected permissions need a Super Admin to approve; (3) a change cannot add a combination listed in `permission_conflicts` (create with approve or disburse for disbursements; request with approve for attendance amendments); (4) deleting a role needs a role to move its holders to, and the last holder of `roles.manage`, `config.protected.approve` or `users.manage` cannot be removed; (5) every change is audited with the permissions before and after and the people who manage roles are told. The "never the requester" rules are by person and apply to every role.

**Who is the report owner.** The people who file a Business Unit's weekly report, receive its reminders and are told about corrections are those who hold `weekly_report.submit` in that Business Unit, whatever their role is called.

The approved permission matrix of the shipped roles is `tests/db/fixtures/role-matrix.json`; a test fails if a migration changes it unintentionally, and `tests/api/permission-matrix.api.test.ts` checks the HTTP answers against it.


### Integrations (ADR-076)

| Permission | Default roles | Purpose |
|---|---|---|
| `integrations.view` | Admin, Super Admin | See which integrations are configured and how their last test went (never a secret) |
| `integrations.configure` | Admin, Super Admin (protected) | Ask for an integration to be added, changed, switched on or off, or removed; a Super Admin approves |
| `history.import` | Super Admin, Admin (protected) | Upload, rehearse and commit historical weekly reports; no second approver; Super Admins are told of every Admin commit; an Admin undoes only their own batch (ADR-077, ADR-122) |
| `integrations.test` | Admin, Super Admin | Test an integration: a message to yourself, a fixed sentence to an AI provider, a test event to a webhook |

## Reserved permissions (ADR-077)

A permission marked **reserved** (`permissions.reserved`) can only be held by a role that also holds `roles.manage`, the Super Admin tier. The role engine refuses any create or update that would put one elsewhere (`ROLE_RESERVED`), whoever asks and whoever approves. Reserved: `history.import`, `roles.manage`, `config.protected.approve`, `config.emergency`, `ledger.reversal.emergency`, `attendance.session.outcome.emergency`, `strategy.annual_theme.change_exception`.

## OKR Session Notes permissions (module `Session notes & meetings`; ADR-089 to ADR-093)

Mapped to roles by migration `20261105000001` and changeable only through the ordinary role-management process. **HR, Finance and Admin hold none of the content permissions** (Admin holds only `session_notes.configure`, the list of session types). **The Super Admin holds all of them** (ADR-112, owner decision), with no content limit (ADR-112): it also reads others' CONFIDENTIAL notes and may verify its own completions. Audit and immutable history still apply.

| Permission | Risk | BU Lead | Presenter | Executive | Director | Admin | Super Admin | HR | Finance |
|---|---|---|---|---|---|---|---|---|---|
| `session_notes.view` | low | ✔ (own unit and invited sessions) | ✔ | ✔ | ✔ | – | – | – | – |
| `session_notes.view_all` (protected) | critical | – | ✔ | ✔ | ✔ | – | – | – | – |
| `session_notes.create` | medium | ✔ (own unit) | ✔ | – | – | – | – | – | – |
| `session_notes.update` | medium | ✔ (own notes) | ✔ | – | – | – | – | – | – |
| `session_notes.finalise` | high | – | ✔ | – | – | – | – | – | – |
| `session_notes.archive` | high | – | ✔ | – | – | – | – | – | – |
| `session_notes.export` | medium | ✔ (what they can read) | ✔ | ✔ | ✔ | – | – | – | – |
| `session_notes.configure` | high | – | – | – | – | ✔ | ✔ | – | – |
| `session_decisions.create` | medium | – | ✔ | – | – | – | – | – | – |
| `session_decisions.approve` (protected) | critical | – | ✔ | – | – | – | – | – | – |
| `session_actions.create` | medium | – | ✔ | – | – | – | – | – | – |
| `session_actions.assign` | medium | – | ✔ | – | – | – | – | – | – |
| `session_actions.update` | medium | ✔ (own unit's actions) | ✔ | – | – | – | – | – | – |
| `session_actions.verify` | medium | – | ✔ | – | – | – | – | – | – |
| `session_risks.manage` | medium | – | ✔ | – | – | – | – | – | – |

Beyond the codes (enforced in the database): a session is visible to a holder of `session_notes.view` who also has `view_all`, belongs to the session's unit, or is its facilitator, creator or an invited participant; a note is `SHARED`, `MANAGEMENT` (holders of `view_all`, author, facilitator) or `CONFIDENTIAL` (author and facilitator); the assignee of an action can always read and report on that action; the person who completes an action cannot verify it. The Executive is read-only because it holds no create or update permission.

## Executive Oversight permissions (module `Executive oversight`; ADR-096 to ADR-103)
Fourteen permissions, all data, mapped by migration 20261106000001. Full matrix and rules in `41-EXECUTIVE-OVERSIGHT.md` section 4.

| Role | Gets |
|---|---|
| Executive, Director | view, create, reply, amend (own) comments; view, create, withdraw, close recommendations; dashboard; `view_all` (protected); export |
| BU Lead | view and reply to comments of their unit; view recommendations of their unit; `respond` and `update_progress` for their own unit; the dashboard (their unit's figures); export of what they can read |
| Presenter | view and reply, for their own unit |
| Admin, Super Admin | `executive_oversight.configure` only (categories and escalation timelines); no content |
| HR, Finance | nothing |

An Executive's `view_all` is the right to read, never to answer for a unit or to change any operational record. The Super Admin tier does **not** inherit these codes (ADR-097).

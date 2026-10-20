# 4CORE-OKR Audit Controls

## Audit objective

Any important business event must be attributable to:

- who;
- what;
- when;
- where/scope;
- before;
- after;
- why.

## Audit record

Recommended fields:

- audit_id;
- actor_user_id;
- actor_role;
- business_unit_id where applicable;
- action;
- entity_type;
- entity_id;
- old_values;
- new_values;
- reason;
- occurred_at;
- request/correlation ID;
- IP/user-agent where appropriate.

## Events requiring audit

### Strategy

- Annual Theme creation/change;
- Objective creation/change;
- KR creation/change;
- Sub-KR creation/change;
- quarter lock.

### Weekly execution

- report creation;
- report submission;
- goal creation/edit/delete;
- task creation/edit/delete;
- task status change;
- content lock;
- final lock.

### Integrity

- correction;
- penalty applied;
- penalty waived;
- waiver reason.

### Governance

- attendance roster finalisation;
- attendance amendment request submitted;
- attendance amendment approved/rejected;
- stale/duplicate amendment attempt where relevant;
- violations;
- payments.

Attendance amendment audit payload must capture the source record/session, original/effective/proposed status, request reason, optional evidence reference, requester identity and timestamp, reviewer identity and timestamp, decision/rejection reason, resulting effective status and correlation/reference ID. Source attendance values must never be overwritten to make the audit trail appear current; use the effective-status projection plus append-only events.

### Finance

- disbursement request;
- approval;
- rejection;
- disbursement;
- ledger transaction.

### Security/admin

- login/failure/lockout;
- role change;
- permission change;
- user suspension;
- privileged configuration.

## Immutability

Audit records cannot be updated or deleted through application functions.

Prefer database triggers/privileges that enforce immutability.

## Transactional audit

For critical operations, business state change and audit record must commit in the same transaction.


### Attendance default and Skip OKR audit evidence
Audit roster creation and record the session/week, roster snapshot identifier or version, staff count, actor, timestamp and defaulting rule. For a Skip OKR action, record the session outcome transition, actor, timestamp, idempotency/correlation reference, number of staff tagged VIRTUAL_PRESENT, and ensure audit/monitoring also demonstrates that every BU still submitted a weekly report containing a manually entered skipped-week performance summary and that the report was reviewed. There is no CANCELLED OKR outcome. Record the operation success/failure outcome; do not log success if the transaction fails. The bulk operation must be atomic; do not log success if the transaction fails. Do not interpret VIRTUAL_PRESENT as physical presence.

### Quarterly score calculation and post-lock amendment audit

For each quarterly score version, audit the quarter, BU, reporting-calendar version or week set, fixed denominator count, each contributing weekly score/source, missing-report zeros, numerator, result, rule version, calculation time and prior snapshot reference. For an authorised late-report amendment, record the permissioned actor, approving/authorising decision, mandatory reason, late report and completed-review reference, original zero, replacement weekly score, old/new quarterly score snapshot IDs and values, recalculation details, timestamp, and correlation ID. Preserve earlier score versions as immutable; never log only the new value. An amendment after quarter lock must not reopen ordinary quarter editing. Submitted-but-unreviewed reports must not be mislabelled as missing in audit records.


### Reporting-week state audit

Audit every declaration, modification or correction of `ORGANIZATION_HOLIDAY`: prior/new state, reporting week(s), reason, actor identity/role, timestamp, request/correlation ID, notification result, and any score recalculation/version produced. Keep the state-change history append-only. For SKIPPED OKR, separately audit the session outcome, virtual-present roster count, notification to all BU Leads, and report-summary comment submission. Never conflate a session skip with an organisation-holiday declaration.

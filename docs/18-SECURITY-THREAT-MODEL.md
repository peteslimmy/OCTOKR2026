# 4CORE-OKR Security Threat Model

## Assets

1. BU private reports.
2. Historical performance scores.
3. Integrity corrections.
4. Employee identity/attendance records.
5. Violation data.
6. Violation-fund ledger.
7. Roles/permissions.
8. Audit logs.
9. Authentication/session credentials.

## Threats and controls

### THREAT-001 Cross-BU access

Attack: manipulate report UUID or BU filter.

Controls: RLS + API scope + domain authorization.

### THREAT-002 Lock bypass

Attack: call API directly after Tuesday 18:00.

Controls: server-time business policy + backend validation + controlled DB operations.

### THREAT-003 Integrity bypass

Attack: direct task UPDATE after final lock.

Controls: no unrestricted task update for sensitive transition + integrity service + audit.

### THREAT-004 Financial race condition

Attack: two approvals consume same balance.

Controls: transaction locking + current-balance check + unique/idempotency controls.

### THREAT-005 Self-approval

Attack: Finance requester approves own request.

Controls: service-layer SoD validation.

### THREAT-006 Audit tampering

Attack: delete audit row.

Controls: append-only DB enforcement.

### THREAT-007 Privilege escalation

Attack: modify role/permissions through client fields.

Controls: explicit DTO allowlists + admin policy + audit.

### THREAT-008 XSS

Attack: script inserted into Goal/Task/Quote.

Controls: output escaping + safe rendering + sanitisation if rich text appears.

### THREAT-009 SQL injection

Attack: malicious input into search/filter.

Controls: parameterized queries.

### THREAT-010 Session theft

Controls: secure cookies, session expiry, MFA for elevated users, reauthentication for high-risk actions.

### THREAT-011 Password attack

Controls: rate limiting, lockout, secure reset, anti-enumeration.

### THREAT-012 AI prompt injection

Attack: user goal content attempts to alter system prompt.

Controls: treat user content as untrusted data with strict prompt boundaries.

### THREAT-013 AI data leakage

Controls: send minimum necessary data; do not send hidden HR/financial/security data unnecessarily.

### THREAT-014 Replay/duplicate financial action

Controls: idempotency keys and unique business references.

## Security principles

- least privilege;
- defence in depth;
- secure defaults;
- explicit authorization;
- immutable audit;
- no client-side trust.


### THREAT-013 Holiday-state abuse

Attack: an unauthorised user declares a reporting week as ORGANIZATION_HOLIDAY to avoid reporting obligations or manipulate quarterly scores.

Controls: explicit server-side permission; reason and confirmation; immutable state-change audit; selected reporting-week scope; notify all BU Leads; no client-supplied actor IDs; post-lock denominator changes require controlled amendment and a new score snapshot; alert on changes after report or quarter lock.

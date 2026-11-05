# 4CORE-OKR Notifications and Events

## Notification principle

Notifications are persistent business information, not merely transient toasts.

## Event categories

### Reporting

- reporting week opened;
- report not submitted reminder;
- content lock approaching;
- content locked;
- final lock approaching;
- final locked.

### Integrity

- integrity correction;
- penalty applied;
- penalty waived.

### Attendance amendments

- attendance amendment submitted (notify designated approvers/queue);
- attendance amendment approved (notify requester and relevant HR viewers);
- attendance amendment rejected (notify requester with decision reason).

Notification payloads should minimise employee data and link to the authorised in-app request view. The in-app record is authoritative. Notification delivery failure must not roll back the request/decision, and retry must not duplicate the business action.

### Compliance

- non-submission;
- compliance exception.

### Finance

- disbursement request created;
- finance approval required;
- disbursement approved;
- disbursement rejected;
- disbursement completed.

### Strategy

- new quarter active;
- previous quarter locked.

## Notification record

- user_id;
- event_type;
- entity_type;
- entity_id;
- title;
- message;
- read_at;
- created_at.

## Delivery

In-app notification is authoritative.

Email may be an asynchronous secondary channel.

A provider failure must not roll back the underlying business operation.

## Deduplication

Important events should be idempotent so retries do not create duplicate notifications.


### Attendance session events
- Record an audit event when a weekly roster is created/finalised.
- On Skip OKR, surface an in-app confirmation to the acting user with the week, skipped status, and number of staff marked VIRTUAL_PRESENT. Notify or visibly prompt each BU to submit its weekly report with a manually authored performance summary for the skipped week, and show normal review status. The reminder is not a substitute for mandatory submission. There is no CANCELLED OKR outcome.
- Notify the requester when an attendance amendment is approved/rejected. No separate written approval document is required; the application decision is the record.


### Organization Holiday notifications
- When HR/Admin/SuperAdmin declares an `ORGANIZATION_HOLIDAY` reporting week, notify all BU Leads with the affected week(s), closure period, and explicit message that no weekly report is due for those week(s).
- Suppress ordinary report due/overdue/non-compliance notifications for declared holiday weeks. If a declaration is amended or reversed, notify affected BU Leads and resume the applicable reporting notices under the updated state.
- On Skip OKR for the week, notify all BU Leads that the physical session was skipped but weekly reporting remains mandatory. Include a link to the BU report and inform the lead that the required manual summary-comment field is active.
- Use idempotent event keys; notification provider failure must not reverse the business state change. Record notification attempts and outcomes for operational support.


### Reminders and email (ADR-061)
- **Report reminders.** Business Unit Leads of an expected Business Unit that has not submitted are reminded at configured hours before the content lock (default 24 and 6), at most N per person per week (default 2), once per slot, never during an organisation holiday, never after the lock, never when the report is submitted. If the scheduler was down only the latest slot is sent.
- **Email.** In-app is authoritative. Events listed in `email_event_types` also queue an email in the same transaction; security events are always sent, the rest follow the person's choice and a global switch. Delivery is asynchronous with leases, backoff and a 48-hour expiry; failures are recorded and never touch the business operation.
- **Provider.** Not chosen (ADR-054 #8). SMTP is supported; development uses a file transport. Without a provider mail is parked and expires.
- **Actionable.** A notification links to the place the work is done, and the notifications page shows whether the request it points to is still waiting (`read_notification_states`, "Still waiting for action" or "Already dealt with").


### Events added after the closing pass (ADR-063 to 072)

| Event | Goes to | Link |
|---|---|---|
| `SESSION_CORRECTION_REQUESTED`, `_APPROVED`, `_EMERGENCY`, `SESSION_OUTCOME_CORRECTED` | approvers, executors, session managers, report owners | Governance |
| `STRATEGY_CHANGE_REQUESTED`, `STRATEGY_CHANGE_DECIDED` | approvers; the requester | Strategy |
| `CONFIG_CHANGE_REQUESTED`, `CONFIG_CHANGE_DECIDED`, `CONFIG_CHANGE_EMERGENCY` | holders of the approving permission (the Super Admin when protected); the requester; approvers when an emergency was used | Administration → Approvals |
| `ROLE_CHANGED` | everyone who holds `roles.manage` | Approvals |
| `LOCK_SCHEDULE_CHANGED` | report owners, calendar managers, session managers | Administration |

Read notifications older than the retention period (default 12 months) and finished email rows older than 90 days are removed once a day (ADR-072); unread notifications are never removed.

### Outbound webhooks (ADR-076)

- Every audit-log row is offered to each enabled `WEBHOOK` integration whose event list matches it (`*`, an exact action, or a prefix ending in `*`). Delivery is asynchronous through `webhook_outbox` with leases, back-off of 2/4/8/16 minutes, give-up after five attempts and a 24-hour expiry.
- The payload carries the audit action, entity type and id, outcome, actor role, time and correlation id. It never carries old or new values or a reason. Requests are signed `x-okr-signature: sha256=HMAC(secret, "<timestamp>.<body>")`; `TEXT` format posts `{"text": "..."}` for Slack and Teams.
- An enqueue failure is a warning and never prevents the audit row being written; a delivery failure is recorded in the outbox and never rolls back the business operation. The outbox is closed to browser sessions.
- Historical import sets the `app.historical_import` session flag, which suppresses notifications for the imported activity so old data does not produce new alerts. Strategy import records issues in its batch table and does not broadcast them.

## OKR Session Notes events

All go through `notify_users` (idempotent by dedupe key, never fails the business act) and, like every other event, are emailed only when the person's preference allows (`email_event_types`, none mandatory). Dedupe keys: one notice per action and assignee for an assignment, per action and due date for "due soon" and "overdue", per action and version for blocked/completed/verified/deadline-extended, per decision and status, per minutes revision for submitted/returned/final.

| Event | Who is told |
|---|---|
| `SESSION_ACTION_ASSIGNED` | the new owner (on creation and on reassignment) |
| `SESSION_ACTION_REASSIGNED` | the previous owner |
| `SESSION_ACTION_BLOCKED` | whoever set the action and the facilitator |
| `SESSION_ACTION_COMPLETED` | whoever set the action and the facilitator |
| `SESSION_ACTION_VERIFIED` | owner, completer and creator |
| `SESSION_ACTION_DUE` / `SESSION_ACTION_OVERDUE` | owner (and, for overdue, creator and facilitator); scheduler; skipped when reminders are switched off |
| `SESSION_ACTION_FOLLOW_UP` | owner when an update is requested in a later session, when the deadline moves, or when escalated (executives and facilitator also on escalation) |
| `SESSION_DECISION` | facilitator and participants when a decision is proposed, approved, rejected, withdrawn or superseded |
| `SESSION_MINUTES_REVIEW` | people who can finalise (and may see the session) on submission; the author on return |
| `SESSION_MINUTES_FINAL` | facilitator, participants and the author |

| `SESSION_MENTION` | each person mentioned in a note (`@[Name](user:uuid)`) who is allowed to read that note, once per note; never the author; by a database trigger |

## Executive Oversight events (ADR-102)
Optional email event types (a person can switch each off): `EO_COMMENT_NEW`, `EO_COMMENT_REPLY`, `EO_REC_NEW`, `EO_REC_RESPONSE`, `EO_REC_CLARIFICATION`, `EO_REC_DECISION`, `EO_REC_UPDATE`, `EO_REC_DEADLINE`, `EO_REC_OVERDUE`, `EO_REC_CLOSED`. Recipients: a new shared comment → the target unit's readers; a reply or amendment → the author and earlier repliers who can still read it; a new recommendation → the unit's leads and named contact (title prefixed [HIGH]/[CRITICAL]); acknowledgement, response, decision, clarification, progress → the author; closure or withdrawal → the unit's leads and contact; deadline and overdue stages → per the configured rules. Never the actor; at most one notification per event (dedupe keys); a delivery failure never fails the act. Each opens the oversight page (`notification-actions.ts`).

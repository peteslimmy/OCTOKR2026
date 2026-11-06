# 40 — OKR Session Notes & Meeting Intelligence

Module specification, architecture assessment and security assessment. Decisions: ADR-089 to ADR-093 in `24-DECISIONS.md`. Code: `src/lib/session-notes`, `src/components/session-notes`, `src/app/(app)/session-notes`, `src/app/api/v1/okr-*`, migrations `20261105000001` to `20261105000003`.

## 1. Architecture assessment (what was inspected, what was decided)

| Question | Finding | Decision |
|---|---|---|
| Is the HR attendance session the same event as an OKR review session? | **No.** `governance_sessions` is one organisation-wide row per reporting week (`UNIQUE(reporting_week_id)`) that carries the HR attendance roster, the outcome `SCHEDULED/HELD/SKIPPED`, the skip and the quote. An OKR review is held **per business unit**, can be repeated in one week (weekly review, follow-up, special review), has facilitator, notes, decisions and commitments, and is owned by Presenters, not HR. | Two records. `okr_sessions.governance_session_id` is an optional reference; nothing in this module writes to attendance, rosters, outcomes, violations or the quote (tested). ADR-089. |
| Users, BUs, weeks, quarters, permissions | Exist and are reused (`users`, `employees`, `business_units`, `reporting_weeks`, `quarters`, `permissions`, `role_permissions`, `user_permission_grants`, `user_unit_scopes`). | No new identity, unit, calendar or permission system. New permission **codes** are data, mapped by migration and changeable through the existing role-management process. |
| Notifications, audit, files | `notify_users`, `email_event_types` (preferences honoured), `write_audit`, `evidence` bucket with MIME allow-list and content-signature check. | Reused. Session events use `notify_users`; every governed act calls `write_audit` through `okr_log`; attachments use the private `evidence` bucket with the same upload checks. |
| AI | `src/lib/ai` (4COREPAL), off by default, single door `complete()`, fenced data, figure grounding. | Reused: a proposed summary only; no second AI path (ADR-093). |
| Rich text | The app stores formatted comments as a **safe markdown subset**, never HTML (`src/lib/rich-text.ts`). | Same principle, extended to headings, checklists, tables, links and mentions in `src/lib/session-notes/markdown.ts` (ADR-091, ADR-094). A visual editor and a text editor share it; no new editor dependency. |
| Multiple sessions per BU per week | Required by the business (weekly + follow-up + special review). | No uniqueness on (unit, week). Duplicate **requests** are prevented by request keys instead (ADR-090). |

## 2. Data model

All tables are new, additive, RLS-enabled, with **no insert/update/delete grant** to signed-in users. Writes happen only in `SECURITY DEFINER` functions (service role) that check permission, unit scope, state and version, and write the audit in the same transaction.

| Table | Purpose | Notes |
|---|---|---|
| `okr_session_types` | Configurable session types (seeded: weekly, quarterly, strategy, performance, special management, ad hoc) | Managed with `session_notes.configure` (Admin, Super Admin) |
| `okr_sessions` | A session: reference `OKS-yyyy-nnnn`, type, quarter, optional reporting week, unit (null = organisation-wide), optional `governance_session_id`, date and times, facilitator, agenda, status `DRAFT/IN_PROGRESS/COMPLETED/ARCHIVED`, `version` | Never deleted. `archived_from` lets Restore return to the right state |
| `okr_session_participants` | Who was invited and in what role | Removal keeps the row (`removed_at/by`) |
| `okr_session_notes` | Note entries: category (11), title, markdown content, visibility `SHARED/MANAGEMENT/CONFIDENTIAL`, author, `version`, archive fields, `client_key` | Archived, never deleted |
| `okr_session_note_versions` | Every settled earlier state of a note (who wrote it, who replaced it, why) | Immutable (`forbid_mutation`) |
| `okr_session_links` | Note/decision/action/risk → OKR component (theme, quarter, objective, KR, Sub-KR, BU goal, weekly goal, task, weekly report). Keeps the label as it was and the target unit | No foreign key to the target on purpose: a link still reads after the target is archived or locked. Linking never writes to the target |
| `okr_session_events` | The session timeline: what happened, by whom, with remarks and before-values | Immutable; also written to `audit_logs` via `okr_log` |
| `okr_session_decisions` | Decisions: `PROPOSED → APPROVED/REJECTED/WITHDRAWN`, `APPROVED → SUPERSEDED/WITHDRAWN` | An approved decision is never edited; supersede creates the new one and links both ways |
| `okr_session_actions` | Action items: one row for the whole life of a commitment | Status `OPEN/IN_PROGRESS/BLOCKED/COMPLETED/CANCELLED`, verification and evidence options, extensions count, escalation |
| `okr_session_risks` | Risks, blockers, issues (formal register records) | Generated `fingerprint` recognises the same issue raised in several sessions |
| `okr_session_carryovers` | An open action/risk **reviewed** in a later session (unique per session and item) | This is how carry-forward works without duplicating anything |
| `okr_session_minutes` | Minutes revisions: `DRAFT → SUBMITTED → REVIEWED → FINALISED`; snapshot and SHA-256 hash at finalisation | Finalised revisions immutable; a change is a new revision |
| `okr_session_attachments` | What a stored file is attached to (session, note, decision, action, risk) | Soft removal only; bytes stay in the private bucket |
| `okr_idempotency`, `okr_counters` | Request keys; reference numbers | Not readable by signed-in users |

Read models (`read_okr_*`, security invoker, so row-level security applies): `read_okr_session` (whole workspace), `read_okr_session_search`, `read_okr_outstanding`, `read_okr_note_versions`, `read_okr_minutes`, `read_okr_decisions`, `read_okr_actions`, `read_okr_risks`, `read_okr_dashboard`, `read_okr_link_options`, `read_okr_people`.

### Lifecycle

`DRAFT → IN_PROGRESS → COMPLETED → ARCHIVED`; `COMPLETED → IN_PROGRESS` (reopen, reason required, e.g. completed by mistake); `DRAFT → ARCHIVED`; `ARCHIVED → ` where it was archived from (restore). Completing does not destroy or hide anything. After completion a note change is an **amendment**: reason required, earlier version kept, author recorded. Archived is read-only. Archiving does **not** cancel open actions; they stay open and are still followed up.

## 3. Permissions and access

| Permission | Risk | BU Lead | Presenter | Executive / Director | Admin / Super Admin | HR / Finance |
|---|---|---|---|---|---|---|
| `session_notes.view` | low | own unit + invited | yes | yes | – | – |
| `session_notes.view_all` (protected) | critical | – | yes | yes | – | – |
| `session_notes.create` | medium | yes (own unit) | yes | – | – | – |
| `session_notes.update` | medium | own notes | yes | – | – | – |
| `session_notes.finalise` | high | – | yes | – | – | – |
| `session_notes.archive` | high | – | yes | – | – | – |
| `session_notes.export` | medium | yes (what they can see) | yes | yes | – | – |
| `session_notes.configure` | high | – | – | – | **yes (types only)** | – |
| `session_decisions.create` | medium | – | yes | – | – | – |
| `session_decisions.approve` (protected) | critical | – | yes | – | – | – |
| `session_actions.create` | medium | – | yes | – | – | – |
| `session_actions.assign` | medium | – | yes | – | – | – |
| `session_actions.update` | medium | yes (own unit) | yes | – | – | – |
| `session_actions.verify` | medium | – | yes | – | – | – |
| `session_risks.manage` | medium | – | yes | – | – | – |

Rules beyond the table (all enforced in the database; the UI only mirrors them):

- **Visibility of a session**: `session_notes.view` AND (`view_all` OR the session's unit is yours OR you are its facilitator, creator or an invited participant). Not found and not permitted look alike (404 in the app).
- **Visibility of a note**: `SHARED` — anyone who sees the session; `MANAGEMENT` — holders of `view_all`, the author and the facilitator; `CONFIDENTIAL` — the author and the facilitator only. Minutes are built only from shared notes (management notes only for management minutes; confidential never).
- **Who may change a note**: its author, the facilitator, the creator, or a finaliser; always with `session_notes.update`.
- **Action items**: the assignee, whoever set the action, anyone with `session_actions.assign`, and a BU Lead (with `session_actions.update`) of the responsible unit may report on it. The assignee may always read and report on their own action even without session access. Completion needs remarks (and evidence where the action requires it); an action that needs verification is verified by someone **other than** the person who completed it.
- **HR, Finance, Admin** hold none of the content permissions; **Super Admin holds all** (ADR-112). The Super Admin's "every permission" rule (ADR-085) was a one-time grant of the permissions that existed then; these new codes are deliberately **not** granted to it. A Super Admin or Admin can only reach content by being granted the permissions through the governed role/permission process (which is audited, and `view_all` and `approve` are protected: only a holder can delegate them).
- **Unit scope** (`user_unit_scopes`) limits writing about a unit as it does elsewhere.
- **Executives** are read-only: no create/update permission, so every write is refused in the database.

## 4. API (`/api/v1`; details and error codes in `12-API-CONTRACT.md`)

Sessions: `GET/POST okr-sessions`, `GET/PATCH okr-sessions/{id}`, `POST …/transition`, `POST …/participants`, `GET …/outstanding`, `POST …/carry-forward`. Notes: `POST okr-sessions/{id}/notes`, `PATCH okr-notes/{id}`, `POST okr-notes/{id}/archive`, `POST okr-notes/{id}/links`, `GET okr-notes/{id}/versions`. Registers: `POST okr-sessions/{id}/decisions|actions|risks`, `GET okr-decisions|okr-actions|okr-risks`, `PATCH okr-decisions/{id}`, `POST okr-decisions/{id}/decide|supersede`, `PATCH okr-actions/{id}`, `POST okr-actions/{id}/reassign|extend|escalate|verify`, `PATCH okr-risks/{id}`, `POST okr-links`. Minutes: `GET/POST okr-sessions/{id}/minutes`, `POST …/minutes/ai-summary`, `GET okr-minutes/{id}`, `POST okr-minutes/{id}/submit|review|finalise`. Files: `GET/POST okr-sessions/{id}/attachments`, `GET okr-attachments/{id}`, `POST okr-attachments/{id}/remove`. Reports: `GET okr-sessions/{id}/export?format=pdf`, `GET okr-exports?kind=&format=csv|xlsx|pdf`. Lookups: `GET okr-session-dashboard`, `okr-link-options`, `okr-people`, `okr-session-types` (+ `POST` to configure).

## 5. User journeys (tested in `tests/e2e/25-session-notes.spec.ts`, `tests/db/session_notes.test.ts`)

1. **Presenter weekly review.** Presentation mode shows a *Session notes* card for the unit and week being presented; *Start a session* opens with that unit and week as defaults (changeable). The workspace links back to the same presentation view. Notes (quick note or full editor) are classified only when wanted; observations link to objectives/KRs/goals/tasks from a picker of the unit's current components; decisions are proposed then approved; actions are assigned; risks recorded; commitments from earlier sessions are reviewed in place; the session is completed; minutes are prepared, reviewed and finalised.
2. **BU Lead participates.** Sees only their unit's sessions (and sessions they are invited to), shared notes only, adds responses, updates their actions, attaches evidence.
3. **Action owner completes.** Notified on assignment; opens the action, sees the source session; reports progress or a block (reason required); completes with remarks/evidence; a verifier confirms or sends it back; every step is in the history. Completion never touches an OKR task or goal.
4. **Executive reviews history.** Library and dashboard filtered by quarter, unit, period; read-only; exports of what they may read.
5. **Subsequent session.** *To review from earlier sessions* lists the unit's open actions and risks; each is reviewed with an outcome and remarks (the **same** row; no copy); updates and extensions (with justification) are made through the ordinary functions; the history shows which session each step happened in.

## 6. Exceptions and recovery

| Situation | Behaviour | Message / recovery | Audit |
|---|---|---|---|
| Session without a reporting week | Allowed; quarter from the date | Banner says so | Created event |
| Reporting week final-locked / quarter locked | Session stays fully usable; it never writes to the week | Banner explains | – |
| Connection lost while typing | Autosave retries after 2 s, 5 s, 15 s (*Retrying save…*), then *Save failed* with **Retry now**; the text stays in the editor and in this device's storage | Restored on next visit (*Restore / Discard*) | – |
| Autosave fails permanently (refusal) | *Save failed* with the reason; text kept | Fix the cause or copy the text | Access refusals are logged |
| Two people edit one note | Second save gets `409 VERSION_CONFLICT`; nothing is overwritten; shows their version; choose *Use theirs* / *Save mine over theirs* / copy | Replaced version kept in history either way | Version rows |
| Navigates away with unsaved text | `beforeunload` warning; last attempt on page hide; local copy | Recovery banner | – |
| Duplicate submit / repeated request | Request key (`okr_idempotency`) or client key returns the first answer; reuse of a key for another act is `409 IDEMPOTENCY_KEY_REUSED` | – | One audit row |
| Session completed by accident | Reopen with a reason; finalised minutes stay as they are | – | `STATUS_IN_PROGRESS` with reason |
| Note deleted by mistake | Notes cannot be deleted; *Archive* is reversible with a reason | *Restore* | `ARCHIVED/RESTORED` |
| Decision needs correction | Proposed: amend (earlier wording kept). Approved: supersede (both kept, linked) | – | `AMENDED/SUPERSEDED` |
| Action assigned to a suspended/departed person | Refused at assignment (`ASSIGNEE_UNAVAILABLE`); if it happens later the card says so and offers reassignment | Reassign with a reason | `REASSIGNED` |
| Action overdue | Highlighted; one notice per action and due date to owner, creator and facilitator; dashboard counts | Update, extend with justification, escalate | `DUE_EXTENDED/ESCALATED` |
| Action carried many times | Badge from the 3rd review; listed on the dashboard | Escalate or close | Review events |
| Another unit's notes | `BU_SCOPE_DENIED` / 404; denial recorded | – | Access-denied audit |
| Attachment fails to store | Database record is withdrawn; "Nothing was saved" | Try again | Added + removed events |
| Session archived with actions open | Allowed; the count is shown; actions stay open | – | `STATUS_ARCHIVED` with `open_actions` |
| Linked OKR entity later archived/locked | Link keeps its label and unit; still readable | – | – |
| Notification cannot be delivered | `notify_users` never fails the business act; email follows preferences and the outbox retries | – | – |
| Database transaction fails midway | Every act is one function = one transaction; nothing partial | Error with a plain reason | – |

## 7. Security assessment

| Threat | Control | Test |
|---|---|---|
| Cross-BU read / IDOR / BOLA | RLS `auth_okr_session_visible`, note policy, `okr_get_session` check in every function (`BU_SCOPE_DENIED`), 404 in the app | DB: BU Lead of another unit sees 0 rows and gets `BU_SCOPE_DENIED` on read-by-id and write-by-id; E2E: other unit's session is 404 and its API is 404/403 |
| Privilege escalation | Permission checked inside every function; `view_all` and `approve` protected; HR/Finance/Admin/Super Admin hold no content permission | DB test lists their permission codes; E2E checks UI and API |
| Unauthorised note edit | author / facilitator / creator / finaliser + `session_notes.update` | DB |
| Unauthorised decision approval | `session_decisions.approve`; a BU Lead and an Executive are refused | DB |
| Unauthorised reassignment | `session_actions.assign`; BU Lead refused | DB |
| RLS bypass via REST | No write grants; write functions revoked from `anon`/`authenticated` (checked by catalogue query); read functions are invoker | DB |
| XSS through rich text | No HTML is ever stored or accepted; one renderer escapes every character and emits only a fixed tag set; links http/https/mailto only; 20 attack strings tested including `javascript:`, `data:`, entities, tab-split schemes, markup in tables/headings/code | Unit (39 tests) + E2E (nothing executes, no dialog) |
| Malicious upload | Allow-listed MIME types, file bytes must match the type, 50 MiB cap, built-in malware inspection and optional ClamAV scan before anything is recorded (ADR-094), checksum computed server-side, private bucket, `nosniff`, attachment download re-checks access | Unit (scanner, fake clamd), HTTP (EICAR and a disguised program refused) |
| Concurrent modification | `expectedVersion` on notes, session, decisions, actions, risks, minutes | DB + E2E |
| Duplicate API requests | Request/client keys | DB |
| Unauthorised export / confidential exposure | `session_notes.export`; exports are built from the caller's own readable rows; confidential notes never enter minutes; export audited with filters and row count; CSV/Excel formula-injection defence reused | DB + E2E |
| Tampering with history | Versions, events, finalised minutes, attachments (except removal) refuse update/delete; finalised minutes carry a SHA-256 over text and snapshot | DB |
| AI inventing decisions/commitments | AI output is text in an editor, never a record; unknown `DEC/ACT/RSK` references or ungrounded figures cause the proposal to be discarded; notes are fenced as data; BU names pseudonymised per the existing setting; use audited | Unit |

## 8. Known limits and open decisions

See the report at the end of this module's implementation (`25-IMPLEMENTATION-NOTES.md`, section "OKR Session Notes").

## 9. Note Taker and the weekly quote (ADR-113)

- **Take notes** (`/notes`): choose the weekly session; one organisation-wide rich-text page that saves as you type, with the headings Notes, Recommendations, Actions and Next steps. `POST /api/v1/notes-sessions {weekId}` returns `{session_id, note_id}` and is repeatable.
- **Weekly quote**: HR's rota, configured under Calendar & holidays; units use `/quote`. API: (`POST /api/v1/quote-turns {weekId, buId}`), the unit's entry (`PUT /api/v1/quote-turns/{id} {quote, speakerId}`), the Presenter's "present" (`POST /api/v1/quote-turns/{id} {action:"present"}`), withdrawal (`DELETE`, reason required) and the unit's team (`GET /api/v1/quote-turns/speakers?bu=`).
- Permissions: `quote.assign` (HR, Admin, Super Admin), `quote.submit` (BU Lead for the own unit, Super Admin).

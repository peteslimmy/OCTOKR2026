# 41 — Executive Oversight, Commentary & Recommendations

Module specification, architecture assessment and security assessment. Decisions: ADR-096 to ADR-103 in `24-DECISIONS.md`. Code: `src/lib/executive-oversight`, `src/components/executive-oversight`, `src/app/(app)/executive-oversight`, `src/app/api/v1/executive-*`, migrations `20261106000001` to `20261106000004`. It builds on the Session Notes module (`40-SESSION-NOTES.md`) and reuses its plumbing.

**Governing principle: executive oversight without operational data modification.** Executives and Directors influence the organisation through observations, questions and advice. Every operational change stays inside its existing permissions, approvals and rules.

Three safeguards are built into the data model, not only the screens:

1. **A comment is not a recommendation.** "Good improvement this week" is a comment: it starts no response workflow. A recommendation is a different record with a different lifecycle (`eo_comments` vs `eo_recommendations`).
2. **A recommendation is not an instruction.** The addressed unit accepts, partly accepts or declines it with a reason. Declining has no compliance consequence. Nothing in the module can write to a goal, task, report, score, attendance, violation, finance or strategy record: the module's functions write only `eo_*` tables, and a test compares every operational table before and after a full journey.
3. **History is kept.** Nothing is deleted. Earlier wording of an amended comment is kept. A published recommendation cannot be edited. The event timeline is immutable.

## 1. Architecture assessment

| Question | Finding | Decision |
|---|---|---|
| Is there an existing comment or messaging facility to extend? | Report remarks (`weekly_reports`), AI remarks (4COREPAL), session notes and note replies in Session Notes. Each is bound to its own workflow and visibility. None is a cross-cutting, BU-addressed, answerable channel. | A new module. Session Notes keeps what happened in a meeting; Oversight keeps the formal observations and advice of leadership. They link by reference; neither writes the other (ADR-096, ADR-100). |
| Can a recommendation reuse `okr_session_decisions`? | No. A decision is a meeting outcome with its own approval lifecycle (`PROPOSED → APPROVED`). A recommendation is advice from one person to a unit that may decline it. | Own record. It can *link to* a decision (ADR-100). |
| Users, roles, BUs, weeks, quarters, permissions, notifications, audit, files | Exist (`users`, `employees`, `roles`, `permissions`, `role_permissions`, `business_units`, `reporting_weeks`, `quarters`, `notify_users`, `email_event_types`, `write_audit`, the private `evidence` bucket and its upload checks). | Reused. New permission **codes** are data, mapped by migration; no new identity, unit or calendar system. |
| Executive visibility | `weekly_report.view_all` and `dashboard.executive.view` give Executives and Directors read access to every unit. They hold no write permission over operational records. | Unchanged. The module adds the right to *write about* what they may already read, never to *change* it (ADR-097). |
| Where does the unit answer? | BU Leads already own their unit's reporting and Session Notes participation. | A BU Lead (and anyone granted `executive_recommendation.respond`) answers for their **own** unit; an Executive's `view_all` never lets them answer for a unit (tested). |
| Polymorphic references | Session Notes links without foreign keys on purpose, so a link still reads after the target is archived. | The same, but every link is validated by a resolver on write (existence, unit match, caller may read it) and shown only to people who may read the target (ADR-100). |
| Idempotency, history, audit | `okr_idempotency`, `okr_log`, `forbid_mutation`, `write_audit`, `lock_down_function_grants`. | Reused unchanged (ADR-102, ADR-099). |

## 2. Functional design

**Comment.** A short or long observation on any BU-related record the author may already read. Optional category (configurable: general observation, performance feedback, concern, clarification request, management guidance, recommendation, recognition, follow-up request, strategic observation, compliance concern), optional title, markdown-subset text. Captures the author, the author's role at the time, the unit, the module, the related record (with its label as it was), the quarter and week (inherited from the screen), a visibility classification (`SHARED` with the unit, or `MANAGEMENT` only), and a publication status (`PUBLISHED`, `WITHDRAWN`). Replies are chronological and visibly separate from the original. A BU user can never edit the original; the author can *amend* it with a reason, and the earlier wording stays visible to everyone who can read the comment.

**Recommendation.** Title, detailed recommendation, background, reason, expected outcome, proposed direction, priority (`LOW`/`NORMAL`/`HIGH`/`CRITICAL`: sorting and notification urgency only), affected module, related record, recommended role and person, response requested (yes/no) with an optional deadline, links, attachments. Addressed to one or more units; **each unit has its own record** (`eo_rec_targets`) with its own acknowledgement, response, contact and history.

**Response.** The unit acknowledges receipt, then responds: accept, partially accept (explanation required), decline (reason required), propose an alternative (explanation required), say it is still considering, or ask for clarification (explanation required). After acceptance it reports progress and, finally, "implemented", with remarks and evidence. The change itself is made by the right person through the existing workflow; the unit links that record here.

**Follow-up and accountability.** The author can answer clarifications, ask follow-up questions and close. Closing means *the author has finished following it up*; it does not mean the matter is resolved and it changes nothing elsewhere. Closing before the unit has responded is allowed, reasoned and flagged.

**Escalation.** Configurable reminder and escalation stages (days before/after the deadline and who is told). It is communication only: no stage changes a compliance status or a score.

**Oversight page.** One page for Executives and Directors (and a unit-scoped view for BU Leads): metrics counted from the records the viewer may read, recent comments, recent recommendations, pending and overdue responses, items waiting for an Executive, by-unit and by-priority breakdowns, the full recommendation and comment registers with filters (unit, quarter, week, date range, priority, status, author, category, module, deadline, overdue, waiting-for) and CSV/Excel/PDF export.

**Contextual panel.** An "Executive Commentary" button on Performance, Weekly report, Presentation mode, Strategy (objective and each key result), Executive dashboard, Management brief, Business unit goals, Session workspace, the commitments registers (risks) and Historical report snapshots opens a side panel beside the record being reviewed. It lists what has been said, lets people reply inline, and lets an Executive add a comment or make a recommendation with the unit, quarter, week and record already filled in. The screen behind it is not left.

## 3. Lifecycle

Comment:

```
PUBLISHED --(author, with reason)--> PUBLISHED (version n+1; earlier wording kept)
PUBLISHED --(author, with reason)--> WITHDRAWN (read-only; text and history stay)
```

Recommendation (record level): `DRAFT → ACTIVE → CLOSED`, `DRAFT/ACTIVE → WITHDRAWN`. It becomes `CLOSED` when every addressed unit's record is closed or withdrawn. A draft is visible only to its author and is the only editable state.

Addressed unit's record (`eo_rec_targets.status`):

```
SUBMITTED ──acknowledge──► RESPONSE_REQUESTED (response asked for) / ACKNOWLEDGED (not asked for)
SUBMITTED / ACKNOWLEDGED / RESPONSE_REQUESTED / UNDER_CONSIDERATION / RESPONSE_SUBMITTED
   ├─ ACCEPT ───────────► ACCEPTED_FOR_ACTION
   ├─ PARTIAL ──────────► PARTIALLY_ACCEPTED
   ├─ DECLINE ──────────► NOT_ACCEPTED
   ├─ ALTERNATIVE ──────► RESPONSE_SUBMITTED   (waiting for the Executive)
   ├─ CONSIDERING ──────► UNDER_CONSIDERATION
   └─ CLARIFICATION ────► (same status)        (waiting for the Executive)
ACCEPTED_FOR_ACTION / PARTIALLY_ACCEPTED / IMPLEMENTATION_IN_PROGRESS
   ├─ PROGRESS ─────────► IMPLEMENTATION_IN_PROGRESS
   └─ IMPLEMENTED ──────► IMPLEMENTATION_REPORTED
any open status ──close (author)──► CLOSED         any open status ──withdraw (author)──► WITHDRAWN
```

`awaiting` (`BU` or `EXECUTIVE`) records whose move it is. The author's follow-up question sets `awaiting = BU` (and returns `RESPONSE_SUBMITTED` to `RESPONSE_REQUESTED`); the author answering a clarification hands the move back. A response is **overdue** when one was requested by a date that has passed, the unit has not decided, and it is not waiting for the Executive.

Every transition, its actor, mandatory fields and refusals are enforced in `20261106000002_executive_oversight_functions.sql` and tested in `tests/db/executive_oversight.test.ts`.

## 4. Permissions

Permissions are data (`permissions` / `role_permissions`), seeded by the migration with module `Executive oversight` and a risk level, and changeable only through the existing, audited role-management process.

| Permission | Risk | Executive / Director | BU Lead | Presenter | Admin / Super Admin | HR / Finance |
|---|---|---|---|---|---|---|
| `executive_comment.view` | low | yes (all units) | own unit, shared comments | every unit (owner decision 2026-11-05, migration 20261106000005) | – | – |
| `executive_comment.create` | medium | **yes** | – | – | – | – |
| `executive_comment.reply` | low | yes | yes | yes | – | – |
| `executive_comment.amend` | medium | yes (own comments) | – | – | – | – |
| `executive_recommendation.view` | low | yes | own unit | own unit | – | – |
| `executive_recommendation.create` | high | **yes** | – | – | – | – |
| `executive_recommendation.withdraw` | medium | yes (own) | – | – | – | – |
| `executive_recommendation.close` | medium | yes (own; or any holder if the author is no longer active) | – | – | – | – |
| `executive_recommendation.respond` | high | – | **yes (own unit)** | – | – | – |
| `executive_recommendation.update_progress` | medium | – | yes (own unit) | – | – | – |
| `executive_oversight.dashboard.view` | low | yes | yes (own unit's figures) | – | – | – |
| `executive_oversight.view_all` (protected) | critical | yes | – | – | – | – |
| `executive_oversight.export` | medium | yes | yes (what they can read) | – | – | – |
| `executive_oversight.configure` | high | – | – | – | **yes (lists only)** | – |

Rules beyond the table, all enforced in the database (the UI only mirrors them):

- **Commenting never exceeds viewing.** A subject (record) is accepted only if it exists, belongs to a unit the item is about, and the author may read it (`weekly_report.view_all` / own unit for unit records; session visibility for session records). An id from another unit is `LINK_TARGET_INVALID`.
- **Unit bound.** Without `view_all`, an author may write only about their own unit and inside their `user_unit_scopes`.
- **The unit answers for itself.** `respond` / `update_progress` act only on the person's own unit's record; `view_all` does not let an Executive answer for a unit.
- **Author only.** Amend, withdraw, publish, follow-up and (normally) close belong to the author. A second Executive cannot rewrite or withdraw another's items.
- **HR, Finance, Admin, Super Admin** hold no content permission; Admin and Super Admin only maintain the category list and escalation timelines. The Super Admin's "every permission" grant (ADR-085) predates these codes and deliberately does not include them. They can reach content only by being granted it through the governed role process.
- **Archived unit.** New items cannot be addressed to an inactive unit (`BU_INACTIVE`); existing ones, and the unit's own ability to answer, continue; history stays readable.

## 5. Data model

All tables are new, additive, RLS-enabled, with **no insert/update/delete grant** to signed-in users. Writes happen only in `SECURITY DEFINER` functions callable by the service role only.

| Table | Purpose |
|---|---|
| `eo_categories` | Configurable comment/recommendation categories (seeded: the ten in the specification) |
| `eo_escalation_rules` | Four stages (`APPROACHING`, `OVERDUE_REMINDER`, `OVERDUE_MANAGEMENT`, `OVERDUE_SENIOR`): days, recipient kind (unit leads, responsible contact, author, a role), on/off |
| `eo_comments` | Comments (`EOC-yyyy-nnnn`): author, role at the time, unit (null = organisation-wide, management only), module, subject + label, quarter, week, visibility, status, version, `tsvector` for search |
| `eo_comment_versions` | Every earlier wording with who replaced it, when and why. Immutable |
| `eo_recommendations` | Recommendations (`EOR-yyyy-nnnn`, assigned on issue): all fields of the specification, priority, response requested + deadline, status `DRAFT/ACTIVE/CLOSED/WITHDRAWN`. A trigger forbids editing a published one |
| `eo_rec_targets` | One row per addressed unit: its status, `awaiting`, decision, responsible contact, acknowledgement, response time, closure (and whether closed without response), escalation level, version |
| `eo_events` | The immutable timeline of comments and recommendations: replies, responses, updates, questions, status changes, reassignment, escalation, links, attachments. Also mirrored into `audit_logs` |
| `eo_links` | Reference from a comment or recommendation to a session, note, decision, action, risk or OKR component. Keeps the target's label and unit; soft-removed only |
| `eo_attachments` | Files (private `evidence` bucket); soft removal with reason |

Read models (`read_eo_*`, security invoker, so RLS applies): `read_eo_comments`, `read_eo_recommendations`, `read_eo_dashboard`, `read_eo_comment`, `read_eo_recommendation`, `read_eo_context`, `read_eo_link_options`. Plumbing reused from Session Notes: `okr_idem`, `okr_clean`, `okr_check_version`, `okr_next_ref`, `okr_notify`, `okr_link_target`, `okr_session_visible_to`, `okr_note_visible_to`.

Visibility (single definition, used by RLS and the functions): a **comment** is visible to its author, to holders of `view_all`, and — when `SHARED` — to holders of `executive_comment.view` in the target unit. A **recommendation** is visible to its author (drafts: only), to holders of `view_all`, and to holders of `executive_recommendation.view` in an addressed unit; a unit's person sees only their own unit's record, files and the timeline entries addressed to everyone or to their unit. A **link** to a session record is shown only to people who may read that record.

## 6. API

Base `/api/v1`. All write routes take an optional `requestKey` (8–100 characters): a repeat returns the first result (`replayed: true`); the same key for another act is `409 IDEMPOTENCY_KEY_REUSED`. Unknown body keys are rejected (`422`).

| Method and path | Permission (checked again in the database) |
|---|---|
| `GET/POST executive-comments` | read: `executive_comment.view`; create: `executive_comment.create` |
| `GET executive-comments/{id}` · `…/history` | readable by the caller (404 otherwise) |
| `POST executive-comments/{id}/replies` | `executive_comment.reply` |
| `POST executive-comments/{id}/amend` · `withdraw` | author with `executive_comment.amend` |
| `POST executive-comments/{id}/links` · `attachments` | author · `executive_comment.reply` |
| `GET/POST executive-recommendations` | read: `executive_recommendation.view`; create/issue: `executive_recommendation.create` |
| `GET/PATCH executive-recommendations/{id}` · `…/history` | read; PATCH edits the author's draft only |
| `POST executive-recommendations/{id}/publish` | the author |
| `POST executive-recommendations/{id}/withdraw` | the author, `executive_recommendation.withdraw` |
| `POST executive-recommendations/{id}/close` | the author (or another holder if the author is inactive), `executive_recommendation.close` |
| `POST executive-recommendations/{id}/replies` · `links` · `attachments` | `executive_comment.reply` · author or addressed unit (add only) · author or addressed unit |
| `POST executive-recommendation-targets/{id}/acknowledge` · `respond` | `executive_recommendation.respond`, the unit's own person |
| `POST executive-recommendation-targets/{id}/progress` | `executive_recommendation.update_progress`, own unit |
| `POST executive-recommendation-targets/{id}/follow-up` | the author |
| `POST executive-recommendation-targets/{id}/reassign` | `executive_recommendation.respond`, own unit |
| `GET executive-attachments/{id}` · `POST …/remove` | readable by the caller · the uploader |
| `GET executive-oversight/dashboard` | `executive_oversight.dashboard.view` |
| `GET executive-oversight/context` · `link-options` · `people` | readable by the caller |
| `GET executive-oversight/export` | `executive_oversight.export` |
| `GET/POST executive-oversight/categories` · `escalation-rules` | read; write: `executive_oversight.configure` |

Error codes added to `12-API-CONTRACT.md`: `DUPLICATE_RECOMMENDATION`, `COMMENT_WITHDRAWN`, `RECOMMENDATION_CLOSED`, `BU_INACTIVE`, `RECIPIENT_UNAVAILABLE`; existing codes reused: `PERMISSION_DENIED`, `BU_SCOPE_DENIED`, `NOT_FOUND`, `VALIDATION_ERROR`, `REASON_REQUIRED`, `VERSION_CONFLICT`, `INVALID_STATE_TRANSITION`, `LINK_TARGET_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `IMMUTABLE_RECORD`.

## 7. User journeys (tested in `tests/e2e/26-executive-oversight.spec.ts`, `tests/db/executive_oversight.test.ts`, `tests/api/executive-oversight.api.test.ts`)

1. **Executive reviews a unit.** Opens Performance (or the weekly report, objective, key result, dashboard…), presses *Executive Commentary*, sees what was said, adds a comment (no category needed) or makes a recommendation with the unit, quarter and week filled in, a priority and a response deadline. The screen stays where it was.
2. **Business unit responds.** The BU Lead is notified, opens the recommendation, acknowledges, then accepts, partly accepts, declines (reason mandatory), proposes an alternative or asks for clarification. After acceptance the unit reports progress and "implemented" with remarks and evidence, and links the record it changed through its own workflow.
3. **Executive follows up.** Sees the response in the register and on the overview, answers a clarification, asks a follow-up, and closes with a reason; or withdraws.
4. **Months later.** Opens the register filtered by quarter or unit, reads what was recommended, the unit's answer, the evidence and what followed. Earlier wording of amended comments is kept.
5. **Reminders.** Before the deadline the responsible contact is reminded; after it the configured stages tell the unit's leads, then the author, then the senior role. Nothing changes the unit's compliance status.

## 8. Exceptions and recovery

| Situation | Behaviour | Message / recovery | Audit |
|---|---|---|---|
| Executive tries to change a weekly report through the module | There is no such path: the API has no operational write, and the functions write only `eo_*` tables | – (tested: every operational table unchanged after a full journey) | – |
| Executive uses an id from another unit | `LINK_TARGET_INVALID` (same answer as a missing record); a unit-bound author gets `BU_SCOPE_DENIED` | "That record belongs to a business unit this item is not about" | Access refusals are logged |
| BU user reads another unit's items | Row-level security returns nothing; by id: 404 in the app | – | Access-denied audit |
| Impersonation | The author is the session's verified user; the body cannot carry an author, role or status (422) | – | Author and role snapshot stored |
| Unauthorised closure or approval | Only the author closes; there is no approve action in the module; a BU user cannot close | `PERMISSION_DENIED` | Logged |
| Recommendation closed before the unit responded | Allowed, with a reason; flagged `closed_without_response`; the unit is told | Shown on the unit's card | `CLOSED` event |
| Author suspended | Another holder of `executive_recommendation.close` may close; the recommendation otherwise stays active | Page shows who closed it | Event |
| Contact suspended after receiving a recommendation | The recommendation stays with the unit; the unit's leads are told once; any lead can name another contact | "No longer active" badge | `REASSIGNED` event |
| Archived unit with outstanding recommendations | History readable; the unit can still answer; nothing new can be addressed to it | `BU_INACTIVE` | – |
| Linked OKR record later archived or locked | The link keeps its label and unit; still readable | – | – |
| Duplicate submit, double click, retry after timeout | Request key returns the first result; the same recommendation to the same units within 10 minutes is `DUPLICATE_RECOMMENDATION` | The form keeps its text and its key until it succeeds | One audit row |
| Network interruption during submission | The form keeps what was typed and the same key; resubmitting cannot post twice | Error toast; retry | – |
| Concurrent replies | The parent row is locked while a reply is stored; both are kept in order | – | Both events |
| Comment amendment conflict | `409 VERSION_CONFLICT` with the version on record; nothing overwritten | Reload and re-apply | Version rows |
| Invalid transition | `409 INVALID_STATE_TRANSITION` | Plain-language message | – |
| Notification cannot be delivered | `notify_users` never fails the act; email follows preferences; the act is saved | – | – |
| Malicious attachment | Allow-listed type, signature check, 50 MiB cap, built-in inspection and optional ClamAV; refused files leave no attachment, only an audit line | "This file was not accepted" | `EXEC_OVERSIGHT_ATTACHMENT_SCAN` |
| Unauthorised export | Needs `executive_oversight.export`; built from the caller's own readable rows; formulas defused; capped | `403` | `EXEC_OVERSIGHT_EXPORTED` with filters and row count |
| A recommendation mistaken for an instruction | Banner on every recommendation page; no status named "approved"; the response vocabulary has no way to authorise a change | – | – |

## 9. Security assessment

| Threat | Control | Test |
|---|---|---|
| Operational modification through the module | Functions write only `eo_*`; links are references; no operational permission is added to any role | DB and API: all operational tables unchanged across a full journey |
| IDOR/BOLA, cross-BU read | RLS on every table via `auth_eo_*`; every function re-checks visibility (`BU_SCOPE_DENIED`); 404 in the app | DB: another unit sees 0 rows and is refused by id; API: 404; E2E: 404 page |
| Privilege escalation | Permission and unit scope checked inside each function; `view_all` protected; HR/Finance/Admin/Super Admin hold no content permission | DB permission matrix; API 403s |
| Impersonation | Actor from the verified session; strict body schema | Unit + API |
| Tampering with history | `eo_events`, versions, attachments (except removal), links and published recommendations refuse update/delete (`IMMUTABLE_RECORD`) | DB |
| Silent edit after replies | Amendment needs the author, a reason and a version check; the old text is kept; repliers are told | DB + E2E |
| RLS bypass via REST | No write grants on tables; write functions are service-role only (catalogue query lists every function callable by signed-in people) | DB |
| XSS | No HTML is stored or accepted; one renderer escapes everything and emits a fixed tag set; `javascript:`/`data:` links are dropped | Unit (10 attack strings), E2E (nothing executes, no dialog) |
| Malicious upload | Type, signature, size, malware inspection; private bucket; download re-checks access | API (EICAR and disguised program refused) |
| Unauthorised or injected export | Permission, caller's own rows, formula defence, audit | API + unit |
| Duplicate and concurrent requests | Request keys, duplicate guard, row locks, version checks | DB + API |
| Notification failure | `notify_users` swallows delivery errors; the transaction commits regardless | DB (job idempotency) |

## 10. Tests

- DB: `tests/db/executive_oversight.test.ts` (43 tests): permission matrix, no write grants, comments (context, inheritance, visibility, replies, amendment, withdrawal, immutability), recommendations (draft, publish, fields, no-operational-write, validation, duplicates, notifications), the unit's lifecycle (acknowledge/accept/progress/implement/close, decline with reason, clarification, alternative, follow-up, multi-unit isolation, withdrawal, closing early, suspended author and contact, archived unit), links and visibility, attachments, dashboard counts per role, overdue and escalation idempotency, filters, configuration, audit.
- Unit: `src/lib/executive-oversight/__tests__/oversight.test.ts` (28): schemas, vocabulary, role capabilities, error mapping, notification routes, XSS strings, export report and formula defence.
- API (HTTP): `tests/api/executive-oversight.api.test.ts` (19), plus the existing permission-matrix API test (8) unchanged.
- Concurrency: `tests/concurrency/executive-oversight.test.ts` (6): ten simultaneous replies kept, the same request twice at once (comment and recommendation), two conflicting responses (one wins), two amendments from one version (one wins), a response racing a close (no deadlock).
- Browser: `tests/e2e/26-executive-oversight.spec.ts` (8, Chromium): the Executive journey from the Performance screen, the unit's acknowledge and decline, follow-up and close with every operational table compared, denied paths, the Presenter's read-only panel, XSS, amendment history, accessibility (axe, WCAG 2.2 AA).
- Regression: the role-matrix fixture (`tests/db/fixtures/role-matrix.json`) was regenerated; all existing roles keep every permission they had.

## 11. Known limits and open decisions

See `25-IMPLEMENTATION-NOTES.md`, section "Executive Oversight".

# 4CORE-OKR UI/UX Specification

## UX principles

- Minimal, premium, polished enterprise UI.
- Strong information hierarchy.
- Low visual noise.
- Role-specific workflows.
- Visible lifecycle state.
- Explain unavailable actions.
- Fast normal execution; deliberate high-consequence actions.
- Responsive desktop/tablet/mobile.
- Accessible keyboard/focus/screen-reader patterns.

## Global shell

Header:

- 4CORE-OKR logo/name;
- current quarter;
- BU context where appropriate;
- lock countdown;
- notifications;
- user menu.

Sidebar:

Below 1024px the sidebar is an overlay drawer: it closes on backdrop click, on Escape, or on a leftward touch swipe (80px, or a fast flick); vertical scrolling always stays with the browser.

- Dashboard
- Strategy
- Weekly Execution
- Performance
- Governance
- Finance
- Audit
- Administration

Visibility is permission-based.

## BU Lead Dashboard

Must display:

- current BU;
- current week;
- report state;
- submission state;
- content/final-lock countdown;
- Goal count;
- Done Goal count;
- weekly score;
- compliance;
- strategic coverage.

## Weekly Report screen

Must display:

- BU;
- week;
- report status;
- submission status;
- content-lock time/countdown;
- final-lock time/countdown;
- Goals;
- SMART scores;
- tasks;
- derived Goal state;
- score preview where appropriate;
- Submit Report.

## Goal creation flow

1. Enter goal.
2. Run SMART evaluation.
3. Display dimension scores/warnings.
4. Choose KR-aligned or Stretch.
5. If KR-aligned, choose Sub-KR.
6. Add tasks.
7. Save.

SMART weaknesses are warnings, not blockers.

## Before Content Lock

Show:

- Edit
- Delete
- Add Task
- Edit Task
- Delete Task

## After Content Lock

Hide/disable content mutation controls.
Show only permitted execution-status actions.

Banner:

> Content Locked — goal and task definitions can no longer be changed.

## Final Lock

Show:

> Report Finalized — historical record is immutable.

## Goal card

Must show:

- Goal title;
- Done/Not Done;
- Goal type;
- Sub-KR if applicable;
- SMART score;
- Tasks and statuses.

## SMART component

Show:

- overall score;
- Specific;
- Measurable;
- Achievable;
- Relevant;
- Time-bound;
- warnings;
- suggestions.

## Presenter Mode

Optimised for Tuesday presentation:

- BU selector;
- Objective/KR/Sub-KR mapping;
- Goal status;
- Task list;
- score;
- next/previous BU.

No administrative CRUD clutter.

## Integrity correction dialog

Must show:

- selected Task;
- current status;
- proposed status;
- mandatory reason;
- calculated penalty;
- Apply or Waive;
- waiver reason when needed.

## Executive Dashboard

Focus on:

- organisation execution;
- BU ranking;
- Sub-KR execution;
- non-compliance;
- integrity exceptions;
- finance summary;
- strategic coverage.

## HR Dashboard

Focus on:

- Tuesday session;
- attendance;
- violations;
- weekly quote;
- violation-fund summary.

### Attendance roster and amendment workflows

Show:

- one row per active employee, with status select and notes while the roster is in DRAFT;
- a summary tally of current statuses before saving;
- a confirmation that states finalisation makes the source roster immutable.

After finalisation, the roster is read-only. Show:

> Attendance saved — original roster is immutable. To correct an error, submit an attendance amendment request.

Do not show an Edit or Save action for source values. Authorised HR users may access a separate **Request correction** action for eligible records. The request form displays the original/effective status, proposed status, mandatory reason, optional supporting evidence and a statement that the effective status will not change until independent approval.

The authorised approval queue displays pending requests with employee, session, original/effective and proposed status, requestor, submission time, mandatory reason, optional evidence, and amendment history. Only designated approvers see Approve/Reject actions. Hide/deny the decision action for the requester even if they hold approval permission. Reject records the decision in the application audit trail; a separate written approval document is not required. A mandatory rejection comment is not to be enforced until approved. After decision, show the effective status and a chronological read-only event history. Do not offer a CANCELLED session outcome. When the physical session will not take place in an otherwise reportable week, use SKIPPED; show a read-only virtual-present roster and a prominent skipped-week indicator. The bulk result is not editable per person.

## Finance Dashboard

Focus on:

- available fund balance;
- inflows/outflows;
- pending requests;
- approval history.

## Empty states

Empty states must tell the user what to do.

Example:

> No weekly goals yet. Add at least one SMART Goal before submitting your report.

## Error states

Errors must explain:

- what happened;
- why;
- what can be done next.

Do not expose raw database errors.

## Route transitions

Navigation is never blocked. The outgoing route unmounts immediately and the incoming route renders at once, then enters with a 200ms fade/rise (`page-enter`, the `--motion-standard` token). There is no exit animation that delays the destination, and `prefers-reduced-motion` clamps the entrance to 0.01ms.

## Status feedback

- Data fetches show skeleton rows or a skeleton block, not a spinner.
- Zero-data results use the Empty states section above.
- Completed or failed actions show a toast.

There is one toast API: `toast.success|info|warning|error` (`src/components/ui/client.tsx`) dispatches an event that only `ToastProvider` renders. Auto-dismiss is variant-driven: error 8000ms, warning 6000ms, everything else 5000ms, so a failure stays readable longer than a success.

## Accessibility verification

Accessibility is gated automatically, not reviewed by eye. `tests/e2e/02-accessibility.spec.ts` runs axe-core over `/login` (logged out) and, for each seeded role, every route in its `ROUTES` map: BU Lead (`/dashboard`, `/strategy`, `/weekly`, `/performance`, `/notifications`, `/account/security`, `/reports`, `/reports/bu-scorecard`, `/reports/weekly-compliance`), Presenter (`/dashboard`, `/presentation`, `/performance`), HR (`/governance`, `/governance/amendments`, `/governance/violations`, `/notifications`), Finance (`/finance`, `/finance/ledger`, `/dashboard`, `/reports/fund-actuals`), Executive (`/dashboard`, `/performance`, `/reports` and the executive report views) and Admin (`/dashboard`, `/admin`, `/admin/units`, `/admin/people`, `/admin/calendar`, `/admin/settings`, `/admin/branding`, `/audit`, `/governance`, `/governance/late-reports`, `/account/security`, `/strategy`). It asserts **zero violations of any impact** - not "no criticals". The check runs in the same command as the rest of the e2e gate, so a new violation fails the build.

Consequences that are part of the spec, not implementation detail:

- Every page renders inside exactly one `<main>` landmark (the auth routes share `src/app/(auth)/layout.tsx` for this reason).
- Heading levels are sequential; a card title is the heading for its section, not a level skipped past.
- Body, metadata and muted text meet WCAG AA 4.5:1; non-text UI and focus indicators meet 3:1. `src/lib/utils/__tests__/token-contrast.test.ts` enforces the token half of this by parsing `globals.css`, so a token cannot regress without a failing test.
- Interactive and decorative elements are exposed correctly: an element carrying an accessible name is exposed as `img`/`button`/etc., never as a nameless generic.
- `prefers-reduced-motion` is honoured globally through `MotionConfig` and the global CSS clamp.

### Attendance workflow enhancement — required UX
**Weekly roster (held session):** Show week/date and session outcome prominently. Prepopulate every active staff member with a `PRESENT` status pill. HR should only need to change exceptions using an inline accessible toggle/select. Minimum statuses: `PRESENT`, `ABSENT`, `ON LEAVE`, `EXCUSED`, `ILL`; any configured additional statuses appear in the same control. Show live totals by status and a clear unsaved-changes indicator. Before finalisation, show a concise confirmation that the roster will become immutable. After finalisation, switch to read-only display and provide the separate correction-request action for authorised users.

**Skip OKR for this week:** Place a distinct, permission-gated action beside the session controls, labelled exactly `Skip OKR for this week`. Do not bury it inside each staff row. Confirmation must state: “This will mark the physical session as SKIPPED and tag every staff member VIRTUAL PRESENT. No one needs to be marked individually. Every BU must still submit its weekly report, manually enter a performance summary for this week, and complete normal review.” After success, display `SKIPPED WEEK · VIRTUAL PRESENT`, the actor/time, and the number of staff affected. Disable normal status editing for that session. Prevent accidental double submission and show clear error feedback if the session cannot be skipped.

**Meaning and visual treatment:** `VIRTUAL_PRESENT` must be visually distinct from `PRESENT` (for example, a label/pill with a tooltip “OKR session skipped this week; not a physical-attendance assertion”). Use accessible text in addition to colour. Reports and exports must carry the skipped-session label.

**No cancelled OKR state:** Do not provide a `Cancel session` action or `CANCELLED` status for OKR sessions. The only action for a week with no physical session is `Skip OKR for this week`. Skipping tags all roster-snapshot staff `VIRTUAL_PRESENT` and leaves every BU’s weekly reporting, submission and review obligations active.


### UX-09B Organisation Holiday control
Show a separate permission-gated action labelled `Organization Holiday` beside the weekly calendar/OKR-session controls. It must not look like `Skip OKR for this week` and must not be presented as a cancellation. The user selects the affected reporting week(s), reviews the date range, enters a mandatory reason and confirms. The confirmation explicitly states that no BU weekly report is required for the selected weeks, ordinary report reminders and missing-report penalties are suppressed, and those weeks will be excluded from quarterly scoring. After success, display an `ORGANIZATION HOLIDAY · REPORT NOT REQUIRED` state, actor/time and period. Notify all BU Leads. Do not mark staff VIRTUAL_PRESENT just because the organisation holiday is declared.

For a SKIPPED physical session, notify all BU Leads and activate a required manual summary-comment field in each BU's report. The comment must be authored by the BU Lead, is associated with the reporting week/BU and must be present before report submission can succeed. It supplements and does not replace the weekly report. Show session state separately from report submission/review state.

## OKR Session Notes screens (ADR-089 to ADR-093)

- **/session-notes** (library and dashboard). Headline figures (sessions, awaiting finalised minutes, decisions, action completion rate, outstanding, overdue, blocked, open risks) each link to the records behind them; sessions by unit and by week and repeated issues below; then the filterable library (keyword, unit, quarter, week, dates, type, status, facilitator, note category, decision status, action status) with keyword snippets. *Start a session* opens a dialog whose unit and week default to the ones being viewed.
- **/session-notes/{id}** (workspace). Header: title, reference, status, unit, quarter and week, date, facilitator, a live save state (the worst state of any open editor), lifecycle buttons and a link back to Presentation mode with the same unit and week. Tabs: Overview, Discussion notes, Decisions, Action items, Risks & blockers, Attachments, Minutes, History. Right-hand context panel: unit, quarter, week and the weekly report's submission and score (read only), commitments and risks to review from earlier sessions, and the OKR components linked anywhere in the session.
- **Discussion notes.** Quick note box (type, Enter) and a full editor; notes are a chronological timeline of cards with category, classification, author and times, links to OKR components (picker of the unit's current theme, quarter, objective, key results, Sub-KRs, BU goals, the week's goals, tasks and report), version history, archive and "propose as decision / create action / record as risk" from a note.
- **Editor.** Toolbar (headings, bold, italic, lists, checklist, quote, table, link, undo, redo), live preview, Ctrl+B / Ctrl+I / Ctrl+S, save state text with a coloured dot (never colour alone), retry and conflict handling.
- **/session-notes/registers** (commitments and registers). Action items (with every control), decisions and risks across sessions, filters, "only mine", and export links per register.
- **Presentation mode** gains a *Session notes* card for the unit and week being presented.
- Design: the existing dark-red and white system and primitives only; every control is real and permission-gated; dialogs are the shared accessible `Modal`; the workspace is responsive (context panel stacks under the content on narrow screens); tabs follow the ARIA tabs pattern with arrow-key support.

## Executive Oversight screens (ADR-103)
- **Executive oversight page** (`/executive-oversight`): Overview (twelve counted metrics, pending and overdue responses, items waiting for an Executive, recent comments and recommendations, by unit, by priority), Recommendations register (one line per addressed unit, most urgent first) and Comments register, with filters and CSV/Excel/PDF export. Comments and recommendations carry different badges so they are never confused; "awaiting the business unit" and "awaiting the Executive" are explicit.
- **Recommendation page**: a banner stating it is advice; the detail; each addressed unit's card (status, who is waiting, contact, deadline, escalation) with only the actions that person may take; the conversation and the immutable history; files; links.
- **Comment page and thread**: the original comment apart from chronological replies, "Amended" with every earlier wording, withdrawn state.
- **Executive Commentary panel** on Performance, Weekly report, Presentation mode, Strategy (objective, key results), dashboard, Management brief, Unit goals, Session workspace, registers and report snapshots: side panel beside the record, with quick actions; no navigation away.
Design: the existing tokens, cards, tables and dialogs; status never by colour alone; forms keep their text and request key on failure; dialogs are Radix (focus trap, Esc).

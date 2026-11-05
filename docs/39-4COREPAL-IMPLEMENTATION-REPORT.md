> **Removed (ADR-104, 2026-11-05).** The 4COREPAL AI assistant was removed from the application at the owner's direction because it needs a language model to be installed and kept running. This document is kept as history only. Nothing in it is current.

# 39. 4COREPAL: implementation report

Date: 2026-11-04. Module: **4COREPAL** (the AI Performance Agent), added to the existing 4CORE-OKR application as an isolated, additive module. Design: [38-4COREPAL-DESIGN.md](38-4COREPAL-DESIGN.md). Decisions: `24-DECISIONS.md`.
Status vocabulary used throughout: **Fully tested** (automated test that exercises the behaviour), **Implemented, not fully tested**, **Partial**, **Not implemented**, **Blocked** (needs configuration or an external dependency that is not present).

## Summary in one paragraph

The module is built end to end and is **off by default**. It watches the weekly record, asks the unit that owns each unfinished task for a remark, runs a monthly review of goals that keep being carried forward, opens cases, engages the unit and then the executives by an editable policy, drafts corrective plans that a person submits and a different person approves, judges them on the unit's later scores, forecasts quarter outcomes from the application's own rules, writes 13 reports, answers questions in chat with sources, and lets Super Admins govern all of it. Nothing it does changes a goal, a target, a score, a report or a locked week. **It has not been run against a real AI provider or a real mail server**: neither is configured on the test stack, so the assistant and the written explanations are tested with a scripted model, and email is tested to the point of the outbox.

## 1. Codebase discovered

Next.js 16 App Router on Supabase (Postgres, PostgREST, row-level security), TypeScript, Recharts, Zod; permission-based RBAC (`require_permission`, `auth_has_permission`, 8 system roles, role matrix fixture); SECURITY DEFINER functions with a `p_actor`, an allowlist for client-callable functions (`lock_down_function_grants`), immutable audit log (`write_audit`); notifications plus an email outbox with leases and retries; a scheduler (`run_scheduled_jobs` called by `/api/internal/jobs/run`); an Integrations module with an unused AI-provider slot; rule-based insight engines (management brief, executive report); Vitest (unit, database, API-over-HTTP) and Playwright suites with a separate test stack. Business unit = department; every goal and task belongs to a unit; a task is due at the end of its week; `task_status_history` is the only progress trail.

## 2. Existing architecture reused

AI provider slot and encrypted keys (Integrations); `notifications`, `notify_users`, `email_outbox` and its event types; the scheduler and `job_heartbeats`; `write_audit`; the permission tables and role system; `auth_bu`, `actor_bu`, `actor_has_permission`; the data layer (`getDashboardCells`, `getBuIntelligence`, `getExecutiveReport`, `getManagementBrief`, `getBuWeekTrend`); UI primitives (`Card`, `DataTable`, `Badge`, `Banner`, `PageHeader`); `apiRequest`, `useAction`, `api()` handler (CSRF, MFA, step-up, audit of denials).

## 3. New module architecture

Seven layers (docs/38 section 3): data (allowlisted read-only tools running as the signed-in person); deterministic analytics (predictions, reports, monitors in SQL); retrieval (structured only: no semantic search yet); reasoning (one provider door, `src/lib/ai/provider.ts`, never throws); workflow (daily and monthly runs, cases, closure, plans, approvals); interface (`/ai/**`); governance (permissions, autonomy policy, audit, usage, retention). The model never reads the database, never does arithmetic, and can only ask nine named, scoped tools. Every figure in an answer or explanation must appear in the data it was given.

## 4. Features implemented

Assistant with follow-ups, labelled statements and sources; daily review (findings, remark requests, reminders, escalation); per-task remarks; monthly closure with eight dispositions; performance cases with evidence, hypotheses, timeline; adaptive engagement and escalation by severity; corrective plans with approval and score-based effectiveness; approvals queue; predictions; executive centre; 13 reports with CSV export and print; communications history with email status; administration (switch, settings, autonomy, escalation, usage, activity); retention purge.

## 5. Database

Migrations `20261104000015` to `20261104000022` (all additive; applied from scratch many times and to the real database): 21 `ai_` tables (settings, action policies, escalation policies, conversations, messages, findings, cases, case evidence, case events, remark requests, task remarks, closure requests and items, dispositions, corrective plans and actions, communications, approvals, jobs, usage), 17 `ai.*` permissions, about 45 functions. Every table has row-level security with read-only access for signed-in users; every state-changing function is closed to clients.

## 6. APIs and services

17 routes under `/api/v1/ai/`: assistant, conversations (list, one), remarks, closure, cases (respond, status, note), plans (actions, submit), actions (status), approvals, reports (export, commentary), admin (settings, policies, escalation). Services in `src/lib/ai/`.

## 7. Frontend

16 pages under `/ai`: assistant, executive centre, remarks (list, form), closure (list, form), cases (list, workspace), approvals, reports (list, view), communications, monitoring, administration (settings, policies, usage). One navigation entry ("4COREPAL"), shown only when the module is on and the person may use it.

## 8. Existing files modified, and why

| File | Change | Why |
|---|---|---|
| `src/app/(app)/layout.tsx` | one status read and one navigation entry, for people holding `ai.assistant.use` | reach the module |
| `src/lib/rbac/access.ts` | one capability line | access map completeness |
| `src/lib/domain/errors.ts` | the `AI_DISABLED` code | stable error |
| `src/lib/notification-actions.ts` (+ its test) | links for the new notification types | notifications open the right page |
| `tests/db/fixtures/role-matrix.json` | the new `ai.*` grants (and the removal of one) | the approved role matrix now includes the module's permissions |
| `run_scheduled_jobs()` (database, via migration 18) | one guarded call to `ai_run_jobs()`; a failure in it is swallowed | reuse the scheduler without risk to it |
| `docs/06`, `12`, `24`, new `38`, `39` | specification and decision lines | project contract |

The working tree also holds many uncommitted changes from earlier work (dashboards, finance, presentation and others) that are not part of this module and were left as they were.

## 9. Left untouched

Scoring and quarter formulas, the weekly reporting workflow and locks, the calendar, authentication, row-level security on every existing table, existing dashboards and reports, existing roles (only additive permissions were granted).

## 10. RBAC and security

17 permissions; BU Lead (assistant, own-unit insight, remarks, case view), Executive and Director (organisation insight, cases, communications, export), Admin (adds case management, plan submission, audit), Super Admin (everything, including the three critical ones: configuration, approval, escalation policy). Scope is decided in code from who is asking and again by row-level security. Tests prove: no client can write any `ai_` table or call any state-changing function; anonymous callers read nothing; a unit with no records of its own reads none of another's, in every table; conversations are private even from a Super Admin; nobody approves their own proposal; a high-impact action can never be automatic; no `ai_` function writes roles, permissions, goals, tasks or scores; recorded text is fenced as untrusted data and cannot widen scope. Settings, policy and escalation changes need a recent second factor and are audited with old and new values.

## 11. AI provider and configuration

Anthropic or OpenAI-compatible through the existing Integrations slot (key encrypted there, never in this module). One call path with timeout, bounded retries, no redirects, daily spending ceiling and hourly allowance, every attempt recorded (tokens, cost, outcome). Prices start at 0 (no invented cost) until an administrator enters them. Business unit names go to the provider as placeholders (setting on by default). Free text inside goal titles and remarks is cleaned but not pseudonymised.

## 12. Monitoring and scheduling

The daily review runs once a day after its configured time (Lagos), job-logged, retried, with every step isolated; the monthly review runs on the last day of the month after its time. Both idempotent (unique fingerprints, notification keys, job keys). **No separate weekly or quarterly run exists**: the daily review covers weekly signals, and the quarterly view is the report and the executive centre.

## 13. Email and notifications

In-app notifications for every message, recorded in `ai_communications` with acknowledgement, response and follow-up state. Email goes through the existing outbox, so retries, failure handling and preferences are inherited. **No real email was sent**: no email service is configured on the test stack.

## 14 to 17. Test results

| Suite | Before the module | Now |
|---|---|---|
| Unit (`vitest run src`) | 325 | **387** (62 new: provider, assistant, grounding and safety, predictions, reports, notification links) |
| Database (`tests/db`) | 307 | **404** (97 new in 8 files: foundation, conversations, monitoring, cases and closure, executive, governance, security, journey) |
| API over HTTP | 24 files | **27 files, 180 tests**, including the generated authorisation sweep over every route |
| Browser (Chromium) | not applicable | **99 passed** (specs 02, 19 and the new 24); the other legacy specs not re-run |
| Typecheck, lint | clean | clean (0 errors) |

The database suite was run repeatedly and from a test database rebuilt from every migration; two of my own tests were intermittently wrong and were fixed. Regression: every pre-existing unit, database and API test passes unchanged except the role-matrix fixture (updated for the new grants). **Build:** the application compiles (`next build` on the test build); a production deployment was not performed.

### 17a. Browser tests

Run on the test stack in Chromium: `02-accessibility` (the existing gate, which includes the Management brief pages), `19-premium-ui` (existing) and the new `24-4corepal.spec.ts` (34 tests): **99 passed, 0 failed** in the final run. The new spec opens every 4COREPAL screen as the roles that may open it, with zero accessibility violations (WCAG 2.2 A/AA and best practice), checks the navigation entry is present only when the module is on and the person may use it, checks the case workspace (evidence, hypotheses, plan, timeline), has a unit lead answer a case on screen, and checks that the pages do not scroll sideways on a phone-width screen. The first run found two things, both fixed: the "not switched on" and "no access" notices had no page heading (accessibility rule `page-has-heading-one`), and one test locator was ambiguous. The other legacy browser specs (about 20) were not re-run.

## 18. Outstanding limitations

No document knowledge base, semantic search or retrieval from policies and SOPs (the architecture has a place for it; nothing feeds it). No automatic execution of approved changes: an approved proposal is a recorded decision. Matching of repeated goals in the monthly review is on exact wording (conservative). Plan wording is a fixed template, not model-written. The assistant does not stream and remembers the last eight messages. The figure check tests numbers, not claims. Names inside goal text reach the provider. A single Super Admin cannot approve a plan they submitted (an Admin submits). Weekly and quarterly runs are not separate. Three of the sixteen report types were not built as separate reports (departmental = unit; employee summary has no per-person data; organisational risk is covered by the dependencies report and the executive centre).

## 19. Known issues

Pre-existing and not touched: the browser spec `09-metric-cards` has a stale expectation ("Average BU quarter score"); about 20 older browser specs were not re-run. Found during this work and not fixed because outside scope: none that affect existing behaviour.

## 20. Production deployment instructions

1. Back up the database. Apply migrations `20261104000015` to `20261104000022` with the project's normal migration process (see 37-DB-MIGRATION-CI-GATE.md). They are additive; nothing existing is altered except one guarded call added to `run_scheduled_jobs()`.
2. Deploy the application. The module is off: no 4COREPAL entry appears and nothing runs.
3. Under **Integrations**, add and test the AI provider (and the email service, if not already set up). Without a provider the daily review, remarks, cases and reports still work; the assistant and written explanations do not.
4. Under **Access & permissions**, review the `ai.*` permissions. Make sure **two** people can approve (`ai.approval.decide`: the Super Admin tier) so a plan or proposal can be decided by someone other than its submitter.
5. Open **4COREPAL, Administration**: set the schedule times and the thresholds, enter the provider's prices and a daily spending ceiling, and review **What it may do**.
6. Make sure the scheduler calls `/api/internal/jobs/run` at least hourly (the daily review runs once, after its time, on the first call after it).
7. Switch the module on. Watch **Monitoring** and **Usage and activity** for the first week. Remark requests start with weeks finalised in the last 21 days.
8. To stop: switch it off in Administration (immediate; nothing runs or sends). The tables can stay; removing them is not provided.

## Acceptance criteria (docs/38 and the brief, section 25)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Accessible from the existing application | Fully tested | Navigation entry shown only when on and permitted, and every screen opens clean: API tests and 34 browser tests |
| 2 | Existing functionality intact | Fully tested for unit, database and API suites; **partial** for browser (specs 02 and 19 re-run, the rest not) | Baseline comparison above |
| 3 | Users can converse with the AI | Fully tested with a scripted model; **blocked** against a real provider (none configured) | `assistant.test.ts` (22 tests) |
| 4 | Retrieves real organisational data | Fully tested through the live data layer on report and executive pages; the chat tools' own live adapter is exercised only by those same functions | API and browser tests of reports and executive centre |
| 5 | Respects existing permissions | Fully tested | Assistant scope tests; `ai_security`, `ai_foundation`, route sweep |
| 6 | Understands historical and current performance | **Partial** | Uses the quarter's weeks, trends, cases, plans and remarks; no document or older-quarter memory beyond what the data layer exposes |
| 7 | Monitoring at configured frequencies | **Partial** | Daily and monthly tested; weekly and quarterly are not separate runs |
| 8 | Outstanding activities identified correctly | Fully tested | `ai_monitoring`, `ai_cases` |
| 9 | Monthly closure requests work | Fully tested | `ai_cases` (closure), `ai_journey` |
| 10 | Structured dispositions | Fully tested | `ai_cases`, `ai_journey` |
| 11 | Cases created and tracked | Fully tested | `ai_cases`, `ai_journey`, `24-4corepal.spec.ts` |
| 12 | Adaptive engagement selects recipients | Fully tested for unit, shared and organisation-wide; **partial** for coordination across several units (assigned unit only) | `ai_cases` |
| 13 | Hierarchical escalation | Fully tested | `ai_cases`, `ai_governance` (edited policy) |
| 14 | Corrective plans initiated and monitored | Fully tested | `ai_cases`, `ai_journey` |
| 15 | In-app and email communications | In-app fully tested; email tested to the outbox; **blocked** for real delivery (no mail service configured) | `ai_monitoring`, `ai_executive` |
| 16 | Executive reports reflect actual data | Fully tested with fixed figures; they share the Management brief's engine, which was not cross-checked number by number | `reports.test.ts`, browser and API tests |
| 17 | Numerical insights calculated reliably | Fully tested | Predictions and reports are code; `grounding.test.ts` |
| 18 | Sensitive changes need approval | Fully tested (and nothing sensitive is ever applied) | `ai_security`, `ai_foundation` |
| 19 | All AI actions auditable | Fully tested | Audit assertions in each DB file; activity view |
| 20 | Provider failures do not disrupt | Fully tested | `provider-call.test.ts`, assistant refusal paths, API tests |
| 21 | Migrations successful and backward compatible | Fully tested | Replayed from scratch on every full run; real database upgraded |
| 22 | Existing RBAC and RLS remain effective | Fully tested | Existing suites unchanged and passing; role-matrix test |
| 23 | Critical workflows pass regression | Fully tested for unit, database and API; browser **partial** | Baseline comparison |
| 24 | Builds and deploys | Build fully tested; **deployment not performed** | `next build` |
| 25 | Can be disabled without breaking anything | Fully tested | Default-off API tests; sweep passes with it off |

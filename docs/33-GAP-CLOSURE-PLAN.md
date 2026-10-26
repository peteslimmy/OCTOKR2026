# Gap closure plan: old app versus 4CORE-OKR

Status: **agreed on 2026-10-17 (ADR-078). Phases A to F are built and tested (D, E and F were completed and repaired on 2026-10-25, see ADR-084).** Owner decisions: every conflict agreed as recommended; week numbering and roles left as built; three violation types preloaded. Source: the old-app inventory the owner pasted (not verified against the old code) compared with this build's specification and tests. Each conflict has a recommended position; the owner marks Agree or Change, and only then is the work scheduled. Agreed positions become ADRs in `24-DECISIONS.md` and rows in `25-IMPLEMENTATION-NOTES.md`.

## Part 1. Conflicts to agree (recommended position first)

| # | Conflict | Recommended position | Why | Owner decision |
|---|---|---|---|---|
| C1 | Weekly score: old = share of done tasks per goal; new = goal done only if all tasks done, week = done goals / all goals | **Keep the new rule.** Old scores are never copied; history is recomputed (already decided) | The new rule is the approved scoring spec; mixing two rules makes quarters incomparable | Agree / Change |
| C2 | Undefined tasks: old excluded, new turns them into Not Done at final lock | **Keep new** | Matches the approved lock rule | Agree / Change |
| C3 | Integrity penalty formulas (old has two that disagree) | **Keep new** (sum rates, apply once, floor 0). Old penalties are not imported; the owner re-enters any that still matter as corrections | One rule, tested | Agree / Change |
| C4 | Week numbering (old has three methods) | **Keep ISO weeks in Lagos.** Owner confirms the historical sheet uses ISO week numbers. If it counts weeks from 1 January, add a "week numbering" choice to the history upload that converts to the Monday date | Wrong numbering silently moves every report by a week | **Owner must answer** |
| C5 | Lock times and manual lock/bypass switches | **Keep new** (versioned schedule, no bypass). No work | Bypass switches were the source of old defects | Agree / Change |
| C6 | Quarter lock: old = 30 days after quarter start; new = locks when next quarter begins, changes by request | **Keep new** | Matches the approved strategy-control rules | Agree / Change |
| C7 | Progress model: old stores KR/Sub-KR progress %, weights, Green/Amber/Red | **Keep the weekly-score model for scoring.** Offer an optional, read-only "Sub-KR contribution" view built from weekly goals tagged to each Sub-KR (done goals / goals), so people still see how each KR is doing without a second score | Gives the visibility without a competing number | Agree / Change / Not needed |
| C8 | Roles Manager, Member, Viewer | Map: **Manager → Director** if they approve; **Member → no login** (employee only, attendance); **Viewer → create role VIEWER** (read-only reports). Owner confirms who holds each | Roles are data; no code needed for VIEWER | **Owner must answer** |
| C9 | Single-actor changes and Super Admin bypass | **Keep two-person approval** | Core control | Agree / Change |
| C10 | `login_only` accounts (login, not on attendance roster) | **Add an "on attendance roster" flag on employees**, default yes; roster generation and the attendance reports respect it | Small change; avoids fake absences for people who only log in | Agree / Not needed |
| C11 | Attendance statuses Late / Remote | **Keep new statuses.** Record lateness as a violation type ("Late coming"), which the owner will enter | Avoids two sources for lateness | Agree / Change |
| C12 | Violation categories and fines | **Owner enters types** (Phone violation, Noise, Late coming, Absent, …). Optional preload of the old fine amounts (phone 5,000; lateness 3,000; absenteeism 5,000 NGN) | Owner's stated wish | Preload / Do not preload |

## Part 2. Gaps to implement (proposed order)

Each phase ends with unit, database, API and browser tests, docs updated, and the restore command run so the owner's local data is intact.

### Phase A. Decisions and quick fixes (small)
1. Record the agreed conflict positions as ADR-078 and docs/25 rows.
2. C10 roster flag: migration, employee edit and import column, roster and attendance reports honour it. Tests: roster excludes flagged people.
3. C8 role mapping: create VIEWER role if agreed; document the mapping; no code beyond the role.
4. C4 week numbering choice in the history upload, only if the owner answers "not ISO".

### Phase B. Strategy bulk import (gap B3)
- A Super-Admin-gated upload for quarter strategy (year, quarter, objective, KR number and title, Sub-KR number and title), same staged / rehearsed / committed pattern as the history import. For active quarters it files a change request instead of writing directly (existing strategy-change rules); for ended quarters it follows the history-import rules.
- Replaces the hand-built `scripts/load-organisation.ts` for strategy. Tests: refuses fewer than 3 or more than 4 KRs, a KR with no Sub-KR, duplicates; rehearsal leaves nothing.

### Phase C. Users import with roles and invitations (open from the earlier plan)
- Extend the employee import: login flag, role code, one-time set-password link list for download; roles that change reporting rights go through approval. Tests: no escalation, protected roles need Super Admin.

### Phase D. Unit hierarchy (gap B6)
- Optional parent unit, description and location on units (budget excluded unless asked). Display on Units page and reports. Tests: no cycles.

### Phase E. Sub-KR contribution view (C7, gaps B1/B2 in part)
- Read-only page and dashboard card: per Sub-KR, goals tagged, done share, trend by week; no stored score. Tests: totals reconcile to weekly reports.

### Phase F. Quote workflow (gap B7), only if the owner still uses quotes
- Submit, approve (Director/Admin), publish, archive; banner on the dashboard. Tests: only one published quote per week.

### Phase G. Not planned unless asked
Offline queue, feature flags, consent banner (the hosted deployment may need a privacy notice instead), per-user permission overrides (roles are data and effective), AI quote summaries (waiting on the owner's AI decision), onboarding tour, KR sign-off and versioning (strategy change history already records changes).

## Part 3. What the owner decides now
1. Mark each row in Part 1 (defaults: Agree).
2. Answer the two required ones: C4 (is the sheet's week the ISO week?) and C8 (who holds Manager / Member / Viewer?).
3. Confirm which of Phases A to F to start, and the order. Suggested: A, then B, then C.

## Part 4. Risks
- C4 wrong means every imported week shifts; the rehearsal shows the dates but cannot know the intent, so a one-week sample check against a known report is recommended before the real upload.
- Phases B and C touch strategy and roles; both reuse the approval engine and need no new bypass.
- The old-app facts are from the pasted inventory only.

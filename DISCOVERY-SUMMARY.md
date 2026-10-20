# 4CORE-OKR Complete Discovery Summary

**Date**: 2026-10-19  
**Status**: All tests passing (466 total). Production-grade enterprise codebase.

---

## 1. Project Overview

4CORE-OKR is a production-grade enterprise OKR execution platform built on:
- **Next.js 16** (App Router, TypeScript)
- **Supabase** (PostgreSQL 17 + Auth, RLS)
- **Tailwind CSS** + **Radix UI** primitives
- **Vitest** for unit/DB/concurrency testing
- **Playwright** + **axe-core** for E2E + accessibility

**Key constraints**: NGN currency, Africa/Lagos (WAT) timezone, ISO week numbering, single organisation.

---

## 2. Database Architecture (39 Migrations)

### Core Domains
| Domain | Tables | Key Features |
|--------|--------|--------------|
| **Organisation & RBAC** | organisations, business_units, employees, users, roles, permissions, role_permissions, user_roles, mfa_required_roles, permission_conflicts | Normalized RBAC with BU scope on role assignments |
| **Strategy** | annual_themes, annual_theme_changes, quarters, quarterly_objectives, key_results, sub_key_results, strategy_change_requests, strategy_item_versions | 1 theme/year, 1 objective/quarter, 3-4 KRs/quarter, ≥1 Sub-KR/KR |
| **Weekly Reporting** | reporting_weeks, reporting_schedule_versions, weekly_reports, report_edit_sessions, smart_goals, smart_evaluations, tasks, task_status_history | ISO weeks, versioned lock schedule, SMART goals, task execution |
| **Scoring & Integrity** | weekly_score_snapshots, weekly_compliance, quarterly_execution_scores, integrity_penalty_configurations, integrity_corrections, late_report_exceptions, quarterly_score_amendments, holiday_amendments | Immutable snapshots, penalty sum-then-apply, late-report corrections |
| **Governance & Attendance** | governance_sessions, attendance_records, attendance_amendment_requests, attendance_amendment_events, weekly_quotes, violation_types, violations, violation_payments | Finalized rosters immutable, amendment workflow, SKIPPED→VIRTUAL_PRESENT |
| **Finance** | violation_funds, financial_ledger_entries, disbursement_requests, disbursement_decisions, disbursements, violation_funds | Atomic operations, append-only ledger, no negative balance |
| **Operations** | config_change_topics, config_change_requests, rate_limit_hits, job_heartbeats, retention_settings, historical_imports, unit_types, integrations, session_outcome_corrections | Two-person config changes, rate limiting, health monitoring |

### Security Architecture
- **RLS on all tenant-scoped tables** with `rls_initplan()` rewrite (InitPlan sub-selects for performance)
- **SECURITY DEFINER** functions for all mutations (service_role only)
- **Immutable audit/ledger/integrity/finalized-reports** protected by `forbid_mutation` triggers
- **Access-denied logging** throttled (1/min/person/route)
- **Three-person approval**: request → approve → execute (never same person)

---

## 3. Auth & RBAC

### Identity Resolution (`src/lib/auth/actor.ts`)
```typescript
Actor = {
  id, email, name, buId, buName,
  roles: string[],
  permissions: ReadonlySet<string>,  // flattened from user_roles → roles → role_permissions
  mfa: { required, enrolled, aal: "aal1" | "aal2" }
}
```

### 8 Shipped Roles (data, not code - ADR-069)
| Role | Scope | Key Permissions |
|------|-------|-----------------|
| SUPER_ADMIN | Org-wide admin, no workflow bypass | `roles.manage`, `config.protected.approve`, `history.import` |
| ADMIN | Org-wide admin | `config.approve`, `users.manage`, `audit.read` |
| BU_LEAD | Own BU only | `weekly_report.*`, `goal.*`, `task.*` |
| PRESENTER | All BUs read + integrity | `weekly_report.view_all`, `integrity_correction.create` |
| EXECUTIVE | Org-wide read-only | `weekly_report.view_all`, `strategy.*` |
| DIRECTOR | Org-wide read-only | `weekly_report.view_all` |
| HR | HR ops + attendance | `attendance.session.manage`, `violation.*`, `disbursement.create` |
| FINANCE | Finance approval + ledger | `finance.*`, `disbursement.approve`, `ledger.reversal.*` |

### 74 Permissions with Protection
- **Protected** (need `config.protected.approve` + step-up): `roles.manage`, `users.manage`, `audit.read`, `config.approve`, `ledger.reversal.emergency`, etc.
- **Reserved** (only roles with `roles.manage`): `history.import`, `config.protected.approve`, `config.emergency`, `ledger.reversal.emergency`, `attendance.session.outcome.emergency`, `strategy.annual_theme.change_exception`

### MFA & Recovery
- TOTP with 15-min step-up window (`amr` claim timestamps)
- Crockford Base32 recovery codes (10 codes, 60 bits entropy, `XXXX-XXXX-XXXX`)
- Keyed HMAC-SHA256 storage (prevents offline dictionary attacks)
- Rate limiting: dual store (database prod, memory dev)

---

## 4. API Layer (100+ Endpoints)

### Request Pipeline (`src/lib/api/handler.ts`)
- CSRF/origin check on non-GET
- Correlation IDs + `server-timing` headers
- `cache-control: no-store`
- Auth + MFA enforcement (step-up for sensitive ops)
- Strict Zod validation (rejects undeclared properties)
- Scoped RPC via `adminClient()` (bypasses RLS)
- Auto audit on `PERMISSION_DENIED`/`BU_SCOPE_DENIED`

### Key Endpoint Groups
| Group | Count | Critical Rules |
|-------|-------|----------------|
| Auth | 12 | Anti-enumeration, rate-limited, AAL tracking |
| Strategy | 14 | Change requests for ACTIVE quarters, versioned |
| Weekly Reports | 8 | Edit sessions with leases, content/final lock enforcement |
| Goals/Tasks | 8 | SMART eval server-side, execution status transitions |
| Integrity | 2 | Presenter/Admin/SuperAdmin only, reason + penalty decision |
| Attendance | 8 | Finalized immutable, amendment workflow, SKIP atomic |
| Finance | 7 | Requester≠approver, atomic balance check |
| Config Changes | 7 | Two-person, validated at request time, protected permissions |
| Integrations | 4 | Secrets encrypted AES-256-GCM, Super Admin approval |
| Reports | 8 | Catalogue, execution, export (≤20k rows), snapshots |
| History Import | 3 | Super Admin only, rehearse→commit, immutable |
| Audit/Health | 4 | Filtered export (10k max), public/internal health |

### Standard Error Codes (28)
`AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `BU_SCOPE_DENIED`, `REPORT_CONTENT_LOCKED`, `REPORT_FINAL_LOCKED`, `GOAL_MINIMUM_REQUIRED`, `INTEGRITY_REASON_REQUIRED`, `ATTENDANCE_AMENDMENT_SELF_APPROVAL`, `DISBURSEMENT_SELF_APPROVAL`, `INSUFFICIENT_FUNDS`, `CONCURRENT_UPDATE`, etc.

---

## 5. Business Rules & State Machines

### Weekly Lifecycle (WAT)
```
Monday 00:00          → Week opens
Tuesday 18:00         → Content Lock (no goal/task edits)
Following Tuesday 11:00 → Final Lock (immutable, UNDEFINED→NOT_DONE)
```

### Three Weekly States
| State | Report Required? | Quarterly Denominator? | Attendance |
|-------|-----------------|----------------------|------------|
| **NORMAL** | Yes | Yes | Normal roster |
| **SKIPPED** (physical session) | Yes + manual summary | Yes | VIRTUAL_PRESENT (bulk, atomic) |
| **ORGANIZATION_HOLIDAY** | No (suppressed) | **Excluded** | Unchanged |

### Scoring Engine
- **Base**: `doneGoals / totalGoals × 100` (equal weight, stretch counts)
- **Integrity Penalty**: Sum rates → apply once: `final = max(0, base × (1 - sum(rates)))` rounded to 2dp
- **Quarterly**: Arithmetic mean over all non-holiday weeks; missing = 0.00; N/A if zero eligible weeks
- **Late Report**: Controlled amendment → new quarterly version, original zero preserved

### Integrity Workflow
- **Actors**: Presenter, Admin, SuperAdmin (not BU Lead)
- **Trigger**: DONE → NOT_DONE only
- **Decision**: APPLY (rate from config) or WAIVE (requires reason)
- **Audit**: Immutable correction record with base, rates, combined, final, version

### Finance Rules
- Violation payments → ledger credits (atomic)
- HR/Admin creates disbursement requests
- Finance approves/rejects (requester ≠ approver)
- Rejection requires justification
- Balance never negative (transactional check)
- Ledger append-only, reversal via controlled workflow

---

## 6. Frontend Architecture

### Route Structure
```
/(app)/                    # Authenticated shell
  /dashboard              # Role-aware (Exec/BU/HR/Finance)
  /strategy               # Annual Theme → Objective → KRs → Sub-KRs
  /weekly                 # Live weeks, report editor
  /performance            # Quarterly scores, weekly contributions
  /governance             # Sessions, attendance, violations, amendments
  /finance                # Fund balance, ledger, disbursements
  /reports                # Catalogue, builder, insights, snapshots
  /admin                  # Units, people, roles, calendar, settings, branding, integrations, approvals
  /presentation           # Tuesday exec mode (BU selector, mappings)
  /audit                  # Filterable log, CSV export
  /notifications          # Business events, read/unread
  /account/security       # Password, TOTP, recovery codes
/(auth)/                  # Public auth screens
  /login, /forgot-password, /reset-password
/page.tsx                 # Dynamic landing from admin settings
```

### Shell Navigation
- Collapsible sidebar (overlay drawer <1024px)
- Command palette (`Ctrl+K`) for instant navigation/actions
- Header: logo, quarter, BU context, lock countdown, notifications, user menu
- Permission-based visibility

### Design System
- **Colors**: Dark red brand (#7f1519/#9b1c20), white enterprise palette
- **Spacing**: Strict 4px grid (0,4,8,12,16,24,32,40,48,64)
- **Motion**: 200ms standard, `prefers-reduced-motion` → 0.01ms
- **Typography**: Geist Sans/Mono, sequential heading levels
- **Components**: Primitives (Button, Card, Badge, Field, DataTable) + specialised (MetricCard, Drawer, Hero, StepForm, AnimatedNumber, 3D charts)

### Accessibility (WCAG 2.2 AA)
- **Enforced**: `tests/e2e/a11y.spec.ts` runs axe-core on 8 critical routes, **zero violations of any impact**
- Single `<main>` landmark per page
- 4.5:1 text contrast, 3:1 UI/focus
- Full keyboard navigation, visible focus indicators
- ARIA-describedby on all form fields

---

## 7. Test Baseline (All Passing)

| Suite | Files | Tests | Duration |
|-------|-------|-------|----------|
| Unit | 26 | 216 | 17.6s |
| Database | 35 | 245 | 51.7s |
| Concurrency | 1 | 5 | 1.2s |
| **Total** | **62** | **466** | **~70s** |

### Test Coverage Areas
- Domain logic (scoring, SMART, week labels, schedule, passwords)
- DB: RLS policies, state machines, constraints, RPCs, fixtures
- Concurrency: Optimistic locking, financial race conditions
- API: Permission matrix vs HTTP responses
- E2E: A11y gate + critical user flows

---

## 8. Gap Closure Plan (docs/33-GAP-CLOSURE-PLAN.md)

**Phases A-C built and tested; D-F not started.** Owner decisions needed:

| Conflict | Recommended | Owner Decision |
|----------|-------------|----------------|
| C1: Scoring rule | Keep new (all tasks done = goal done) | Agree/Change |
| C4: Week numbering | ISO weeks in Lagos | **Required** |
| C8: Role mapping | Manager→Director, Member→no login, Viewer→VIEWER role | **Required** |
| C10: Attendance roster flag | Add `on_attendance_roster` flag | Agree/Not needed |
| C12: Violation fines | Preload old amounts (phone 5k, lateness 3k, absent 5k NGN) | Preload/Do not |

**Proposed order**: A (decisions + quick fixes) → B (strategy bulk import) → C (users import with roles) → D (unit hierarchy) → E (Sub-KR contribution view) → F (quote workflow)

---

## 9. Key Implementation Notes (docs/25-IMPLEMENTATION-NOTES.md)

98 rows of specification gaps/ambiguities with resolutions and open owner decisions. Key themes:
- AI integration gap: `activeAi()` exists but no feature calls it
- Submitted-but-unreviewed report quarter-finalisation treatment (open decision)
- Tie-breaker rules for ranking (configuration decision)
- Password policy common list source (external vs bundled)
- Organisation holiday notification channel (email vs in-app only)

---

## 10. ADR Log (docs/24-DECISIONS.md)

80+ ADRs documenting every architectural decision:
- ADR-001: Next.js + Supabase stack
- ADR-031: Attendance amendment workflow
- ADR-032: Late-report correction after quarter lock
- ADR-035: SECURITY DEFINER for all mutations
- ADR-038: Literal permission codes at call sites
- ADR-053: Reports module (deterministic rules engine)
- ADR-055: Display rounding (1dp) vs storage (2dp)
- ADR-066: RLS InitPlan performance
- ADR-069: Roles are data
- ADR-076: Integrations module (encrypted secrets)
- ADR-077: Reserved permissions (Super Admin tier)
- ADR-078: Gap closure plan decisions
- ADR-079/080: Strategy import / Sign-in import

---

## 11. Current Development State

### ✅ Complete (Milestone 1)
- Full database schema (39 migrations)
- Complete RBAC with 8 roles, 74 permissions, protected/reserved
- Auth with MFA, recovery codes, rate limiting, step-up
- API layer with all 100+ endpoints
- Weekly reporting + content/final lock lifecycle
- Scoring engine (base, integrity, quarterly, late-report)
- Attendance (roster, SKIP, amendments, violations)
- Finance (fund, ledger, disbursements, reversals)
- Strategy (themes, quarters, KRs, change control)
- Reports module (13 reports + builder + insights + snapshots)
- Integrations (SMTP, AI, webhooks - encrypted, Super Admin gated)
- Admin (units, people, roles, calendar, settings, branding, approvals)
- Full UI with shell, dashboards, presenter mode, a11y gate
- All tests passing

### ⏳ Pending Owner Decisions
1. **C4**: Does historical sheet use ISO week numbers in Lagos?
2. **C8**: Who holds Manager / Member / Viewer roles?
3. **C12**: Preload old violation fine amounts?
4. Which gap closure phases to start and in what order (A-F)?

### 🚫 Not Started (Unless Asked)
- Offline queue, feature flags, consent banner
- Per-user permission overrides
- AI quote summaries
- Onboarding tour
- KR sign-off and versioning

---

## 12. Architecture Strengths

1. **Security by default**: RLS + SECURITY DEFINER + immutable audit + SoD at DB level
2. **No hidden side effects**: Explicit domain services, typed DTOs, strict validation
3. **Business rules in specs, not code**: ADR-governed, testable acceptance criteria
4. **Observability built-in**: Correlation IDs, server-timing, job heartbeats, health endpoints
5. **Accessibility as CI gate**: Zero axe violations enforced
6. **Roles as data**: No role names in code, permission-driven everywhere
7. **Versioned everything**: Lock schedules, score snapshots, quarterly scores, strategy
8. **Atomic financial operations**: Transactional balance checks, no negative fund

---

## 13. Files to Reference for Implementation Work

| Need | File |
|------|------|
| Business rules authority | `docs/00-SOURCE-OF-TRUTH.md`, `docs/04-BUSINESS-RULES.md` |
| Scoring formulas | `docs/07-SCORING-ENGINE.md` |
| State machines | `docs/08-STATE-MACHINES.md` |
| Database schema | `docs/10-DATABASE-SPEC.md` |
| RLS/Security | `docs/11-RLS-SECURITY.md` |
| API contracts | `docs/12-API-CONTRACT.md` |
| UI/UX specs | `docs/13-UI-UX-SPEC.md` |
| Acceptance criteria | `docs/20-ACCEPTANCE-CRITERIA.md` |
| Implementation gaps | `docs/25-IMPLEMENTATION-NOTES.md` |
| ADR log | `docs/24-DECISIONS.md` |
| Gap closure | `docs/33-GAP-CLOSURE-PLAN.md` |

---

## 14. Next Steps

Awaiting your direction on:
1. **Owner decisions** for C4, C8, C12 conflicts
2. **Phase selection** from gap closure plan (A-F)
3. **Any new feature** or **bug fix** to implement

The codebase is production-ready. All critical paths tested. No mock/fake values in production code paths. No hardcoded business data. Every high-risk operation auditable and authorized.
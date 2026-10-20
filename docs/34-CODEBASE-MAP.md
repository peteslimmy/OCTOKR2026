# 34 — Codebase Map

Code-first orientation for the existing `4core-okr` application. This document answers three
questions that the specification set does not:

1. What already exists, and where does it live?
2. Which existing file is the pattern to copy for the change I am about to make?
3. Which rules are enforced by the code itself, so I cannot break them by accident?

The specification remains authoritative for business behaviour (`00-SOURCE-OF-TRUTH.md`). This
document is authoritative only for **where code lives and how it is wired**. When the two
disagree, see §7 and raise it; do not silently follow the code.

Status as at baseline commit `63c0231` (tag `baseline-2026-10-20`): 369 source files, 158 route
handlers, 42 pages, 40 migrations, 83 test files.

---

## 1. Layering and file ownership

| Layer | Location | May import | Must never |
|---|---|---|---|
| Proxy (edge of request) | `src/proxy.ts` | `next/server`, `@supabase/ssr` | Business logic, DB queries, domain imports |
| Page (server component) | `src/app/(app)/**/page.tsx` | `@/lib/auth/actor`, `@/lib/data`, `@/lib/domain`, `@/components/**` | Writes of any kind, service-role client, raw SQL |
| Route handler | `src/app/api/v1/**/route.ts` | `@/lib/api/handler`, `zod` | DB access, domain decisions, `fetch` to own API |
| API wrapper | `src/lib/api/handler.ts` | auth, `zod`, `adminClient` | Domain rules (it is transport only) |
| Read models | `src/lib/data/*.ts` | `server-only`, `userClient()`, `unwrapRows`/`dbError` | `adminClient`, mutations |
| Domain logic (pure) | `src/lib/domain/*.ts` | other domain modules, `decimal.js` | React, Next, Supabase, I/O |
| Database authority | `supabase/migrations/*.sql` | — | — |
| Client components | `src/components/**` | `apiRequest`/`apiUpload`, primitives | Business authority (permissions, locks, scores, balances) |

### Request flows

**Every business mutation** (of the 158 route handlers, this is the shape of all of them except the `health` and jobs endpoints):

```
browser → apiRequest() → POST /api/v1/*
  → src/proxy.ts           session refresh, page/API gate, CSP nonce
  → api() wrapper          same-origin → getActor() → MFA/step-up → Zod allowlist
  → ctx.rpc(fn, args)      SERVICE ROLE (src/lib/supabase/admin.ts)
  → SECURITY DEFINER fn    permission → BU scope → lifecycle state → audit (same tx)
  → jsonb result
```

**Every read**:

```
page.tsx → requireActor() → src/lib/data/*.ts → userClient() (RLS) → table select | read_* RPC
```

Consequences worth internalising:

- There is no server action anywhere in the tree. Client components mutate only through
  `/api/v1/*` via `apiRequest`.
- The service-role key exists for exactly one purpose: `ctx.rpc()`. Any direct `adminClient`
  import outside `handler.ts` and jobs/scripts is a defect.
- The page gate in `proxy.ts` is a convenience. Every page still calls `requireActor()`
  (`src/lib/auth/actor.ts:66`) because pages render in parallel with layouts.

### The wrapper contract

`api()` at `src/lib/api/handler.ts:51`:

| Concern | Implementation |
|---|---|
| Correlation id | `x-correlation-id` header or generated; echoed in response and errors |
| CSRF | `sameOrigin()` (`:40`) — Origin host must equal `x-forwarded-host`/`host` |
| Identity | `getActor()` from `auth.getUser()`, never cookie claims (ADR-035) |
| MFA | `stepUp: true` requires a TOTP within 15 minutes (`:76-82`); `partial: true` for account/MFA endpoints |
| Validation | Zod object schema, unknown keys rejected (`:92`) — no mass assignment |
| Execution | `ctx.rpc()` invokes the DB function as service role (`:103`) |
| Refusal logging | `record_access_denied` (`:117`) |
| Errors | `DomainError` → status + stable code + safe copy via `src/lib/domain/errors.ts` |

### Canonical examples to copy

| Task | Copy from |
|---|---|
| Thin mutation route, body + id | `src/app/api/v1/weekly-reports/[id]/submit/route.ts` |
| Thin mutation route, optional version guard | `src/app/api/v1/goals/[id]/delete/route.ts` |
| Authenticated page with gate + data | `src/app/(app)/strategy/page.tsx` |
| Page shell / nav composition | `src/app/(app)/layout.tsx` |
| Migration with RPCs, RLS, audit | `supabase/migrations/20261019000008_strategy_change_control.sql` |
| Read model with RPC + unwrap | `src/lib/data/config.ts` |
| Read model with table select | `src/lib/data/index.ts` (`listQuarters`, `listEmployees`) |
| DB test | `tests/db/helpers.ts` + any `tests/db/*.test.ts` |

---

## 2. Application surface inventory

### Pages (43)

| Area | Routes |
|---|---|
| Auth | `/login`, `/forgot-password`, `/reset-password` (group `(auth)`), `/` landing |
| Overview | `/dashboard`, `/notifications` |
| Execution | `/strategy`, `/weekly`, `/weekly/[reportId]`, `/performance`, `/presentation` |
| Reporting | `/reports`, `/reports/builder`, `/reports/insights`, `/reports/metrics`, `/reports/saved`, `/reports/[reportId]`, `/reports/snapshots/[id]` |
| Governance | `/governance`, `/governance/sessions/[sessionId]`, `/governance/amendments`, `/governance/late-reports`, `/governance/violations` |
| Finance | `/finance`, `/finance/ledger` |
| Audit | `/audit` |
| Administration | `/admin`, `/admin/people`, `/admin/units`, `/admin/roles`, `/admin/calendar`, `/admin/settings`, `/admin/branding`, `/admin/site`, `/admin/integrations`, `/admin/approvals`, `/admin/import`, `/admin/import/business-units`, `/admin/import/history`, `/admin/import/sign-ins`, `/admin/import/strategy` |
| Account | `/account/security` |

### API groups (158 handlers under `src/app/api`)

`health`, `internal/health`, `internal/jobs/run`; `v1/auth/*` (login, logout, me, password
forgot/reset/change, mfa enroll/verify/disable/recover/recovery-codes/status);
`v1/admin/penalty-rate`; `v1/attendance-*`; `v1/audit` (+`export`); `v1/branding` (+assets);
`v1/business-units` (+`[id]`, `bulk-delete`); `v1/config-changes` (+decision/withdraw/emergency);
`v1/dashboards/{bu,executive}`; `v1/disbursement-requests` (+approve/disburse/reject/review);
`v1/employees` (+`[id]`, `[id]/roster`); `v1/finance/{fund,ledger}`; `v1/goals/[id]`
(+`delete`, `tasks`); `v1/governance-sessions` (+attendance, finalize, skip-okr,
outcome-corrections, emergency-outcome-correction); `v1/history-imports` (+rehearse/commit);
`v1/holiday-amendment-requests` (+decision); `v1/holiday-amendments`;
`v1/imports/[entity]/{parse,validate,commit}` + `v1/imports/batches`;
`v1/integrations` (+request, test); `v1/integrity-corrections` (+preview);
`v1/late-report-exceptions` (+candidates, apply, revoke); `v1/ledger` (+reversals);
`v1/notifications`; `v1/organisation`; `v1/permissions`, `v1/roles`; `v1/reporting-weeks/current`;
`v1/reports/*`; `v1/settings/*`; `v1/strategy/*`; `v1/users` (+suspend/reactivate);
`v1/weekly-reports/*` (current, `[id]`, submit, edit-session + heartbeat);
`v1/webhooks/*`.

### Shared UI (`src/components`)

| File | Purpose |
|---|---|
`ui/primitives.tsx` | Design-system atoms (see §5)
`ui/client.tsx` | Client plumbing: `apiRequest`, `apiUpload`, `toast`, `ToastProvider`, `useAction`, `Modal`, `ConfirmButton`, `StepUpHost`, `ClockProvider`, `Countdown`, `useOpenOnNew`, `setStepUpPrompt`
`ui/metric-card.tsx` | KPI tile (`label`, `value`, `kind`, `note`, `definition`, `href`)
`ui/step-form.tsx` | Multi-step form (`StepForm`, `Step`, `ReviewRow`)
`ui/drawer.tsx` | Slide-over panel with return focus
`ui/hero.tsx`, `ui/animated-number.tsx` | Presentation accents
`shell.tsx` | Sidebar/header shell, nav model, `ICONS` registry
`status.tsx` | Status badges, `ScoreText`, `wat`, `watDate`, `ComplianceBadge`
`smart-panel.tsx` | SMART evaluation display
`integrity-dialog.tsx` | Integrity correction flow
`analytics/*`, `reports/*`, `site/*`, `motion/*` | Feature-scoped composites

### Domain and data libraries

`src/lib/domain`: `scoring.ts`, `errors.ts` (119 codes), `time.ts` (WAT locks),
`week-label.ts` (ADR-055), `schedule.ts`, `smart.ts` (v1.0.0), `password-policy.ts`.

`src/lib/data`: `index.ts` (strategy, weeks, reports, dashboards, people, notifications),
`governance.ts`, `config.ts`, `analytics.ts`, `audit.ts`, `audit-unwrap.ts`, `branding.ts`,
`integrations.ts`, `site.ts`, `errors.ts`.

---

## 3. Where do I add X

### A new page

1. `src/app/(app)/<area>/page.tsx` — server component. `export const metadata`. Signature
   `({ searchParams }: PageProps<"/<route>">)`; `await` the params.
2. `const actor = await requireActor();` then gate the content with `can(actor, "<permission>")`.
   A page the actor cannot use should still render a clear refusal, not crash.
3. Read through `src/lib/data` only. Never query Supabase from the page.
4. Add the nav entry in `src/app/(app)/layout.tsx` (`groups`/`add(...)`) and, if the icon is new,
   a key in `ICONS` (`src/components/shell.tsx`).
5. Add interaction components beside the page (`*-actions.tsx`, `"use client"`) that call
   `apiRequest`. Do not create a second API surface.

### A new mutation endpoint

1. Confirm the operation is not generic CRUD and has a permission + state rule.
2. Add the DB function first (see D), then the route:

```ts
// src/app/api/v1/<resource>/[id]/<verb>/route.ts
import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api(
  { body: z.object({ reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8) }), stepUp: true },
  async ({ actor, body, params, rpc }) =>
    rpc("<verb>_<resource>", {
      p_actor: actor.id,
      p_id: params.id,
      p_reason: body.reason,
      p_idempotency_key: body.idempotencyKey,
    }),
);
```

3. If the response is a success payload the UI needs, return it from the RPC as `jsonb`.
4. Add the code to `docs/12-API-CONTRACT.md` and a DB/API test.
5. High-risk verbs (`stepUp: true`): anything that changes money, scores, locks, permissions,
   roster/attendance, or applies an amendment.

### A new read model

Add the function to the relevant `src/lib/data/*.ts`. Prefer a `read_*` RPC when the query needs
scope logic, aggregation, or columns that RLS alone cannot express safely:

```ts
export interface ThingRow { id: string; name: string }
export async function listThings(limit = 100): Promise<ThingRow[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_things", { p_limit: limit });
  if (error) throw dbError(error, "things");
  return (data as ThingRow[]) ?? [];
}
```

Table selects are correct for plain, RLS-covered reads (`listQuarters`, `listEmployees`,
`currentQuarter`). Use `unwrap(res, "label")` / `unwrapRows(res, "label")` so failures name what
was being read.

### A new business rule

1. Pure logic goes in `src/lib/domain/<topic>.ts` with a version constant if it can affect
   historical scores (`WEEKLY_RULE_VERSION`, `SMART_ENGINE_VERSION`).
2. Authoritative enforcement goes in SQL. The TS copy exists for display and pre-validation only;
   if the two diverge, the DB wins and the TS copy is the bug.
3. Rounding is `Decimal` + `ROUND_HALF_UP`; money never uses floats.

### A new permission

Permissions are **data**, not TypeScript (ADR-069). A migration inserts the code into
`permissions` and grants it in `role_permissions`. Then use `can(actor, "<code>")` in UI and
`perform require_permission(p_actor, '<code>')` in the RPC. Reserved codes live in
`docs/06-ROLES-PERMISSIONS.md`.

### A new migration

Filename `supabase/migrations/YYYYMMDDNNNNNN_<snake_topic>.sql`. Copy the header and structure of
`20261019000008_strategy_change_control.sql`:

```sql
-- Owner decision (ADR-0xx, YYYY-MM-DD): <what changed and why>
-- Rationale: <the rule this enforces>

insert into permissions (code, description) values ('thing.do', 'Do the thing') on conflict do nothing;
insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r, permissions p
  where r.code = 'ADMIN' and p.code = 'thing.do' on conflict do nothing;

alter table things add column if not exists decided_by uuid references users(id);
alter table things add constraint things_pending_has_no_decision
  check ((status = 'PENDING') = (decided_by is null));

create or replace function do_thing(
  p_actor uuid, p_id uuid, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row things; v_existing thing_events;
begin
  perform require_permission(p_actor, 'thing.do');
  select * into v_existing from thing_events where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_id <> p_actor then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'id', v_existing.id);
  end if;
  select * into v_row from things where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.status <> 'PENDING' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  -- ... state change, timestamps via app_now() ...
  perform write_audit(p_actor, 'THING', v_row.id, 'DO', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('replayed', false, 'id', v_row.id);
end $$;

select lock_down_function_grants();
```

Non-negotiable in every migration:

- `security definer set search_path = public, pg_temp` on every RPC.
- `p_actor uuid` first argument; permission checked inside, not by the caller.
- `select ... for update` before mutating a row that has a state machine.
- Idempotency replay-first (`IDEMPOTENCY_KEY_REUSED` when the key is reused for a different act).
- `write_audit(...)` in the same transaction as the change.
- Business timestamps from `app_now()`, never `now()` (tests travel time via `app.test_now`).
- Finish with `select lock_down_function_grants();` — without it the browser can call the
  function directly through PostgREST with the anon key.
- Never `delete` historical rows (audit, ledger, strategy, reports). Retire or supersede.

### A new test

| Lane | Location | Runs against | Isolation |
|---|---|---|---|
| Unit | `src/**/*.test.ts` | pure functions | n/a |
| DB | `tests/db/**/*.test.ts` | local Supabase | `withTx()` always rolls back |
| API | `tests/api/**` | running dev server + seeded DB | real writes |
| Concurrency | `tests/concurrency/**` | local DB | **commits**, reset DB first |
| E2E | `tests/e2e/**` | Playwright | fresh browser context |

DB tests use `withTx`:

```ts
import { withTx } from "./helpers";

test("approving applies the amendment", () => withTx(async (ctx) => {
  const { q, rpc, asUser, bu, user, setNow, expectError } = ctx;
  const lead = await user(["BU_LEAD"], await bu("FIN"));
  await rpc("submit_thing", lead, "uuid", "reason", "key-0001");
  await expectError("SELF_APPROVAL_FORBIDDEN", () => rpc("decide_thing", lead, "uuid", "APPROVE", null, "key-0002"));
}));
```

`ctx.rpc` spreads its arguments in order after the function name, so the first argument is
`p_actor` by convention.

---

## 4. Page template

```tsx
import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listThings } from "@/lib/data";

export const metadata: Metadata = { title: "Things" };

export default async function ThingsPage({ searchParams }: PageProps<"/things">) {
  const sp = await searchParams;
  const actor = await requireActor();
  const things = await listThings();

  return (
    <>
      <PageHeader title="Things" description="What this page is for." />
      <Card>
        <CardHeader title="All things" />
        {things.length ? <ul>{/* ... */}</ul> : null}
      </Card>
      {can(actor, "thing.do") ? <ThingActions /> : null}
    </>
  );
}
```

Notes:

- `PageProps<"/route">` / `RouteContext<"/route">` are global Next 16 typegen helpers — do not
  import them. They exist after `next dev`, `next build`, or `next typegen`.
- The app uses `middleware.ts`'s successor, `src/proxy.ts` (Next 16 renamed the convention).
- `cacheComponents` is `false` in `next.config.ts`. Do not add `use cache`; do not rely on static
  rendering for authenticated pages.

---

## 5. UI vocabulary

Tokens are defined in the Tailwind/theme layer and used by name, not by raw colour:

`bg-brand-700`, `bg-brand-800`, `border-line`, `bg-panel`, `bg-surface`, `text-ink`,
`shadow-[var(--shadow-card)]`, `rounded-xl`.

`src/components/ui/primitives.tsx` exports:

`buttonClass(variant, size)` with `variant: primary | secondary | danger | ghost` and
`size: sm | md`; `Button`; `Card`; `CardHeader({ title, description, action })`; `Badge`
(`tone`); `Label`/`labelClass`; `Input`; `Textarea`; `Select`; `Field`; `DataTable` +
`Column`; `Skeleton`; `EmptyState`; `Banner`; `ErrorState`; `ScoreBar`; `PageHeader`
(`actions`).

Rules that the components encode and reviewers enforce:

- Status is never colour alone — icon **and** text. Use `status.tsx` badges
  (`TaskStatusBadge`, `GoalStatusBadge`, `PhaseBadge`, `SubmissionBadge`, `ComplianceBadge`).
- Scores and percentages are rendered through `ScoreText`, `formatPercent`, `formatFraction`.
  Stored values keep full precision; display rounds to 1 decimal (`PERCENT_DECIMALS`).
- Dates in the UI go through `wat` / `watDate` (Africa/Lagos), never raw `toLocaleString()`.
- Week labels go through `formatWeekRange` (`src/lib/domain/week-label.ts`).
- Tables use `DataTable` with a `caption` for screen readers.
- Destructive actions use `ConfirmButton` or `Modal`; long flows use `StepForm`; side panels use
  `Drawer`; transient feedback uses `toast`.
- Server time is displayed via `ClockProvider` + `Countdown` so client countdowns follow the
  server clock, including the dev time override.

---

## 6. Invariants the code enforces (do not work around)

1. **Identity is verified server-side** from `auth.getUser()`; claims and request fields are never
   trusted (ADR-035).
2. **Mutations run as service role inside a security-definer function** that re-checks
   permission, BU scope, and lifecycle state. There is no path where the client decides.
3. **Roles and permissions are rows.** Adding one is a migration, not a TypeScript union.
4. **Function grants are locked down** at the end of each migration; a new RPC is unreachable from
   the browser by design.
5. **Time is `app_now()`.** Tests move it with `setNow` / `app.test_now`; any `now()` in business
   logic is a bug that only appears in time-travel tests.
6. **Locks are Tuesday 18:00 WAT and the following Tuesday 11:00 WAT** (`domain/time.ts`,
   `report_phase()`). Content lock allows only `UNDEFINED → DONE|NOT_DONE`; final lock converts
   leftovers to `NOT_DONE`.
7. **Quarterly score is a fixed-denominator mean** over eligible weeks; `ORGANIZATION_HOLIDAY`
   weeks leave the denominator and suppress missing-report penalties.
8. **Two-person control** where specified: requester cannot decide their own request, and the DB
   raises a stable code rather than trusting the UI to hide the button.
9. **Idempotency is replay-first**; the same key with a different payload is a 409, not a second
   side effect.
10. **Audit is written in the same transaction** as the change and is immutable. Corrections are
    new records, never updates.
11. **History is append-only**: strategy versions, ledger entries (reversals instead of edits),
    submitted reports, attendance rosters (amendments instead of edits).
12. **Errors are stable codes**, mapped in `src/lib/domain/errors.ts`. A new code must be added to
    that map or it surfaces as a generic failure.
13. **No floating-point money.** NGN amounts are exact numerics / `Decimal`.
14. **No server actions, no second data layer.** All writes go through `/api/v1/*`.
15. **Unknown request keys are rejected.** Add fields to the Zod schema deliberately.

---

## 7. Known specification ↔ code divergences

These are recorded so that future work does not treat either side as silently correct. None of
them were changed at baseline.

| # | Divergence | Reality |
|---|---|---|
| 1 | `13-UI-UX-SPEC.md:238` cites `/dashboard/admin`, `/dashboard/executive`, `/dashboard/finance/ledger`, `/dashboard/admin/users-bus`, `/settings/security` | Actual routes are `/admin`, `/dashboard`, `/finance/ledger`, `/admin/people`, `/account/security` |
| 2 | `13-UI-UX-SPEC.md` references `src/utils/toast.ts` | No such file; toasts come from `src/components/ui/client.tsx` |
| 3 | `12-API-CONTRACT.md` lists `POST /governance-sessions/{id}/cancel` | No `CANCELLED` state exists and no such route exists |
| 4 | `12-API-CONTRACT.md` omits several implemented endpoint families | Auth password/MFA, and numerous governance, finance, and import endpoints are implemented but undocumented |
| 5 | `src/lib/auth/permissions.ts` does not exist | Permission logic lives in `actor.ts` and in the database, by design |

Open questions carried forward (not resolved here):

- Treatment of a `SUBMITTED` but unreviewed report at quarter finalisation
  (`00-SOURCE-OF-TRUTH.md:89`, `07-SCORING-ENGINE.md` §6).
- Whether the quarterly denominator counts generated-but-future weeks
  (`07-SCORING-ENGINE.md:100` vs the code's eligible-week set).
- `docs/skills/skills/` is an accidental duplicate tree and is a cleanup candidate.

---

## 8. Testing map

| Command | Scope | Preconditions |
|---|---|---|
| `npm run test:unit` | `src/**/*.test.ts` | none |
| `npm run test:db` | `tests/db` | **destructive**: runs `supabase db reset` first |
| `npm run test:api` | `tests/api` | dev server + seeded DB (`API_BASE` to target another) |
| `npm run test:concurrency` | `tests/concurrency` | **destructive and committing**; reset DB first |
| `npm run test:e2e` | `tests/e2e` | Playwright browsers; server auto-start unless `E2E_NO_SERVER` |
| `npm run typecheck` / `npm run lint` | whole repo | none |

Harness facts (`tests/db/helpers.ts`):

- `DB_URL` defaults to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- `withTx()` starts a transaction and always rolls back; nothing leaks between tests.
- `ctx` exposes `client`, `q`, `rpc`, `setNow`, `expectError`, `asUser`, `org`, `bu`, `user`.
- `ctx.org` auto-creates `4CORE Test` / `TEST` when the database is empty.
- `setNow` is the only way to test lock boundaries; the SQL side reads `app.test_now`.

For a change to be done, the matching lane must exist and pass, plus `typecheck` and `lint`.

Lint baseline: 0 errors, 9 warnings (unused locals, one `exhaustive-deps` in `shell.tsx`). Treat
those warnings as pre-existing, not as something your change introduced.

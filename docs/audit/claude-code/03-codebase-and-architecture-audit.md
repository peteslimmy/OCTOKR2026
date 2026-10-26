# 03 — Codebase and architecture audit

Method: source inspection of the API layer, auth, evidence, data access, shared UI primitives; automated checks (typecheck, lint, 220 unit tests).

## Strengths (evidence)
- **Single enforcement point for rules:** permissions, locks, state transitions and audit live in database functions; routes are thin. `src/lib/api/handler.ts` centralises authentication, step-up, validation, same-origin checks, error mapping and metrics for 165 of 169 routes.
- **Typecheck clean**, strict mode; **220 unit tests pass**.
- **Defensive details:** constant-time secret comparison (`jobs-secret.ts`, now `/api/metrics`), keyed OTP hashing, pinned `search_path` on all 229 definer functions, standard error envelope with correlation ids, nonce-based CSP.

## Weaknesses
1. **Two database clients with unequal safety (F-002).** `adminClient()` is used in 16 routes. Using it for *reads that decide access* defeats RLS. Recommend a lint rule or code-review checklist: the service role may only act *after* an authorisation decision made with the caller's session or a definer function. Systemic: the same shortcut appeared twice in the evidence code.
2. **Competing sources of truth:** scoring in TS and SQL (F-021, mitigated by tests); evidence access in a route role-list vs RLS (fixed); CSP in two places (F-014); rate limiter in two places (F-013).
3. **Shared-module churn without safety net (F-004, F-006).** A merge of two UI primitive files added `"use client"` to a module that server pages rely on and crashed a core page; no automated check caught it. Cause: no page-render smoke test on every change and a red lint gate that was ignored (F-005).
4. **Inconsistent error handling in new code:** several new routes `throw new Error("CODE: message")` (evidence list/upload/delete) instead of `fail(code, status, message)`; `kr-execution` hand-builds responses (F-017). Mixed conventions make error codes and statuses unpredictable.
5. **Large untracked/uncommitted surface:** 103 changed files and ~35 untracked paths are not in version control (nine commits total). Review history is impossible and loss of the working directory would lose the work. Recommend committing in logical slices (owner has asked that nothing be pushed yet; local commits are a separate matter).
6. **Dead and stray code:** root `lib/`, three untracked scripts (`direct-strategy-seed`, `populate-strategy-2025-2026`, `test-metrics-endpoint`), root `MEMORY.md`, `IMPLEMENTATION_COMPLETE.md`.
7. **`src/components/ui/index.ts` re-exports `Select` from `./select` while `primitives` also exports a different `Select`** (and aliases `RadixSelect`): two different components with one name. The explicit `export { Select } from "./select"` wins over `export *`, so importing `Select` from `@/components/ui` gives the Radix one while importing it from `@/components/ui/primitives` gives the native one; a reader cannot tell which a page gets without checking its import path. TypeScript is satisfied either way.
8. **Hard-coded values:** none found that fake data; sample organisation data is isolated in `scripts/data` and the dev seed. The role-name list in the old evidence route was a hard-coded permission model (removed).

## Lint
`eslint .`: 9 errors (8 `no-explicit-any` in `src/components/ui/table.tsx`, 1 `no-require-imports` in `handler.ts`), 41 warnings (mostly unused variables/imports, indicating abandoned code). See F-005.

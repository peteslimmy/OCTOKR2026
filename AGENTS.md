# 4CORE-OKR AI Engineering Contract

## Mission

You are the implementation AI for 4CORE-OKR. Operate as a coordinated team of Principal Engineer, Product Engineer, Solution Architect, Database Architect/DBA, Backend Engineer, Frontend Engineer, UI/UX Engineer, Security Engineer, DevOps Engineer, QA Engineer, Performance Engineer, Reliability Engineer, API Architect, RBAC specialist, and technical writer.

Your job is to produce a production-grade enterprise application, not a demo.

## Mandatory reading order

Before changing code, read:

1. `docs/00-SOURCE-OF-TRUTH.md`
2. `docs/04-BUSINESS-RULES.md`
3. `docs/06-ROLES-PERMISSIONS.md`
4. `docs/07-SCORING-ENGINE.md`
5. `docs/08-STATE-MACHINES.md`
6. `docs/10-DATABASE-SPEC.md`
7. `docs/11-RLS-SECURITY.md`
8. `docs/12-API-CONTRACT.md`
9. `docs/13-UI-UX-SPEC.md`
10. `docs/20-ACCEPTANCE-CRITERIA.md`

Read additional domain documents relevant to the task.

## Operating rules

- Audit before redesigning or deleting.
- Do not silently invent business rules.
- Do not treat current application behaviour as authoritative when it conflicts with the specification.
- Do not reintroduce explicitly superseded legacy behaviour.
- Do not use hardcoded production business data.
- Do not ship fake/mock values as production functionality.
- Do not create generic unrestricted CRUD for high-risk business operations.
- Do not bypass RBAC, BU scope, lifecycle rules, RLS, audit, or transaction rules.
- Do not make the frontend the source of truth for permissions, locks, scores, or balances.
- Do not write business-critical logic directly inside presentation components.
- Every critical business rule must have automated tests.
- Every high-risk state transition must be auditable.
- Financial operations must be atomic.
- Historical audit and financial records must remain immutable.

## Coding conventions

- TypeScript/JavaScript: `camelCase`.
- PostgreSQL: `snake_case`.
- Prefer explicit domain services/policies over hidden side effects.
- Prefer small, testable functions.
- Prefer typed DTOs and explicit allowlists over mass assignment.
- Use parameterized queries.
- Validate at API and domain boundaries.
- Keep modules separated by domain.
- Avoid N+1 queries.
- Use exact monetary types; never use binary floating point as authoritative money storage.

## Change protocol

Before implementation:

1. Inspect impacted files.
2. Identify dependencies.
3. Identify applicable business rules and acceptance criteria.
4. Identify database/API/security/UI impact.
5. State any genuine ambiguity in the implementation notes rather than inventing a rule.

After implementation:

1. Run targeted tests.
2. Run impacted integration tests.
3. Run lint/type checks.
4. Run security tests where applicable.
5. Update the relevant `.md` specification if behaviour changes.
6. Record an ADR in `docs/24-DECISIONS.md` for material architectural decisions.

## Definition of done

A feature is not done because the screen renders. It is done only when:

- business rule implemented;
- authorization implemented;
- database constraints/RLS implemented where applicable;
- error behaviour implemented;
- audit implemented where applicable;
- tests implemented;
- responsive UX implemented;
- accessibility considered;
- observability implemented for important operations.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

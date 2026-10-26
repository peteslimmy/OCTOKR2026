# 07 — API, backend and integrations

Method: a script parsed all 169 `route.ts` files (methods, `api()` options, Zod body, RPC names, client usage); targeted reading of the highest-risk routes; unauthenticated probes of three routes.

## Coverage
| Measure | Value |
|---|---|
| Routes | 169 (165 use `api()`) |
| Public (no sign-in) | 2: `auth/login`, `auth/password/forgot` |
| Require recent second factor (`stepUp`) | 39 |
| With a Zod body schema | 92 |
| Use service-role client | 16 |
| Not using `api()` | `/api/health`, `/api/internal/health`, `/api/internal/jobs/run`, `/api/metrics` (own secret/token checks) |
| Mutating routes with neither a body schema nor a direct RPC | 6: `auth/mfa/enroll`, `imports/[entity]/{parse,validate,commit}`, `notifications/[id]/read`, `sign-in-imports` (the import routes take multipart files; validated inside; not reviewed line by line) |

## Reviewed in detail
- **Login** (`auth/login`): per-IP and per-account limits, generic failure message (anti-enumeration), lockout check, active-status check, MFA level handling. Sound apart from F-011.
- **Users** (`users`, `[id]/delete`, `bulk-delete`, `mfa-reset`): create validates roles in the database and rolls back the identity on failure; MFA reset is authorised and audited before factors are removed and sessions revoked. Gaps in delete: F-007.
- **Evidence** (4 routes): F-002, F-003, F-008. `evidence/[id]/delete` delegates to `ops_delete_evidence_file` (permission + audit) and soft-deletes only; file bytes remain by design.
- **Quotes** (`quotes`, `quotes/[id]/{submit,approve,publish,archive}`, `reporting-weeks/[id]/quote`): rebuilt this session on `api()` + definer functions (F-009).
- **Reports `kr-execution`:** F-017.
- **Metrics/health/jobs:** metrics token required in production; job runner uses a rotating shared secret compared in constant time; `/api/internal/health` returns 401 without it (observed).

## Probes (unauthenticated, local)
`/api/v1/evidence/download`, `/api/v1/evidence/{id}`, `/api/v1/quotes` → 401 each. `/api/internal/health` → 401. `/api/metrics` → open in development by design.

## Contract and consistency issues
- Error handling is mixed: most routes use `fail(code, status, message)`, some use `throw new Error("CODE: message")` and `new Response(JSON.stringify(...))`. Clients that read `error.code` get inconsistent results (F-017).
- Responses are wrapped `{ data: … }` by the handler; the Sub-KR card ignored that and could never render (fixed).
- `docs/12-API-CONTRACT.md` is updated for review/rejection and quotes; other routes were not compared to the contract line by line (outstanding).

## Integrations
Email transport, webhooks outbox, integration secrets (encrypted, re-wrap script) and SSRF protection (`lib/integrations/ssrf.ts`) exist. **Not verified against any real external service**; tests use local substitutes (`.dev-mail`, in-process). Webhook signing/replay protection was not reviewed in detail.

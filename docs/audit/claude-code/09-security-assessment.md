# 09 — Security assessment

**Scope and method:** source review of authentication, API handler, evidence, headers, secrets handling and database privileges; live read-only database queries; unauthenticated route probes; response-header inspection; `npm audit`. **No exploitation tests**, no authorisation matrix across roles (only a Super Admin session existed), no fuzzing, no dependency scan beyond `npm audit`, no secret scan beyond reading. A "not found" here is not a clean bill.

## Verified positives
- **Authentication:** password + mandatory second factor for privileged roles (authenticator or emailed code), lockout, generic failure messages, recovery codes, MFA reset by an authorised administrator with audit and session revocation (source; sign-in and enrolment page observed).
- **Emailed codes:** `randomInt` 6 digits, HMAC-SHA256 with a server pepper bound to user and purpose and stored hashed only; 10-minute expiry; 5 attempts; one live challenge per session and purpose; consumed on use.
- **Authorisation model:** deny by default. Users hold no write privilege on any table; mutations go through definer functions that call `require_permission`; 229 definer functions all pin `search_path`; anonymous users cannot call any function.
- **Headers (observed):** nonce-based CSP with `strict-dynamic`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy, COOP; HSTS in production (source). `poweredByHeader` disabled.
- **CSRF:** same-origin check on mutating calls plus `SameSite=Lax` cookies.
- **Secrets:** shared job secret compared in constant time with rotation; integration secrets stored encrypted with a re-wrap script; `.env.local` ignored by git (the CI has a secret-scan step). No secret was read into these reports.
- **Separation of duties** for money, strategy, config, ledger reversal, session correction and quotes is enforced in the database, not the UI.

## Findings (see report 13 for detail)
| ID | Sev | Summary |
|---|---|---|
| F-002 | HIGH | Evidence downloads used the service role and ignored RLS; a role-name list contradicted the policy. Remediated; no role-based test yet |
| F-003 | MEDIUM | Upload wrote storage before authorising |
| F-008 | MEDIUM | Evidence MIME type taken from the client; no content check or scanning |
| F-007 | MEDIUM | User deletion unaudited reason; identity-deletion failures swallowed |
| F-011 | LOW | Per-IP login limit keyed on `x-forwarded-for` as received |
| F-012 | LOW | Eight tables lack RLS (no grants, so unreachable today) |
| F-015 | LOW | `read_payment_is_reversed` definer with no caller check |
| F-010 | LOW | Scripts that write strategy through the service role, bypassing the quarter lock |
| F-016 | LOW | Moderate advisories in `nodemailer` and `uuid`(via `exceljs`) |
| F-014 | LOW | Dead weak CSP in `next.config.ts` (not sent) |

## Unverified (needs a test account per role and a controlled environment)
Horizontal/vertical privilege escalation by role; BU-scoped isolation (BU Lead A reading BU B); object-level access on every `[id]` route; webhook signing and replay; SSRF filter bypasses; import-file parsing limits (zip/CSV/XLSX bombs, formula injection in exports); rate limits on every auth route; storage-bucket policy behaviour with real files; session fixation/expiry; log content (secrets or personal data in logs/errors).

## Notes on residual risk
- The Super Admin account used for the audit authenticated successfully only after the owner enrolled a second factor; there is no way around it in the flows read.
- The password for that account was supplied in chat for local testing; it should be changed (and the chat treated as containing it).

## Second pass (2026-10-26): authorisation tested over HTTP
Tested on the built application against the seeded test stack with real sign-in and second factors for 8 roles. Results: every route refuses an anonymous caller; no role can crash any route with a blind request; evidence access by role follows the database policy (10 tests) after F-025 was fixed; read routes return only what each role may see (4 tests). New high-severity finding **F-025** (evidence list disclosed every entity's files to any signed-in user) and medium findings F-026 to F-028. **Still unverified:** valid-body mutation authorisation per role over HTTP, horizontal access between two BU Leads of different units (the seed has one), webhook signing, SSRF filter bypasses, file-import parsers, log content, session expiry.

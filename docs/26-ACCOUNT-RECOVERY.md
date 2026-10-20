# Account recovery and break-glass

Owner decision 7 (14 October 2026), implemented as ADR-060. This page says who can do what when someone loses their authenticator, and what to do when no one can sign in.

## Principles

- Recovery never skips the second factor silently. Every route ends with the person setting up a **new** authenticator, every other session of that account ended, and an audit entry and an alert.
- A recovery code or an administrator reset removes the authenticator. It never lets the person into the application at the second-factor level without one.
- Every route is audited, and the account's owner is notified.

## Routes, from the most to the least routine

| Route | Who | What it does | Audit action |
|---|---|---|---|
| **Recovery code** | The person, signed in with their password | Spends one of ten one-time codes, removes the authenticator, ends all other sessions, sends the person to set up a new authenticator (which issues a new set of codes). | `AUTH_RECOVERY_CODE_USED`, `AUTH_MFA_RECOVERED` |
| **Administrator reset** | A holder of `users.manage` (only a Super Admin may reset a Super Admin), with a reason and a fresh authenticator check | Removes the authenticator, revokes unused recovery codes, ends all sessions of that account. | `AUTH_MFA_RESET_BY_ADMIN` |
| **Break-glass** | An operator with server access, when no Super Admin can sign in | Same effect as an administrator reset, run from the server with an operator name and a written reason (at least 10 characters). | `AUTH_BREAK_GLASS_MFA_RESET`, plus an alert to every Super Admin |

## Recovery codes

- Ten codes of the form `ABCD-EFGH-JKMN` (12 characters, 60 bits each, no look-alike letters) are shown **once**, right after an authenticator is activated, and again whenever the person chooses **Make new recovery codes** (which asks for a fresh authenticator code and cancels the old set).
- Only a keyed hash is stored (HMAC-SHA256 with the server secret, bound to the user). A browser session can never read the table.
- A wrong code counts toward the same lockout as a wrong password (5 failures, 15 minutes) and is rate-limited (5 attempts in 10 minutes).
- Each code works once. After a recovery, every unused code is cancelled because it belonged to the removed authenticator.

## Break-glass procedure

Use only when **no** Super Admin can sign in and no recovery code is left. Two people should be present: the operator and a witness (for example the owner).

1. Confirm the identity of the person whose authenticator is being reset, by a method that does not depend on the application (in person or a known phone number).
2. On the server, with the production environment variables loaded:

   ```bash
   npm run break-glass:mfa-reset -- --email super@your-org.example --operator "Operator name, role" --reason "Both Super Admins lost their devices on 3 Nov" --confirm super@your-org.example
   ```

3. The script removes the authenticator, cancels unused recovery codes, ends every session of the account, and records the operator and the reason in the audit log. Every Super Admin is alerted.
4. The person signs in with their password, sets up a new authenticator and **saves the new recovery codes**.
5. The witness and operator record the date, reason and outcome in the organisation's own incident log.

The script needs `SUPABASE_SERVICE_ROLE_KEY`; it is not reachable from the application and no web route performs it.

## Keeping two Super Admins

The Administration screen warns when fewer than two active Super Admins exist. With two, one can always reset the other through the application, and break-glass is a last resort rather than a routine.

## Not decided here

How long to keep the operator's incident log, where the witnessed record is stored, and who the second Super Admin is are organisational decisions (docs/25-IMPLEMENTATION-NOTES.md).

import { existsSync, readFileSync } from "node:fs";
import { DEV_MFA_FILE, totp } from "../../scripts/totp";

type Requester = { request: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: { data?: unknown } }> };

/**
 * Finishes a sign-in for the seeded elevated users (SUPER_ADMIN, ADMIN, FINANCE), whose password alone gives an incomplete session.
 * The code of the current 30 s window may already have been used by an earlier login, so neighbouring windows are tried as well.
 */
export async function completeMfa(s: Requester, email: string, login: { json: { data?: unknown } }) {
  const data = login.json.data as { mfaRequired?: boolean } | undefined;
  if (!data?.mfaRequired) return;
  if (!existsSync(DEV_MFA_FILE)) throw new Error(`${email} needs an authenticator code: run npm run dev:seed first`);
  const secret = (JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) as Record<string, string>)[email];
  if (!secret) throw new Error(`no authenticator secret for ${email}`);
  for (const offset of [0, 30_000, -30_000, 60_000]) {
    const r = await s.request("POST", "/api/v1/auth/mfa/verify", { code: totp(secret, Date.now() + offset) });
    if (r.status === 200) return;
    if (r.status !== 401) throw new Error(`mfa verify for ${email} returned ${r.status}`);
  }
  throw new Error(`could not complete MFA for ${email}`);
}

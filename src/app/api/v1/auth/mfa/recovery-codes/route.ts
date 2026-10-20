import { api, fail } from "@/lib/api/handler";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/auth/recovery";
import { rateLimited } from "@/lib/auth/rate-limit";

/** Replaces the caller's unused recovery codes with a new set, shown once. Needs a fresh authenticator code (step-up); the old codes stop working. */
export const POST = api({ stepUp: true }, async ({ actor, rpc }) => {
  if (await rateLimited(`mfa:codes:${actor.id}`, 5, 600_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait and try again.");
  if (!actor.mfa.enrolled) throw fail("MFA_NOT_ENROLLED", 409, "Set up an authenticator first; recovery codes belong to it.");
  const codes = generateRecoveryCodes();
  await rpc("issue_recovery_codes", { p_user: actor.id, p_hashes: codes.map((c) => hashRecoveryCode(actor.id, c)) });
  return { recoveryCodes: codes };
});

import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { userClient } from "@/lib/supabase/server";

/**
 * Removes the caller's authenticator. Refused while it is the only second factor their role allows; requires a fresh code.
 */
export const POST = api({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }, async ({ actor, body, rpc }) => {
  if (actor.mfa.required && !actor.mfa.email) {
    throw fail("MFA_REQUIRED_BY_ROLE", 403, "Your role requires a second factor, so this authenticator cannot be removed. Set up email codes first, or ask an administrator.");
  }
  if (await rateLimited(`mfa:verify:${actor.id}`, 10, 60_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait a minute and try again.");
  const sb = await userClient();
  const { data: list } = await sb.auth.mfa.listFactors();
  const factor = list?.totp?.[0];
  if (!factor) throw fail("MFA_NOT_ENROLLED", 409, "No authenticator is set up for this account.");
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: body.code });
  if (error) {
    await rpc("record_mfa_failure", { p_user: actor.id });
    throw fail("AUTHENTICATION_FAILED", 401, "That code is not valid.");
  }
  for (const f of list?.all ?? []) await sb.auth.mfa.unenroll({ factorId: f.id });
  await rpc("revoke_recovery_codes", { p_user: actor.id });
  await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_DISABLED" });
  return { ok: true };
});
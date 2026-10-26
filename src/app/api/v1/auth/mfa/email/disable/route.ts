import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { consumeEmailCode, looksLikeEmailCode } from "@/lib/auth/email-otp";
import { rateLimited } from "@/lib/auth/rate-limit";

/**
 * Turns email codes off. Refused while they are the only second factor the caller's role accepts; a fresh mailed code confirms
 * the request. The database removes the factor, its live verifications and any open challenges, and writes the audit event.
 */
export const POST = api({ body: z.object({ code: z.string().trim().min(6).max(12) }) }, async ({ actor, body, rpc }) => {
  if (!actor.mfa.email) throw fail("MFA_NOT_ENROLLED", 409, "Email codes are not turned on for this account.");
  if (actor.mfa.required && !actor.mfa.totp) {
    throw fail("MFA_REQUIRED_BY_ROLE", 403, "Your role requires a second factor. Set up an authenticator app before removing email codes.");
  }
  if (await rateLimited(`mfa-email-verify:${actor.id}`, 10, 60_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait a minute and try again.");
  if (await rpc<boolean>("user_is_locked", { p_user: actor.id })) throw fail("AUTHENTICATION_FAILED", 401, "That code is not valid.");
  if (!looksLikeEmailCode(body.code)) throw fail("AUTHENTICATION_FAILED", 401, "That code is not valid.");

  const status = await consumeEmailCode(actor.id, "STEP_UP", body.code);
  if (status === "EXPIRED") throw fail("CODE_EXPIRED", 401, "That code has expired. Request a new one.");
  if (status === "TOO_MANY") throw fail("RATE_LIMITED", 429, "Too many attempts. Request a new code.");
  if (status !== "OK") throw fail("AUTHENTICATION_FAILED", 401, "That code is not valid.");

  await rpc("disable_email_mfa", { p_user: actor.id });
  return { ok: true };
});
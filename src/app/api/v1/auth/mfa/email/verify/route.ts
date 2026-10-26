import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { consumeEmailCode, looksLikeEmailCode } from "@/lib/auth/email-otp";
import { rateLimited } from "@/lib/auth/rate-limit";

const INVALID = "That code is not valid.";

/**
 * Checks a mailed code. One endpoint serves the three moments the code is used: turning the factor on, finishing a sign-in,
 * and step-up before a high-risk action. A wrong code counts toward the account lockout, exactly like a wrong authenticator code.
 */
export const POST = api(
  { partial: true, body: z.object({ code: z.string().trim().min(6).max(12), purpose: z.enum(["LOGIN", "STEP_UP", "ENROL"]) }) },
  async ({ actor, body, rpc }) => {
    if (await rateLimited(`mfa:email:verify:${actor.id}`, 10, 60_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait a minute and try again.");
    if (await rpc<boolean>("user_is_locked", { p_user: actor.id })) throw fail("AUTHENTICATION_FAILED", 401, INVALID);
    if (!looksLikeEmailCode(body.code)) throw fail("AUTHENTICATION_FAILED", 401, INVALID);

    const status = await consumeEmailCode(actor.id, body.purpose, body.code);
    if (status === "EXPIRED") throw fail("CODE_EXPIRED", 401, "That code has expired. Request a new one.");
    if (status === "TOO_MANY") throw fail("RATE_LIMITED", 429, "Too many attempts. Request a new code.");
    if (status !== "OK") throw fail("AUTHENTICATION_FAILED", 401, INVALID);

    if (body.purpose === "ENROL") {
      await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_ENROLLED", p_details: { method: "email" } });
      return { ok: true, enrolled: true };
    }
    if (body.purpose === "LOGIN") {
      await rpc("record_login_success", { p_user: actor.id });
      await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_VERIFIED", p_details: { method: "email" } });
    } else {
      await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_STEP_UP", p_details: { method: "email" } });
    }
    return { ok: true };
  },
);

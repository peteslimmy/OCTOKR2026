import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/auth/recovery";
import { userClient } from "@/lib/supabase/server";

/**
 * Verifies a 6-digit TOTP code. One endpoint serves the three moments it is needed:
 * finishing enrolment (factor not yet verified), completing a sign-in (session is AAL1), and step-up before a high-risk action.
 * Wrong codes count toward the account lockout.
 */
export const POST = api(
  { partial: true, body: z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"), factorId: z.string().uuid().optional() }) },
  async ({ actor, body, rpc }) => {
    if (await rateLimited(`mfa:verify:${actor.id}`, 10, 60_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait a minute and try again.");
    if (await rpc<boolean>("user_is_locked", { p_user: actor.id })) throw fail("AUTHENTICATION_FAILED", 401, "That code is not valid.");
    const sb = await userClient();
    const { data: list } = await sb.auth.mfa.listFactors();
    const factor = body.factorId ? list?.all.find((f) => f.id === body.factorId) : list?.totp?.[0];
    if (!factor) throw fail("MFA_NOT_ENROLLED", 409, "No authenticator is set up for this account.");
    const enrolling = factor.status !== "verified";
    const { data: before } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const completingLogin = !enrolling && before?.currentLevel !== "aal2";

    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: body.code });
    if (error) {
      await rpc("record_mfa_failure", { p_user: actor.id });
      throw fail("AUTHENTICATION_FAILED", 401, "That code is not valid.");
    }
    let recoveryCodes: string[] | undefined;
    if (enrolling) {
      await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_ENROLLED" });
      recoveryCodes = generateRecoveryCodes();                                  // shown to the person once, now; only keyed hashes are stored
      await rpc("issue_recovery_codes", { p_user: actor.id, p_hashes: recoveryCodes.map((c) => hashRecoveryCode(actor.id, c)) });
    } else if (completingLogin) {
      await rpc("record_login_success", { p_user: actor.id });
      await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_VERIFIED" });
    } else await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_STEP_UP" });
    return { ok: true, enrolled: enrolling, recoveryCodes };
  },
);

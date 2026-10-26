import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { hashRecoveryCode, looksLikeRecoveryCode } from "@/lib/auth/recovery";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";

/**
 * Lost authenticator, recovery code in hand. Allowed for a password-only session (that is the situation). A valid unused code is spent,
 * the authenticator is removed, every OTHER session is ended and the person is sent to set up a new authenticator. The code never
 * grants the second-factor level by itself. A wrong code counts toward the account lockout, like a wrong authenticator code.
 */
export const POST = api({ partial: true, body: z.object({ code: z.string().trim().min(8).max(40) }) }, async ({ actor, body, rpc, correlationId }) => {
  if (await rateLimited(`mfa:recover:${actor.id}`, 5, 600_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait and try again.");
  if (!actor.mfa.totp) throw fail("MFA_NOT_ENROLLED", 409, "No authenticator is set up for this account.");
  const invalid = fail("AUTHENTICATION_FAILED", 401, "That recovery code is not valid.");
  if (!looksLikeRecoveryCode(body.code)) { await rpc("record_mfa_failure", { p_user: actor.id }); throw invalid; }
  const ok = await rpc<boolean>("consume_recovery_code", { p_user: actor.id, p_hash: hashRecoveryCode(actor.id, body.code) });
  if (!ok) throw invalid;

  const admin = adminClient(correlationId);
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: actor.id });
  if (error) throw fail("MFA_RECOVERY_FAILED", 502, "Recovery could not be completed. Your code was used; ask an administrator to reset your authenticator.");
  for (const f of data?.factors ?? []) {
    const r = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: actor.id });
    if (r.error) throw fail("MFA_RECOVERY_FAILED", 502, "Recovery could not be completed. Your code was used; ask an administrator to reset your authenticator.");
  }
  await rpc("revoke_recovery_codes", { p_user: actor.id });
  const sb = await userClient();
  const { data: claims } = await sb.auth.getClaims();
  const keep = (claims?.claims as { session_id?: string } | undefined)?.session_id ?? null;
  const ended = await rpc<number>("revoke_user_sessions", { p_user: actor.id, p_keep: keep });
  await rpc("record_mfa_event", { p_user: actor.id, p_action: "AUTH_MFA_RECOVERED", p_details: { other_sessions_ended: ended } });
  return { ok: true, mfaEnrolmentRequired: actor.mfa.required };
});

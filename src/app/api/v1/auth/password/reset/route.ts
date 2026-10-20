import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { rateLimited } from "@/lib/auth/rate-limit";
import { checkPassword, describeIssues } from "@/lib/domain/password-policy";
import { userClient } from "@/lib/supabase/server";

/**
 * Sets a new password from a recovery session (created only by the emailed one-time link). An ordinary signed-in session
 * cannot use this to skip the current-password check. Users with an authenticator must pass it first. All sessions end afterwards.
 */
export const POST = api({ partial: true, body: z.object({ password: z.string().min(1).max(200) }) }, async ({ actor, body, rpc }) => {
  if (await rateLimited(`pwd:reset:${actor.id}`, 5, 15 * 60_000)) throw fail("RATE_LIMITED", 429, "Too many attempts. Please wait and try again.");
  const sb = await userClient();
  const { data: claims } = await sb.auth.getClaims();
  const amr = (claims?.claims as { amr?: { method: string; timestamp: number }[] } | undefined)?.amr ?? [];
  const recoveredAt = Math.max(0, ...amr.filter((a) => a.method === "recovery" || a.method === "otp").map((a) => a.timestamp));
  if (!recoveredAt || Date.now() / 1000 - recoveredAt > 15 * 60) {
    throw fail("RECOVERY_REQUIRED", 403, "This reset link has expired. Request a new one.");
  }
  if (actor.mfa.enrolled && actor.mfa.aal !== "aal2") throw fail("MFA_REQUIRED", 401, "Enter your authenticator code to continue.");
  const issues = checkPassword(body.password, actor.email);
  if (issues.length) throw fail("PASSWORD_POLICY", 422, `Choose a stronger password: ${describeIssues(issues).join("; ")}.`, issues);
  const { error } = await sb.auth.updateUser({ password: body.password });
  if (error) throw fail("PASSWORD_POLICY", 422, "That password was not accepted. Choose a different, stronger one.");
  await rpc("record_password_changed", { p_user: actor.id, p_kind: "RESET" });
  await sb.auth.signOut({ scope: "global" });
  return { ok: true };
});

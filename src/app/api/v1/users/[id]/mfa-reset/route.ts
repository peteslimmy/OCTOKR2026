import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";

/** Administrator-assisted recovery for a lost authenticator. Authorised and audited in the database first, then the factors are removed. */
export const POST = api({ stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, params, rpc, correlationId }) => {
  await rpc("authorise_mfa_reset", { p_actor: actor.id, p_target: params.id, p_reason: body.reason });
  const admin = adminClient(correlationId);
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: params.id });
  if (error) throw fail("MFA_RESET_FAILED", 502, "The authenticator could not be reset. Try again.");
  for (const f of data?.factors ?? []) {
    const r = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: params.id });
    if (r.error) throw fail("MFA_RESET_FAILED", 502, "The authenticator could not be reset. Try again.");
  }
  await rpc("revoke_recovery_codes", { p_user: params.id });
  const ended = await rpc<number>("revoke_user_sessions", { p_user: params.id, p_keep: null });   // the old authenticator's sessions must not outlive it
  return { ok: true, removed: data?.factors?.length ?? 0, sessionsEnded: ended };
});

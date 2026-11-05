import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Rolls back a sign-in import inside the rollback window (ADR-088). The database first checks that every account is unused (never signed in, never acted, roles
 * unchanged) and refuses the whole rollback if not; then each account is removed through the ordinary delete-user function and its sign-in identity is deleted here
 * (that needs the service role); finally the rollback is recorded. Safe to run again if it stops part-way.
 */
export const POST = api({ stepUp: true, body: z.object({ reason: z.string().min(10).max(2000), confirm: z.string().max(40) }) }, async ({ actor, body, params, rpc, correlationId }) => {
  requirePerm(actor, "users.manage");
  const plan = await rpc<{ userIds?: string[]; replayed?: boolean }>("sign_in_import_void_prepare", { p_actor: actor.id, p_batch: params.id, p_reason: body.reason, p_confirm: body.confirm });
  if (plan.replayed) return plan;
  const admin = adminClient(correlationId);
  let removed = 0;
  for (const id of plan.userIds ?? []) {
    await rpc("delete_user", { p_actor: actor.id, p_user: id, p_reason: `Sign-in import rolled back: ${body.reason}`.slice(0, 2000) });
    await admin.auth.admin.deleteUser(id);
    removed += 1;
  }
  return rpc("sign_in_import_void_finish", { p_actor: actor.id, p_batch: params.id, p_reason: body.reason, p_confirm: body.confirm, p_removed: removed });
});

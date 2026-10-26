import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Delete a single user (requires users.manage and a recent second factor). The reason is mandatory and is kept on the audit entry.
 * The application user is deleted first (the database refuses the last Super Admin and your own account); then the sign-in identity.
 * If the identity cannot be removed the person can no longer use the application, so the call says so instead of reporting success.
 */
export const DELETE = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(2000) }) },
  async ({ actor, body, params, rpc, correlationId }) => {
    await rpc("delete_user", { p_actor: actor.id, p_user: params.id, p_reason: body.reason });
    const { error } = await adminClient(correlationId).auth.admin.deleteUser(params.id);
    if (error) {
      console.error("[users] identity deletion failed after the application user was deleted:", params.id, error.message);
      throw fail("IDENTITY_DELETE_FAILED", 502, "The user was deleted from the application, but their sign-in identity could not be removed. Ask an administrator to remove it.");
    }
    return { success: true };
  },
);

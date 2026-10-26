import { z } from "zod";
import { api } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Bulk delete users (requires users.manage and a recent second factor). Each id is processed on its own; the result lists every success
 * and failure. The reason is mandatory and is kept on each user's audit entry. A user whose application record was deleted but whose
 * sign-in identity could not be removed is reported as a failure with that explanation, never as a clean success.
 */
export const POST = api(
  { stepUp: true, body: z.object({ ids: z.array(z.string().uuid()).min(1).max(100), reason: z.string().trim().min(1).max(2000) }) },
  async ({ actor, body, rpc }) => {
    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of body.ids) {
      try {
        if (id === actor.id) {
          results.push({ id, success: false, error: "Cannot delete your own account." });
          continue;
        }
        await rpc("delete_user", { p_actor: actor.id, p_user: id, p_reason: body.reason });
        const { error } = await adminClient("bulk-delete-user-" + id).auth.admin.deleteUser(id);
        if (error) {
          console.error("[users] identity deletion failed after the application user was deleted:", id, error.message);
          results.push({ id, success: false, error: "Deleted from the application, but the sign-in identity could not be removed. Ask an administrator to remove it." });
          continue;
        }
        results.push({ id, success: true });
      } catch (e) {
        const err = e as { code?: string; message?: string; detail?: string };
        results.push({ id, success: false, error: err.detail || err.message || "Delete failed" });
      }
    }
    return { results };
  },
);

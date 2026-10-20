import { api } from "@/lib/api/handler";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Bulk delete users.
 * Requires users.manage permission and step-up MFA.
 * Processes each ID individually; returns successes and failures.
 */
export const POST = api({ stepUp: true, body: z.object({ ids: z.array(z.string().uuid()).min(1).max(100), reason: z.string().trim().min(1).max(2000).optional() }) }, async ({ actor, body, rpc }) => {
  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const id of body.ids) {
    try {
      // Skip if trying to delete self
      if (id === actor.id) {
        results.push({ id, success: false, error: "Cannot delete your own account." });
        continue;
      }

      await rpc("delete_user", { p_actor: actor.id, p_user: id });

      // Delete auth user
      const admin = adminClient("bulk-delete-user-" + id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.error("Failed to delete auth user:", error);
      }

      results.push({ id, success: true });
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string };
      results.push({ id, success: false, error: err.detail || err.message || "Delete failed" });
    }
  }

  return { results };
});
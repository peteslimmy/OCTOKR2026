import { api } from "@/lib/api/handler";
import { z } from "zod";

/**
 * Bulk delete Business Units/Departments.
 * Requires business_units.manage permission and step-up MFA.
 * Processes each ID individually; returns successes and failures.
 */
export const POST = api({ stepUp: true, body: z.object({ ids: z.array(z.string().uuid()).min(1).max(100), reason: z.string().trim().min(1).max(2000).optional() }) }, async ({ actor, body, rpc }) => {
  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const id of body.ids) {
    try {
      await rpc("delete_business_unit", { p_actor: actor.id, p_id: id });
      results.push({ id, success: true });
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string };
      results.push({ id, success: false, error: err.detail || err.message || "Delete failed" });
    }
  }

  return { results };
});
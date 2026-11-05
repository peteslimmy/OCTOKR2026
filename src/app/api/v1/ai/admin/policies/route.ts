import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/admin/policies { action, mode } — sets what the agent may do for one kind of action. A high-impact action can never be made automatic (the database refuses). */
export const POST = api({ stepUp: true, body: z.object({ action: z.string().min(1).max(60), mode: z.enum(["AUTO", "NEEDS_APPROVAL", "DISABLED"]) }) }, async ({ actor, body, rpc }) => {
  await rpc("ai_set_policy", { p_actor: actor.id, p_action: body.action, p_mode: body.mode });
  return { action: body.action, mode: body.mode };
});

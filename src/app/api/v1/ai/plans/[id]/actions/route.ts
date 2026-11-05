import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/plans/{id}/actions { description, ownerBuId?, dueDate? } — adds an action to a corrective plan (a draft, or one in progress). */
export const POST = api({ body: z.object({ description: z.string().min(1).max(2000), ownerBuId: z.string().uuid().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }, async ({ actor, body, params, rpc }) =>
  rpc("ai_add_corrective_action", { p_actor: actor.id, p_plan: params.id, p_description: body.description, p_owner_bu: body.ownerBuId ?? null, p_due: body.dueDate ?? null }));

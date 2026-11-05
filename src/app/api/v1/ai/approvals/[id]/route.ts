import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/approvals/{id} { approve, note? } — decide something the agent or a unit proposed. Never the person who proposed it; a reason is needed to reject. */
export const POST = api({ stepUp: true, body: z.object({ approve: z.boolean(), note: z.string().max(2000).optional() }) }, async ({ actor, body, params, rpc }) =>
  ({ status: await rpc<string>("ai_decide_approval", { p_actor: actor.id, p_approval: params.id, p_approve: body.approve, p_note: body.note ?? null }) }));

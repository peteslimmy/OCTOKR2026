import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ userId: z.string().uuid(), decision: z.enum(["KEEP", "CHANGE"]), comment: z.string().trim().max(2000).optional() }) }, async ({ actor, body, params, rpc }) =>
  rpc("decide_access_review_item", { p_actor: actor.id, p_review: params.id, p_user: body.userId, p_decision: body.decision, p_comment: body.comment ?? null }));

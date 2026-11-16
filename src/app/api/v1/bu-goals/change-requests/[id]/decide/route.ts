import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Approve or reject a change request. Approval applies the change; rejection needs a reason. Nobody decides their own request. */
export const POST = api({ body: z.object({ approve: z.boolean(), reason: z.string().trim().max(2000).nullish() }) },
  async ({ actor, body, params, rpc }) => rpc("decide_bu_goal_change", { p_actor: actor.id, p_request: params.id, p_approve: body.approve, p_reason: body.reason ?? null }));

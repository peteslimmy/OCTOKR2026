import { z } from "zod";
import { api } from "@/lib/api/handler";

/** The chosen executive approves (the goal is retired in the same step) or rejects (a comment is required, the goal stays active). The Super Admin may decide too (ADR-112). */
export const POST = api(
  { stepUp: true, body: z.object({ approve: z.boolean(), comment: z.string().trim().max(2000).nullish(), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("decide_bu_goal_retirement", { p_actor: actor.id, p_request: params.id, p_approve: body.approve, p_comment: body.comment ?? null }));

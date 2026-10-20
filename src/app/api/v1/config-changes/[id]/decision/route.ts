import { z } from "zod";
import { api } from "@/lib/api/handler";
import { forgetRuntime } from "@/lib/integrations/runtime";

/** A different person approves (which applies the change in the same transaction) or rejects (a comment is required). */
export const POST = api(
  { stepUp: true, body: z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().trim().max(2000).optional(), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => { const out = await rpc("decide_config_change", { p_actor: actor.id, p_request_id: params.id, p_decision: body.decision, p_comment: body.comment ?? null, p_idempotency_key: body.idempotencyKey }); forgetRuntime(); return out; },
);

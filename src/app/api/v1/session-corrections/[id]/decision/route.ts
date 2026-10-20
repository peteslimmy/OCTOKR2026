import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Step 2: a different person approves or rejects. A rejection needs a comment. The requester can never decide. */
export const POST = api(
  { stepUp: true, body: z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().trim().max(2000).optional(), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("decide_session_correction", { p_actor: actor.id, p_request_id: params.id, p_decision: body.decision, p_comment: body.comment ?? null, p_idempotency_key: body.idempotencyKey }),
);

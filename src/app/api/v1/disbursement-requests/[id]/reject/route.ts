import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ reason: z.string().trim().max(2000), idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, params, rpc }) =>
  rpc("decide_disbursement_request", { p_actor: actor.id, p_request_id: params.id, p_approve: false, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }));

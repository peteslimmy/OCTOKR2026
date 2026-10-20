import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api(
  { stepUp: true, body: z.object({ idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, params, rpc }) =>
  rpc("decide_disbursement_request", { p_actor: actor.id, p_request_id: params.id, p_approve: true, p_reason: null, p_idempotency_key: body.idempotencyKey }));

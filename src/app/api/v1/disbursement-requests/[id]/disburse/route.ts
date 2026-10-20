import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api(
  { stepUp: true, body: z.object({ reference: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, params, rpc }) =>
  rpc("record_disbursement", { p_actor: actor.id, p_request_id: params.id, p_reference: body.reference, p_idempotency_key: body.idempotencyKey }));

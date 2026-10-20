import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Emergency override (Super Admin): request, approve and execute in one step. Full reason, fresh authenticator check, audited, alerted. */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(10).max(2000), idempotencyKey: z.string().min(8).max(100), confirm: z.literal(true) }) },
  async ({ actor, body, params, rpc }) => rpc("emergency_session_correction", { p_actor: actor.id, p_session_id: params.id, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }),
);

import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Step 1: ask for a session recorded as HELD or SKIPPED by mistake to be reopened. Nothing changes until it is approved and executed. */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("request_session_correction", { p_actor: actor.id, p_session_id: params.id, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }),
);

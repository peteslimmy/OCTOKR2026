import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Step 3: reopens the session. The wrong roster is archived first. Not the requester. */
export const POST = api(
  { stepUp: true, body: z.object({ idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("execute_session_correction", { p_actor: actor.id, p_request_id: params.id, p_idempotency_key: body.idempotencyKey }),
);

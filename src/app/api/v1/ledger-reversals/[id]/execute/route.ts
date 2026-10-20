import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Step 3: posts the compensating entry for an approved request. Not the requester; the ledger still refuses to go negative. */
export const POST = api(
  { stepUp: true, body: z.object({ idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("execute_ledger_reversal", { p_actor: actor.id, p_request_id: params.id, p_idempotency_key: body.idempotencyKey }),
);

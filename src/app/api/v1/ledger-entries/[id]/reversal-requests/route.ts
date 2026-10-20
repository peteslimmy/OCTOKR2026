import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Step 1 of a ledger correction: ask for a compensating entry that cancels this one. Nothing is posted until it is approved and executed. */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("request_ledger_reversal", { p_actor: actor.id, p_entry_id: params.id, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }),
);

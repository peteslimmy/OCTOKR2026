import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Apply the reviewed late report: creates new weekly and quarterly snapshot versions. The reviewer cannot apply. */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("apply_late_report_amendment", {
    p_actor: actor.id, p_exception_id: params.id, p_reason: body.reason, p_idempotency_key: body.idempotencyKey,
  }),
);

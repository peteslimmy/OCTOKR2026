import { z } from "zod";
import { api } from "@/lib/api/handler";

/** The reviewer comment is recorded but NOT mandatory: DEC-016 is unresolved and must not be enforced until approved. */
export const POST = api(
  { body: z.object({ idempotencyKey: z.string().min(8).max(100), reason: z.string().trim().max(2000).nullish() }) },
  async ({ actor, body, params, rpc }) =>
    rpc("decide_attendance_amendment", {
      p_actor: actor.id, p_request_id: params.id, p_approve: false, p_reason: body.reason ?? null, p_idempotency_key: body.idempotencyKey,
    }),
);

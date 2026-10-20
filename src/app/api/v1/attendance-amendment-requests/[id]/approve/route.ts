import { z } from "zod";
import { api, fail } from "@/lib/api/handler";

/** Independent decision: the database resolves identities from the verified session and refuses requester == decider. */
export const POST = api(
  { body: z.object({ idempotencyKey: z.string().min(8).max(100), comment: z.string().trim().max(2000).nullish() }) },
  async ({ actor, body, params, rpc }) => {
    const out = await rpc<{ status: string }>("decide_attendance_amendment", {
      p_actor: actor.id, p_request_id: params.id, p_approve: true, p_reason: body.comment ?? null, p_idempotency_key: body.idempotencyKey,
    });
    if (out.status === "STALE_REJECTED") {
      throw fail("ATTENDANCE_AMENDMENT_STALE", 409, "The attendance record changed after this request was made. It was not applied; submit a new request.");
    }
    return out;
  },
);

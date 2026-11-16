import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Treat a fund request out of order. Admin and Super Admin only (disbursement.skip_queue, checked again by the database); the reason is audited. */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(1000) }) },
  async ({ actor, body, params, rpc }) => rpc("skip_disbursement_queue", { p_actor: actor.id, p_request_id: params.id, p_reason: body.reason }),
);

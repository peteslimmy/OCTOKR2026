import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * Asks for a holiday amendment on a CLOSED week (final-locked, or in a locked quarter). A different holder of `quarter.score.amend`
 * must approve it before anything changes. Weeks that are not closed are amended directly through `holiday-amendment`.
 */
export const POST = api(
  { stepUp: true, body: z.object({
    direction: z.enum(["DECLARE", "REVERSE"]), reason: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().min(8).max(100), confirm: z.literal(true),
  }) },
  async ({ actor, body, params, rpc }) => rpc("request_holiday_amendment", {
    p_actor: actor.id, p_week_id: params.id, p_direction: body.direction, p_reason: body.reason, p_idempotency_key: body.idempotencyKey,
  }),
);

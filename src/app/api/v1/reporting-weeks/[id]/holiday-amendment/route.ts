import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * Controlled holiday amendment: declare a locked / already-reported week an Organization Holiday, or reverse a holiday.
 * Requires `quarter.score.amend`, a reason and explicit confirmation; creates new versioned quarterly snapshots.
 */
export const POST = api(
  { stepUp: true, body: z.object({
    direction: z.enum(["DECLARE", "REVERSE"]), reason: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().min(8).max(100), confirm: z.literal(true),
  }) },
  async ({ actor, body, params, rpc }) => rpc("amend_organization_holiday", {
    p_actor: actor.id, p_week_id: params.id, p_direction: body.direction, p_reason: body.reason, p_idempotency_key: body.idempotencyKey,
  }),
);

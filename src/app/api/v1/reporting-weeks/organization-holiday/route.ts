import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ reportingWeekIds: z.array(z.string().uuid()).min(1).max(30), reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100), confirm: z.literal(true) }) }, async ({ actor, body, rpc }) =>
  rpc("declare_organization_holiday", { p_actor: actor.id, p_week_ids: body.reportingWeekIds, p_reason: body.reason, p_idempotency_key: body.idempotencyKey }));

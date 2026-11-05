import { z } from "zod";
import { api } from "@/lib/api/handler";

export const PUT = api({ stepUp: true, body: z.object({ enabled: z.boolean(), months: z.number().int().min(1).max(12) }) }, async ({ actor, body, rpc }) =>
  rpc("set_access_review_schedule", { p_actor: actor.id, p_enabled: body.enabled, p_months: body.months }));

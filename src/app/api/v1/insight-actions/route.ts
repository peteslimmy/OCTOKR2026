import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Record an action management took for a unit, with the unit's score at the time, so the brief can show what happened afterwards. */
export const POST = api({ body: z.object({
  businessUnitId: z.string().uuid(), quarterId: z.string().uuid(), note: z.string().trim().min(1).max(2000), scoreBefore: z.number().min(0).max(100).nullish(),
}) }, async ({ actor, body, rpc }) =>
  rpc("log_insight_action", { p_actor: actor.id, p_bu: body.businessUnitId, p_quarter: body.quarterId, p_note: body.note, p_score_before: body.scoreBefore ?? null }));

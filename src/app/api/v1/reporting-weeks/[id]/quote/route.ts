import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/reporting-weeks/{weekId}/quote — records the week's quote as a draft (one per week). Submit, approve and publish are separate steps. */
export const POST = api(
  { body: z.object({ businessUnitId: z.string().uuid(), speaker: z.string().trim().min(1).max(500), quote: z.string().trim().min(1).max(1000) }) },
  async ({ actor, body, params, rpc }) =>
    rpc("record_weekly_quote", { p_actor: actor.id, p_week_id: params.id, p_bu: body.businessUnitId, p_speaker: body.speaker, p_quote: body.quote }));

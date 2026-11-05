import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/reporting-weeks/{weekId}/quote — records the week's quote as a draft (one per week). The speaker is picked from the people list; the name and BU come from that person. Submit, approve and publish are separate steps. */
export const POST = api(
  { body: z.object({ speakerEmployeeId: z.string().uuid(), quote: z.string().trim().min(1).max(1000) }) },
  async ({ actor, body, params, rpc }) =>
    rpc("record_weekly_quote_for", { p_actor: actor.id, p_week_id: params.id, p_employee: body.speakerEmployeeId, p_quote: body.quote }));

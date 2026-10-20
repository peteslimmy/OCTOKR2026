import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ reportingWeekId: z.string().uuid() }) }, async ({ actor, body, rpc }) =>
  rpc("get_or_create_weekly_report", { p_actor: actor.id, p_week_id: body.reportingWeekId }));

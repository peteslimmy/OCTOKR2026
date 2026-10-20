import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listSessions } from "@/lib/data/governance";

export const POST = api({ body: z.object({ reportingWeekId: z.string().uuid() }) }, async ({ actor, body, rpc }) =>
  rpc("create_governance_session", { p_actor: actor.id, p_week_id: body.reportingWeekId }));

export const GET = api({}, async () => listSessions());

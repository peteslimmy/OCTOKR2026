import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Re-apply the reporting policy in force to every week that has not final-locked yet. */
export const POST = api({ stepUp: true, body: z.object({ reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, rpc }) =>
  rpc("apply_schedule_to_existing_weeks", { p_actor: actor.id, p_reason: body.reason }));

import { z } from "zod";
import { api } from "@/lib/api/handler";

// opensAt null puts the week back on its default opening time
export const POST = api({ stepUp: true, body: z.object({ opensAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_week_opening", { p_actor: actor.id, p_week_id: params.id, p_opens_at: body.opensAt, p_reason: body.reason }));

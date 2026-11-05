import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ stepUp: true, body: z.object({ suspend: z.boolean(), reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_week_locks_suspended", { p_actor: actor.id, p_week_id: params.id, p_suspend: body.suspend, p_reason: body.reason }));

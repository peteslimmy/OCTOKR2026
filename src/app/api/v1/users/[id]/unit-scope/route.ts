import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Limit a person's hands-on work (violations, a person's attendance) to chosen units, or remove the limit with an empty list. */
export const PUT = api({ stepUp: true, body: z.object({ unitIds: z.array(z.string().uuid()).max(100), reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_user_unit_scope", { p_actor: actor.id, p_user: params.id, p_units: body.unitIds, p_reason: body.reason }));

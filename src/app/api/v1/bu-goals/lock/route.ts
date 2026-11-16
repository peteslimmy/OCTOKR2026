import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Lock a quarter's Business Unit goals, for every unit or one. Admin and Super Admin (bu_goals.lock; the database checks it again). */
export const POST = api({ body: z.object({ quarterId: z.string().uuid(), businessUnitId: z.string().uuid().nullish(), reason: z.string().trim().max(2000).nullish() }) },
  async ({ actor, body, rpc }) => rpc("lock_bu_goals", { p_actor: actor.id, p_quarter: body.quarterId, p_bu: body.businessUnitId ?? null, p_reason: body.reason ?? null }));

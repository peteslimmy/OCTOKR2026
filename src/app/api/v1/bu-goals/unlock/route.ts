import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Lift a lock on a quarter's Business Unit goals. A reason is required and audited. */
export const POST = api({ body: z.object({ quarterId: z.string().uuid(), businessUnitId: z.string().uuid().nullish(), reason: z.string().trim().min(1).max(2000) }) },
  async ({ actor, body, rpc }) => rpc("unlock_bu_goals", { p_actor: actor.id, p_quarter: body.quarterId, p_bu: body.businessUnitId ?? null, p_reason: body.reason }));

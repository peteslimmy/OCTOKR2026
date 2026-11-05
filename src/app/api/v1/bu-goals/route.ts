import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Add, rename, retire or restore one of a Business Unit's own goals for a quarter. The database checks who may keep which unit's goals. */
export const POST = api({ body: z.object({
  id: z.string().uuid().nullish(),
  businessUnitId: z.string().uuid().nullish(),
  quarterId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(500),
  status: z.enum(["ACTIVE", "RETIRED"]).optional(),
}) }, async ({ actor, body, rpc }) =>
  rpc("save_bu_goal", { p_actor: actor.id, p_id: body.id ?? null, p_bu: body.businessUnitId ?? null, p_quarter: body.quarterId ?? null, p_title: body.title, p_status: body.status ?? "ACTIVE" }));

import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ id: z.string().uuid().nullish(), name: z.string().trim().min(1).max(100), active: z.boolean().optional() }) }, async ({ actor, body, rpc }) =>
  rpc("save_disbursement_purpose", { p_actor: actor.id, p_id: body.id ?? null, p_name: body.name, p_active: body.active ?? true }));

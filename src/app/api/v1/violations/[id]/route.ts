import { z } from "zod";
import { api } from "@/lib/api/handler";

export const PATCH = api({ body: z.object({ fine: z.number().positive().max(1_000_000_000).nullish(), reason: z.string().trim().max(2000).nullish(), notes: z.string().trim().max(2000).nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("update_violation", { p_actor: actor.id, p_id: params.id, p_fine: body.fine ?? null, p_reason: body.reason ?? null, p_notes: body.notes ?? null }));

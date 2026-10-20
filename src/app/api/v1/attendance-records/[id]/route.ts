import { z } from "zod";
import { api } from "@/lib/api/handler";

export const PATCH = api({ body: z.object({ status: z.string().trim().min(1).max(40), notes: z.string().trim().max(2000).nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_attendance_status", { p_actor: actor.id, p_record_id: params.id, p_status: body.status, p_notes: body.notes ?? null }));

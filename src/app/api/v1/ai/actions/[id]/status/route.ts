import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/actions/{id}/status { status, note? } — the owning unit marks an approved plan's action done or blocked (a reason is needed to block); a manager may cancel. */
export const POST = api({ body: z.object({ status: z.enum(["DONE", "BLOCKED", "OPEN", "CANCELLED"]), note: z.string().max(2000).optional() }) }, async ({ actor, body, params, rpc }) =>
  rpc("ai_set_action_status", { p_actor: actor.id, p_action: params.id, p_status: body.status, p_note: body.note ?? null }));

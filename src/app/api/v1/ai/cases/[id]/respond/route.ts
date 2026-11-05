import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/cases/{id}/respond { text } — the unit's answer to a case. Only a person of the case's unit; it stops further escalation. */
export const POST = api({ body: z.object({ text: z.string().min(1).max(4000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("ai_respond_case", { p_actor: actor.id, p_case: params.id, p_text: body.text }));

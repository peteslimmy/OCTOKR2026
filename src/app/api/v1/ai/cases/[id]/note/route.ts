import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/cases/{id}/note { note } — a case manager adds a note to the timeline. */
export const POST = api({ body: z.object({ note: z.string().min(1).max(4000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("ai_case_note", { p_actor: actor.id, p_case: params.id, p_note: body.note }));

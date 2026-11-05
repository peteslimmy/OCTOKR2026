import { z } from "zod";
import { api } from "@/lib/api/handler";
import { uuid } from "@/lib/session-notes/schemas";
import { LINK_TYPES } from "@/lib/session-notes/constants";

/** POST /api/v1/okr-notes/{id}/links { targetType, targetId, remove? } — link a note to (or unlink it from) an OKR component. Linking never changes the component, its score or compliance. */
export const POST = api({ body: z.object({ targetType: z.enum(LINK_TYPES.map((l) => l.code) as [string, ...string[]]), targetId: uuid, remove: z.boolean().default(false) }) },
  async ({ actor, body, params, rpc }) => { await rpc("set_okr_note_link", { p_actor: actor.id, p_note: params.id, p_target_type: body.targetType, p_target_id: body.targetId, p_remove: body.remove }); return { ok: true }; });

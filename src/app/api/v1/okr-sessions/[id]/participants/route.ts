import { z } from "zod";
import { api } from "@/lib/api/handler";
import { uuid } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-sessions/{id}/participants { userId, role?, remove? } — invite or remove one participant (removal keeps the row and the date). */
export const POST = api({ body: z.object({ userId: uuid, role: z.enum(["PRESENTER", "BU_LEAD", "ATTENDEE", "OBSERVER"]).optional(), remove: z.boolean().optional() }) },
  async ({ actor, body, params, rpc }) => { await rpc("set_okr_session_participant", { p_actor: actor.id, p_session: params.id, p_user: body.userId, p_role: body.role ?? null, p_remove: body.remove ?? false }); return { ok: true }; });

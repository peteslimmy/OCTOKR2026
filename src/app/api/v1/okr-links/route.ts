import { z } from "zod";
import { api } from "@/lib/api/handler";
import { uuid } from "@/lib/session-notes/schemas";
import { LINK_TYPES } from "@/lib/session-notes/constants";

/** POST /api/v1/okr-links { ownerType: DECISION | ACTION | RISK, ownerId, targetType, targetId, remove? } — link a register record to an OKR component. Linking never changes the component. */
export const POST = api({ body: z.object({ ownerType: z.enum(["DECISION", "ACTION", "RISK"]), ownerId: uuid, targetType: z.enum(LINK_TYPES.map((l) => l.code) as [string, ...string[]]), targetId: uuid, remove: z.boolean().default(false) }) },
  async ({ actor, body, rpc }) => { await rpc("set_okr_record_link", { p_actor: actor.id, p_owner_type: body.ownerType, p_owner_id: body.ownerId, p_target_type: body.targetType, p_target_id: body.targetId, p_remove: body.remove }); return { ok: true }; });

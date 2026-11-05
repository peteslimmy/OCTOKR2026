import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-comments/{id}/links { targetType, targetId, remove? } — the author links a session, note, decision, action, risk or OKR component. A link is a reference; it never changes the target. */
export const POST = api({ body: S.linkChange }, async ({ actor, body, params, rpc }) => {
  await rpc("set_eo_link", { p_actor: actor.id, p_comment: params.id, p_rec: null, p_target_type: body.targetType, p_target_id: body.targetId, p_remove: body.remove });
  return { ok: true };
});

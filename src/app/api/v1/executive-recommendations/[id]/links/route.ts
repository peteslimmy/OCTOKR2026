import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendations/{id}/links { targetType, targetId, remove? } — the author links records; the addressed unit may add the workflow item it uses to carry the advice out (never remove). */
export const POST = api({ body: S.linkChange }, async ({ actor, body, params, rpc }) => {
  await rpc("set_eo_link", { p_actor: actor.id, p_comment: null, p_rec: params.id, p_target_type: body.targetType, p_target_id: body.targetId, p_remove: body.remove });
  return { ok: true };
});

import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendation-targets/{id}/reassign { userId, reason } — the unit names another active member as the responsible contact. */
export const POST = api({ body: S.reassign }, async ({ actor, body, params, rpc }) =>
  rpc("reassign_eo_target", { p_actor: actor.id, p_target: params.id, p_new_user: body.userId, p_reason: body.reason }));

import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendations/{id}/close { targetId?, reason, requestKey? } — executive_recommendation.close, the author (or another holder when the author is no longer active). Closing does not mean the matter is resolved. */
export const POST = api({ body: S.closeRec }, async ({ actor, body, params, rpc }) =>
  rpc("close_eo_recommendation", { p_actor: actor.id, p_rec: params.id, p_target: body.targetId ?? null, p_reason: body.reason, p_key: body.requestKey ?? null }));

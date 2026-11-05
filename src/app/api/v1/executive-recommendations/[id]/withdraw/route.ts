import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendations/{id}/withdraw { reason } — executive_recommendation.withdraw, the author only; every addressed unit's record becomes WITHDRAWN and the history stays. */
export const POST = api({ body: S.withdraw }, async ({ actor, body, params, rpc }) => rpc("withdraw_eo_recommendation", { p_actor: actor.id, p_rec: params.id, p_reason: body.reason }));

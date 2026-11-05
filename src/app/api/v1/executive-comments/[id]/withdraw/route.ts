import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-comments/{id}/withdraw { reason } — the author only. The comment stays readable, marked withdrawn; nothing is deleted. */
export const POST = api({ body: S.withdraw }, async ({ actor, body, params, rpc }) => rpc("withdraw_eo_comment", { p_actor: actor.id, p_comment: params.id, p_reason: body.reason }));

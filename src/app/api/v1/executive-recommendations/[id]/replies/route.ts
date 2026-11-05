import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendations/{id}/replies { targetId?, content, requestKey? } — a message in the conversation (executive_comment.reply). The author answering a clarification hands the move back to the unit. */
export const POST = api({ body: S.recMessage }, async ({ actor, body, params, rpc }) =>
  rpc("reply_eo_recommendation", { p_actor: actor.id, p_rec: params.id, p_target: body.targetId ?? null, p_body: body.content, p_key: body.requestKey ?? null }));

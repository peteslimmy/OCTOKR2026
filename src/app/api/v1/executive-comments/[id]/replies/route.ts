import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-comments/{id}/replies { content, requestKey? } — executive_comment.reply; the unit's people and Executives answer in the same conversation. Replies cannot edit the original. */
export const POST = api({ body: S.reply }, async ({ actor, body, params, rpc }) =>
  rpc("reply_eo_comment", { p_actor: actor.id, p_comment: params.id, p_content: body.content, p_key: body.requestKey ?? null }));

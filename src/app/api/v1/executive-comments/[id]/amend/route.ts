import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-comments/{id}/amend { expectedVersion, content?, title?, category?, reason } — the author only; the earlier wording is kept and shown. 409 VERSION_CONFLICT on a stale version. */
export const POST = api({ body: S.amendComment }, async ({ actor, body, params, rpc }) =>
  rpc("amend_eo_comment", { p_actor: actor.id, p_comment: params.id, p_expected_version: body.expectedVersion, p_category: body.category ?? null, p_title: body.title ?? null, p_content: body.content ?? null, p_reason: body.reason }));

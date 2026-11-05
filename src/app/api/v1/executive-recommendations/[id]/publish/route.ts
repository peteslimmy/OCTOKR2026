import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendations/{id}/publish { expectedVersion?, requestKey? } — the author issues a draft; each addressed unit's leads are notified. */
export const POST = api({ body: S.publish }, async ({ actor, body, params, rpc }) =>
  rpc("publish_eo_recommendation", { p_actor: actor.id, p_rec: params.id, p_expected_version: body.expectedVersion ?? null, p_key: body.requestKey ?? null }));

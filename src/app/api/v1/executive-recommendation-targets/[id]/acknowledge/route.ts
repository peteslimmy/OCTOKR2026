import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendation-targets/{id}/acknowledge — executive_recommendation.respond, a person of the addressed unit only. */
export const POST = api({ body: S.acknowledge }, async ({ actor, body, params, rpc }) =>
  rpc("acknowledge_eo_target", { p_actor: actor.id, p_target: params.id, p_expected_version: body.expectedVersion ?? null, p_key: body.requestKey ?? null }));

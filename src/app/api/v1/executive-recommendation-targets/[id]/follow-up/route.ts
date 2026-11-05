import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendation-targets/{id}/follow-up { body } — the author asks the unit a follow-up question after its response; the unit is asked to answer again. */
export const POST = api({ body: S.followUp }, async ({ actor, body, params, rpc }) =>
  rpc("ask_eo_follow_up", { p_actor: actor.id, p_target: params.id, p_body: body.body, p_expected_version: body.expectedVersion ?? null, p_key: body.requestKey ?? null }));

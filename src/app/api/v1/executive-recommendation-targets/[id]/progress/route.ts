import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendation-targets/{id}/progress { kind: PROGRESS|IMPLEMENTED, body } — executive_recommendation.update_progress, only after acceptance. Reporting it changes no OKR record. */
export const POST = api({ body: S.progress }, async ({ actor, body, params, rpc }) =>
  rpc("update_eo_progress", { p_actor: actor.id, p_target: params.id, p_kind: body.kind, p_body: body.body, p_expected_version: body.expectedVersion ?? null, p_key: body.requestKey ?? null }));

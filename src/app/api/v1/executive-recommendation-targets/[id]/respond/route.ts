import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-recommendation-targets/{id}/respond { decision: ACCEPT|PARTIAL|DECLINE|ALTERNATIVE|CONSIDERING|CLARIFICATION, body? } — a decline, a partial acceptance, an alternative or a clarification needs an explanation (REASON_REQUIRED / VALIDATION_ERROR). */
export const POST = api({ body: S.respond }, async ({ actor, body, params, rpc }) =>
  rpc("respond_eo_target", { p_actor: actor.id, p_target: params.id, p_decision: body.decision, p_body: body.body ?? null, p_expected_version: body.expectedVersion ?? null, p_key: body.requestKey ?? null }));

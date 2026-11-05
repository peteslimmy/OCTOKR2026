import { api, fail } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";
import { getRecommendation } from "@/lib/data/executive-oversight";
import { saveArgs } from "@/lib/executive-oversight/save-args";

/** GET /api/v1/executive-recommendations/{id} — the recommendation, each addressed unit's record, the whole timeline, links and files the caller may read. A unit's people see only their own unit's record. */
export const GET = api({}, async ({ params }) => {
  const r = await getRecommendation(params.id);
  if (!r) throw fail("NOT_FOUND", 404, "That recommendation was not found.");
  return r;
});

/** PATCH /api/v1/executive-recommendations/{id} — change the author's own DRAFT (same body as the create; expectedVersion required). A published recommendation cannot be edited. */
export const PATCH = api({ body: S.saveRecommendation }, async ({ actor, body, params, rpc }) => {
  if (body.expectedVersion === undefined) throw fail("VALIDATION_ERROR", 422, "Send the version you started from (expectedVersion).");
  return rpc("save_eo_recommendation", saveArgs(actor.id, params.id, body));
});

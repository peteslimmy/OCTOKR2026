import { api, fail } from "@/lib/api/handler";
import { getRecommendation } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-recommendations/{id}/history — the immutable timeline: who did what, when, with what words. */
export const GET = api({}, async ({ params }) => {
  const r = await getRecommendation(params.id);
  if (!r) throw fail("NOT_FOUND", 404, "That recommendation was not found.");
  return { reference: r.reference, status: r.status, targets: r.targets.map((t) => ({ target_id: t.target_id, unit: t.business_unit_name, status: t.status })), events: r.events };
});

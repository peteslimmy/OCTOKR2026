import { api, fail } from "@/lib/api/handler";
import { getJourney } from "@/lib/data/lifecycle";

/** GET /api/v1/employees/{id}/journey — the person's recorded journey: joining, moves, roles gained and lost, suspension. People managers read any; everyone reads their own; others get 404. */
export const GET = api({}, async ({ params }) => {
  const j = await getJourney(params.id);
  if (!j.events.length) throw fail("NOT_FOUND", 404, "No journey was found for that person.");
  return j;
});

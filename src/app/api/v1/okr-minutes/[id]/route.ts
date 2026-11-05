import { api, fail } from "@/lib/api/handler";
import { getMinutes } from "@/lib/data/session-notes";

/** GET /api/v1/okr-minutes/{id} — one minutes revision, including (once finalised) the frozen snapshot of the notes, decisions, actions and risks. */
export const GET = api({}, async ({ params }) => {
  const m = await getMinutes(params.id);
  if (!m) throw fail("NOT_FOUND", 404, "That record was not found.");
  return m;
});

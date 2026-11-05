import { api, fail } from "@/lib/api/handler";
import { getOutstanding } from "@/lib/data/session-notes";

/** GET /api/v1/okr-sessions/{id}/outstanding — open commitments and risks of the session's unit from earlier sessions (what to review now). */
export const GET = api({}, async ({ params }) => {
  const out = await getOutstanding(params.id);
  if (!out) throw fail("NOT_FOUND", 404, "That record was not found.");
  return out;
});

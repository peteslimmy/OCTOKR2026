import { api, fail } from "@/lib/api/handler";
import { getComment } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-comments/{id}/history — the immutable timeline and every earlier wording. */
export const GET = api({}, async ({ params }) => {
  const c = await getComment(params.id);
  if (!c) throw fail("NOT_FOUND", 404, "That comment was not found.");
  return { reference: c.reference, versions: c.versions, events: c.events };
});

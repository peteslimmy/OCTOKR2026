import { api, fail } from "@/lib/api/handler";
import { getComment } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-comments/{id} — the comment with every reply, earlier version, link and file the caller may read. Not found and not permitted look the same. */
export const GET = api({}, async ({ params }) => {
  const c = await getComment(params.id);
  if (!c) throw fail("NOT_FOUND", 404, "That comment was not found.");
  return c;
});

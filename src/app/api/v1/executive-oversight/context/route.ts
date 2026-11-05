import { api, fail } from "@/lib/api/handler";
import { getContext } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-oversight/context?subjectType=&subjectId=&bu=&module= — the comments and recommendations about a record (directly or through a link), for the Executive Commentary panel on any screen. */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const subjectType = sp.get("subjectType") || null, subjectId = sp.get("subjectId") || null;
  if ((subjectType === null) !== (subjectId === null)) throw fail("VALIDATION_ERROR", 422, "Send both subjectType and subjectId, or neither.");
  return getContext({ subjectType, subjectId, bu: sp.get("bu") || null, module: sp.get("module") || null });
});

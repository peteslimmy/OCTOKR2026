import { api, fail } from "@/lib/api/handler";
import { getPublishedQuote } from "@/lib/data/governance";

/** GET /api/v1/quotes?weekId={uuid} — the published quote of a week, visible to every signed-in user. */
export const GET = api({}, async ({ req }) => {
  const weekId = new URL(req.url).searchParams.get("weekId");
  if (!weekId || !/^[0-9a-f-]{36}$/i.test(weekId)) throw fail("VALIDATION_ERROR", 422, "weekId is required.");
  return { quote: await getPublishedQuote(weekId) };
});

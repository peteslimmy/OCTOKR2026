import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { getStrategyHistory } from "@/lib/data";

/** Every version of every item of a quarter's strategy, baseline first. Readable by any signed-in user, like the strategy itself. */
export const GET = api({}, async ({ req }) => {
  const q = new URL(req.url).searchParams.get("quarterId");
  if (!q || !z.string().uuid().safeParse(q).success) throw fail("VALIDATION_ERROR", 422, "Choose a quarter.");
  return getStrategyHistory(q);
});

import { api, fail } from "@/lib/api/handler";
import { getLinkOptions } from "@/lib/data/session-notes";

/** GET /api/v1/okr-link-options?bu=&week= — the current OKR components of a unit and week to link to (theme, quarter, objective, KRs, Sub-KRs, BU goals, weekly goals, tasks, report). */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const bu = sp.get("bu");
  if (!bu) throw fail("VALIDATION_ERROR", 422, "Choose a business unit.");
  return getLinkOptions(bu, sp.get("week"));
});

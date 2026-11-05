import { api, fail } from "@/lib/api/handler";
import { getLinkOptions, groupLinkOptions } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-oversight/link-options?bu=&week= — what can be linked for a unit and week: its sessions, notes, decisions, actions and risks the caller may read, and the OKR components. */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const bu = sp.get("bu");
  if (!bu) throw fail("VALIDATION_ERROR", 422, "Choose a business unit.");
  return groupLinkOptions(await getLinkOptions(bu, sp.get("week") || null));
});

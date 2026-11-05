import { api, fail } from "@/lib/api/handler";
import { getDashboard } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-oversight/dashboard?bu=&quarter=&from=&to= — executive_oversight.dashboard.view. Every figure is counted from the records the caller may read. */
export const GET = api({}, async ({ actor, req }) => {
  if (!actor.permissions.has("executive_oversight.dashboard.view")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to open the Executive Oversight dashboard.");
  const sp = new URL(req.url).searchParams;
  return getDashboard({ bu: sp.get("bu") || undefined, quarter: sp.get("quarter") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined });
});

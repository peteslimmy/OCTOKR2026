import { api, fail, requirePerm } from "@/lib/api/handler";
import { currentQuarter, getExecutiveDashboard } from "@/lib/data";

export const GET = api({}, async ({ actor }) => {
  requirePerm(actor, "dashboard.executive.view");
  const q = await currentQuarter();
  if (!q) throw fail("NOT_FOUND", 404, "No quarter is configured yet.");
  return getExecutiveDashboard(q.id);
});

import { api, fail } from "@/lib/api/handler";
import { readParams } from "@/lib/reports/access";
import { runInsights } from "@/lib/reports/insights-run";

export const GET = api({}, async ({ actor, req }) => {
  if (!actor.permissions.has("reports.view")) throw fail("REPORT_NOT_AVAILABLE", 403, "You do not have access to this report.");
  return runInsights(actor, readParams(new URL(req.url).searchParams).quarterId);
});

import { api } from "@/lib/api/handler";
import { availableReports } from "@/lib/reports/access";
import { BLOCKED_REPORTS, REPORTS, REPORTS_VERSION } from "@/lib/reports/catalogue";
import { METRICS, METRICS_VERSION } from "@/lib/reports/metrics";

/** The catalogue the caller may open, what cannot be produced yet and why, and the metric definitions. */
export const GET = api({}, async ({ actor }) => ({
  version: REPORTS_VERSION, metricsVersion: METRICS_VERSION,
  reports: availableReports(actor, REPORTS), blocked: actor.permissions.has("reports.view") ? BLOCKED_REPORTS : [], metrics: actor.permissions.has("reports.view") ? METRICS : [],
}));

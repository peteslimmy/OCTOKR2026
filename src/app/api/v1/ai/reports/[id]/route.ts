import { api, fail } from "@/lib/api/handler";
import { reportById, reportCsv } from "@/lib/ai/reports";
import { liveReportData } from "@/lib/ai/live-report-data";
import { can } from "@/lib/auth/actor";

/**
 * GET /api/v1/ai/reports/{id}?quarter=Q4 2026&unit=CODE&format=csv — a report as a CSV file. Needs the export permission and the same scope as viewing it;
 * the export is audited (who, which report, which format), never its content.
 */
export const GET = api({}, async ({ actor, req, params, rpc }) => {
  const def = reportById(params.id);
  if (!def) throw fail("NOT_FOUND", 404, "That report does not exist.");
  if (!can(actor, "ai.report.export")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to export reports.");
  const sp = new URL(req.url).searchParams;
  if (sp.get("format") !== "csv") throw fail("VALIDATION_ERROR", 422, "Only format=csv is available here; use the page's Print for a printable copy.");
  const res = await def.build({ asker: { id: actor.id, buId: actor.buId, permissions: actor.permissions }, data: liveReportData(), now: () => new Date() }, { quarter: sp.get("quarter") ?? undefined, unit: sp.get("unit") ?? undefined });
  if ("error" in res) throw fail("PERMISSION_DENIED", 403, res.error);
  await rpc("ai_log_report", { p_actor: actor.id, p_report: def.id, p_format: "csv", p_scope: res.report.scopeLabel });
  return new Response(`﻿${reportCsv(res.report)}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="4corepal-${def.id}.csv"`, "cache-control": "no-store" } });
});

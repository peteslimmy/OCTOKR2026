import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { loadReport, readParams } from "@/lib/reports/access";
import { toCsv, toPdf, toXlsx } from "@/lib/reports/export";
import { runReport } from "@/lib/reports/run";
import { MAX_EXPORT_ROWS, pickColumns } from "@/lib/reports/sanitize";

const FORMATS = { csv: "CSV", xlsx: "XLSX", pdf: "PDF" } as const;

/**
 * Permission-controlled export of the same result the user sees (run under their own scope). Row count is capped, the export is
 * recorded in the audit log (who, which report, which filters, format, rows), and exported text is defended against formula injection.
 */
export const GET = api({}, async ({ actor, params, req, rpc }) => {
  const def = loadReport(actor, params.id);
  if (!actor.permissions.has("reports.export")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to export reports.");
  const search = new URL(req.url).searchParams;
  const fmt = z.enum(["csv", "xlsx", "pdf"]).safeParse(search.get("format"));
  if (!fmt.success) throw fail("VALIDATION_ERROR", 422, "Choose csv, xlsx or pdf.");
  const full = await runReport(def, readParams(search), actor);
  const result = { ...full, columns: pickColumns(full.columns, search.get("cols")) };   // choosing columns can only narrow what the report already returns
  if (result.rows.length > MAX_EXPORT_ROWS) throw fail("EXPORT_TOO_LARGE", 413, "This report has too many rows to export. Narrow the period or Business Unit.");
  const file = fmt.data === "csv" ? toCsv(result, actor.name) : fmt.data === "xlsx" ? await toXlsx(result, actor.name) : await toPdf(result, actor.name);
  await rpc("record_report_export", { p_actor: actor.id, p_report_id: def.id, p_format: FORMATS[fmt.data], p_params: result.params, p_row_count: result.rows.length });
  return new Response(new Uint8Array(file.body), {
    headers: { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
});

import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { searchComments, searchRecommendations } from "@/lib/data/executive-oversight";
import { buildOversightReport } from "@/lib/executive-oversight/report";
import { MAX_EXPORT_ROWS } from "@/lib/reports/sanitize";
import { toCsv, toPdf, toXlsx } from "@/lib/reports/export";

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/v1/executive-oversight/export?kind=recommendations|comments&format=csv|xlsx|pdf&bu=&quarter=&from=&to=&status=&priority= — executive_oversight.export.
 * Built from what the caller's own access lets them read (row-level security), capped in size, defended against spreadsheet formula injection, and recorded in the audit log.
 */
export const GET = api({}, async ({ actor, req, rpc }) => {
  if (!actor.permissions.has("executive_oversight.export")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to export executive oversight records.");
  const sp = new URL(req.url).searchParams;
  const kind = z.enum(["recommendations", "comments"]).safeParse(sp.get("kind")), format = z.enum(["csv", "xlsx", "pdf"]).safeParse(sp.get("format"));
  if (!kind.success || !format.success) throw fail("VALIDATION_ERROR", 422, "Choose what to export (recommendations or comments) and a format (csv, xlsx or pdf).");
  const opt = (k: string, schema: z.ZodString) => { const v = sp.get(k); if (!v) return undefined; const p = schema.safeParse(v); if (!p.success) throw fail("VALIDATION_ERROR", 422, `The ${k} filter is not valid.`); return p.data; };
  const bu = opt("bu", UUID), quarter = opt("quarter", UUID), from = opt("from", DATE), to = opt("to", DATE), status = sp.get("status") || undefined, priority = sp.get("priority") || undefined;
  const rows: unknown[] = [];
  for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += 100) {
    const page = kind.data === "comments" ? await searchComments({ bu, quarter, from, to, status, limit: 100, offset }) : await searchRecommendations({ bu, quarter, from, to, status, priority, limit: 100, offset });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) break;
  }
  if (rows.length > MAX_EXPORT_ROWS) throw fail("EXPORT_TOO_LARGE", 413, "This report has too many rows to export. Narrow the period or business unit.");
  const result = buildOversightReport(kind.data, rows as never, { generatedAt: new Date().toISOString(), params: { buId: bu, quarterId: quarter, from, to } });
  const file = format.data === "csv" ? toCsv(result, actor.name) : format.data === "xlsx" ? await toXlsx(result, actor.name) : await toPdf(result, actor.name);
  await rpc("record_eo_export", { p_actor: actor.id, p_kind: kind.data, p_format: format.data.toUpperCase(), p_params: { bu, quarter, from, to, status, priority }, p_rows: result.rows.length });
  return new Response(new Uint8Array(file.body), { headers: { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});

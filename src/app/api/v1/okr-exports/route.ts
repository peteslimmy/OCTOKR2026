import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { listActions, listDecisions, listRisks, searchSessions } from "@/lib/data/session-notes";
import { toCsv, toPdf, toXlsx } from "@/lib/reports/export";
import { MAX_EXPORT_ROWS } from "@/lib/reports/sanitize";
import { buildRegisterReport, isRegisterKind, type RegisterData } from "@/lib/session-notes/registers-report";
import { userClient } from "@/lib/supabase/server";
import type { SessionSummary } from "@/lib/session-notes/types";

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/v1/okr-exports?kind=bu-history|quarterly|decisions|outstanding-actions|overdue-actions|risks|action-completion&format=csv|xlsx|pdf&bu=&quarter=&from=&to=
 * Exports a register or history in the same formats as the Reports module. It is built from what the caller's own access lets them read, capped in size,
 * defended against spreadsheet formula injection, and recorded in the audit log (who, what, which filters, how many rows). Needs session_notes.export.
 */
export const GET = api({}, async ({ actor, req, rpc }) => {
  if (!actor.permissions.has("session_notes.export")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to export session records.");
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const format = z.enum(["csv", "xlsx", "pdf"]).safeParse(sp.get("format"));
  if (!isRegisterKind(kind) || !format.success) throw fail("VALIDATION_ERROR", 422, "Choose a report and a format (csv, xlsx or pdf).");
  const opt = (k: string, schema: z.ZodString) => { const v = sp.get(k); if (!v) return undefined; const p = schema.safeParse(v); if (!p.success) throw fail("VALIDATION_ERROR", 422, `The ${k} filter is not valid.`); return p.data; };
  const bu = opt("bu", UUID), quarter = opt("quarter", UUID), from = opt("from", DATE), to = opt("to", DATE);
  if (kind === "quarterly" && !quarter) throw fail("VALIDATION_ERROR", 422, "Choose a quarter for the quarterly summary.");

  const sb = await userClient();
  const [{ data: buRow }, { data: qRow }] = await Promise.all([
    bu ? sb.from("business_units").select("name").eq("id", bu).maybeSingle() : Promise.resolve({ data: null }),
    quarter ? sb.from("quarters").select("year, quarter_number").eq("id", quarter).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const data: RegisterData = {
    kind, generatedAt: new Date().toISOString(), params: { buId: bu, quarterId: quarter, from, to },
    scopeLabel: buRow?.name ?? "Every unit you may access", periodLabel: qRow ? `Q${qRow.quarter_number} ${qRow.year}` : from || to ? `${from ?? "start"} to ${to ?? "today"}` : "All periods",
  };
  if (kind === "bu-history" || kind === "quarterly") {
    const rows: SessionSummary[] = [];
    for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += 100) {
      const page = await searchSessions({ bu, quarter, from, to, limit: 100, offset });
      rows.push(...page.rows);
      if (rows.length >= page.total || page.rows.length === 0) break;
    }
    data.sessions = rows;
  } else if (kind === "decisions") data.decisions = await listDecisions({ bu, quarter, from, to, limit: MAX_EXPORT_ROWS + 1 });
  else if (kind === "risks") data.risks = await listRisks({ bu, quarter, limit: MAX_EXPORT_ROWS + 1 });
  else data.actions = await listActions({ bu, quarter, from, to, limit: MAX_EXPORT_ROWS + 1 });

  const result = buildRegisterReport(data);
  if (result.rows.length > MAX_EXPORT_ROWS) throw fail("EXPORT_TOO_LARGE", 413, "This report has too many rows to export. Narrow the period or business unit.");
  const file = format.data === "csv" ? toCsv(result, actor.name) : format.data === "xlsx" ? await toXlsx(result, actor.name) : await toPdf(result, actor.name);
  await rpc("record_okr_export", { p_actor: actor.id, p_kind: kind, p_session: null, p_format: format.data.toUpperCase(), p_params: result.params, p_rows: result.rows.length });
  return new Response(new Uint8Array(file.body), {
    headers: { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
});

import { NextResponse } from "next/server";
import { api, fail, requirePerm } from "@/lib/api/handler";
import { auditPdf } from "@/lib/audit/export-pdf";
import { allAudit, filterFrom, filterParams } from "@/lib/data/audit";
import { csvEscape } from "@/lib/reports/sanitize";

const HEADERS = [
  "seq", "event_id", "occurred_at_utc", "action", "event_category", "severity", "outcome", "channel",
  "actor_user_id", "actor_name", "actor_email", "actor_role", "actor_bu_name", "actor_scope",
  "entity_type", "entity_id", "reason", "ip_address", "browser", "os", "device", "session_ref", "request_id", "correlation_id", "workflow_id", "related_approval_id",
  "old_values", "new_values", "metadata", "chain_seq", "row_hash",
] as const;
const JSON_COLUMNS = new Set<string>(["old_values", "new_values", "metadata"]);
const EOL = "\r\n";

/**
 * The audit log as a CSV or PDF file (`?format=csv|pdf`), with the same filters as the page, capped at 10,000 rows (the file says when it was cut).
 * The export is itself written to the audit log: who, which format, which filter, how many rows. CSV cells that could run as spreadsheet formulas are defused.
 */
export const GET = api({}, async ({ actor, req, rpc }) => {
  requirePerm(actor, "audit.read");
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "pdf") throw fail("VALIDATION_ERROR", 422, "Choose csv or pdf.");
  const filter = filterFrom(url.searchParams);
  const { rows, truncated } = await allAudit(filter);
  await rpc("record_audit_access", { p_actor: actor.id, p_kind: format.toUpperCase(), p_detail: { ...filter, truncated }, p_rows: rows.length });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

  if (format === "pdf") {
    const verify = await rpc<{ ok: boolean; checked: number }>("audit_verify_chain", { p_from: 1 });
    const pdf = await auditPdf({
      generatedAt: new Date().toISOString(), generatedFor: `${actor.name} (${actor.email})`, filterText: filterParams(filter).toString().replace(/&/g, ", "), rows, truncated,
      chainNote: verify.ok ? `Hash chain verified at export time: ${verify.checked} chained events intact.` : "WARNING: the audit hash chain failed verification at export time. Report this to the security owner.",
    });
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="audit-log_${stamp}.pdf"`, ...noStore } });
  }

  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(HEADERS.map((h) => {
      const v = h === "occurred_at_utc" ? r.occurred_at : h === "event_id" ? r.id : (r as unknown as Record<string, unknown>)[h];
      return csvEscape(JSON_COLUMNS.has(h) ? (v === null || v === undefined ? "" : JSON.stringify(v)) : (v as string | number | null));
    }).join(","));
  }
  if (truncated) lines.push(csvEscape("The export stopped at 10,000 rows. Narrow the filter or use dates to get the rest."));
  return new NextResponse(lines.join(EOL) + EOL, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log_${stamp}.csv"`, ...noStore } });
});

import { NextResponse } from "next/server";
import { api, requirePerm } from "@/lib/api/handler";
import { allAudit, filterFrom } from "@/lib/data/audit";
import { csvEscape } from "@/lib/reports/sanitize";

const HEADERS = ["seq", "occurred_at", "actor_role", "actor_user_id", "action", "entity_type", "entity_id", "outcome", "reason", "correlation_id", "old_values", "new_values"] as const;
const EOL = "\r\n";

/**
 * The audit log as a CSV file, with the same filters as the page, capped at 10,000 rows (the file says when it was cut).
 * The export is itself written to the audit log: who, which filter, how many rows. Cells that could run as spreadsheet formulas are defused.
 */
export const GET = api({}, async ({ actor, req, rpc }) => {
  requirePerm(actor, "audit.read");
  const filter = filterFrom(new URL(req.url).searchParams);
  const { rows, truncated } = await allAudit(filter);
  await rpc("record_audit_export", { p_actor: actor.id, p_filter: { ...filter, truncated }, p_rows: rows.length });
  const lines = [HEADERS.join(",")];
  for (const r of rows) lines.push(HEADERS.map((h) => csvEscape(h === "old_values" || h === "new_values" ? (r[h] === null ? "" : JSON.stringify(r[h])) : r[h])).join(","));
  if (truncated) lines.push(csvEscape("The export stopped at 10,000 rows. Narrow the filter or use dates to get the rest."));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new NextResponse(lines.join(EOL) + EOL, { headers: {
    "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log_${stamp}.csv"`, "cache-control": "no-store",
  } });
});

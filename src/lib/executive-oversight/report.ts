import type { ReportColumn, ReportParams, ReportResult } from "@/lib/reports/types";
import { moduleLabel, priorityLabel, statusLabel } from "./constants";
import type { EoComment, EoRecLine } from "./types";

/**
 * The exportable registers of the Executive Oversight module, expressed as the same ReportResult the Reports module exports (CSV, Excel, PDF), so one export path
 * (formula-injection defence, audit record) serves both. Pure: the rows are whatever the caller was allowed to read.
 */
const col = (key: string, label: string, type: ReportColumn["type"] = "text"): ReportColumn => ({ key, label, type });
const NOTES = [
  "Each row is read under the exporting person's own access: management-only comments and other units' recommendations are included only if that person may read them.",
  "A recommendation is advice. Nothing in this report is an instruction, and none of these records changed any OKR goal, task, score or compliance status.",
];

export function buildOversightReport(kind: "recommendations" | "comments", rows: (EoRecLine | EoComment)[], o: { generatedAt: string; params: ReportParams }): ReportResult {
  const base = { definitionVersion: "executive-oversight-1.0.0", generatedAt: o.generatedAt, scope: o.params.buId ? "BUSINESS_UNIT" as const : "ORGANISATION" as const, scopeLabel: o.params.buId ? "One business unit" : "Every unit you may access",
    periodLabel: o.params.from || o.params.to ? `${o.params.from ?? "start"} to ${o.params.to ?? "today"}` : "All periods", params: o.params, charts: [], metricIds: [] as string[] };
  if (kind === "comments") {
    const r = rows as EoComment[];
    return { ...base, reportId: "executive-oversight-comments", title: "Executive comments register", notes: NOTES, dataStatus: r.length ? "COMPLETE" : "NO_DATA",
      columns: [col("reference", "Reference"), col("posted", "Posted", "datetime"), col("title", "Title or summary"), col("unit", "Business unit"), col("module", "Module"), col("record", "Related record"), col("category", "Category"),
        col("author", "Author"), col("role", "Author's role"), col("visibility", "Visibility"), col("status", "Status", "status"), col("replies", "Replies", "number"), col("last", "Last activity", "datetime")],
      rows: r.map((c) => ({ reference: c.reference, posted: c.created_at, title: c.title ?? c.summary, unit: c.business_unit_name, module: moduleLabel(c.module), record: c.subject_label ?? "", category: c.category ?? "", author: c.author_name, role: c.author_role,
        visibility: c.visibility === "SHARED" ? "Shared with the unit" : "Management only", status: c.status === "PUBLISHED" ? "Published" : "Withdrawn", replies: c.replies, last: c.last_activity_at })),
      summary: [{ label: "Comments", value: r.length }, { label: "Replies in these conversations", value: r.reduce((a, x) => a + x.replies, 0) }, { label: "Withdrawn", value: r.filter((x) => x.status === "WITHDRAWN").length }] };
  }
  const r = rows as EoRecLine[];
  return { ...base, reportId: "executive-oversight-recommendations", title: "Executive recommendations register", notes: NOTES, dataStatus: r.length ? "COMPLETE" : "NO_DATA",
    columns: [col("reference", "Reference"), col("title", "Recommendation"), col("unit", "Addressed unit"), col("module", "Module"), col("record", "Related record"), col("issued", "Issued", "datetime"), col("author", "Author"), col("priority", "Priority", "status"),
      col("status", "Status", "status"), col("awaiting", "Waiting for"), col("contact", "Responsible contact"), col("due", "Response due", "date"), col("overdue", "Overdue"), col("update", "Latest update")],
    rows: r.map((x) => ({ reference: x.reference ?? "Draft", title: x.title, unit: x.business_unit_name, module: moduleLabel(x.module), record: x.subject_label ?? "", issued: x.issued_at, author: x.author_name, priority: priorityLabel[x.priority] ?? x.priority,
      status: statusLabel[x.status] ?? x.status, awaiting: x.awaiting === "BU" ? "Business unit" : x.awaiting === "EXECUTIVE" ? "Executive" : "", contact: x.responsible_name ?? "", due: x.response_due ?? "", overdue: x.overdue ? "Yes" : "No",
      update: x.latest_update ? `${x.latest_update.actor_name ?? "System"}: ${x.latest_update.excerpt}`.trim() : "" })),
    summary: [{ label: "Recommendation records (one per addressed unit)", value: r.length }, { label: "Overdue responses", value: r.filter((x) => x.overdue).length }, { label: "Accepted or partially accepted", value: r.filter((x) => x.status === "ACCEPTED_FOR_ACTION" || x.status === "PARTIALLY_ACCEPTED").length },
      { label: "Not accepted", value: r.filter((x) => x.status === "NOT_ACCEPTED").length }, { label: "Closed", value: r.filter((x) => x.status === "CLOSED").length }] };
}

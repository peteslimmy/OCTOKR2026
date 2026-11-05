import type { ReportColumn, ReportParams, ReportResult, SummaryItem } from "@/lib/reports/types";
import { actionStatusLabel, decisionStatusLabel, sessionStatusLabel } from "./constants";
import type { ActionRow, DecisionRow, RiskRow, SessionSummary } from "./types";

/**
 * The exportable reports of the Session Notes module, expressed as the same ReportResult the Reports module exports (CSV, Excel, PDF), so one export path
 * (with its formula-injection defence and its audit record) serves both. Pure: the rows are whatever the caller was allowed to read.
 */
export const REGISTER_KINDS = {
  "bu-history": "BU session history",
  quarterly: "Quarterly session summary",
  decisions: "Decisions register",
  "outstanding-actions": "Outstanding actions",
  "overdue-actions": "Overdue commitments",
  risks: "Risks and blockers register",
  "action-completion": "Action completion report",
} as const;
export type RegisterKind = keyof typeof REGISTER_KINDS;
export const isRegisterKind = (k: string | null): k is RegisterKind => !!k && k in REGISTER_KINDS;

export interface RegisterData {
  kind: RegisterKind; generatedAt: string; scopeLabel: string; periodLabel: string; params: ReportParams;
  sessions?: SessionSummary[]; decisions?: DecisionRow[]; actions?: ActionRow[]; risks?: RiskRow[];
}

const col = (key: string, label: string, type: ReportColumn["type"] = "text"): ReportColumn => ({ key, label, type });
const OPEN = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);
const NOTES = [
  "Each row is read under the exporting person's own access: notes classified for management or confidential, and other units' records, are included only if that person may read them.",
  "Source: OKR Session Notes records. Nothing in this report changes any OKR goal, task, score or compliance record.",
];

export function buildRegisterReport(d: RegisterData): ReportResult {
  let columns: ReportColumn[] = [];
  let rows: Record<string, unknown>[] = [];
  let summary: SummaryItem[] = [];
  const notes = [...NOTES];

  if (d.kind === "bu-history" || d.kind === "quarterly") {
    const s = d.sessions ?? [];
    columns = [col("reference", "Reference"), col("date", "Date", "date"), col("title", "Session"), col("type", "Type"), col("unit", "Business unit"), col("quarter", "Quarter"), col("week", "Week"),
      col("status", "Status", "status"), col("facilitator", "Facilitator"), col("notes", "Notes", "number"), col("decisions", "Decisions", "number"), col("openActions", "Open actions", "number"),
      col("risks", "Risks", "number"), col("minutes", "Minutes", "status")];
    rows = s.map((x) => ({
      reference: x.reference, date: x.session_date, title: x.title, type: x.type_name, unit: x.business_unit_name ?? "Organisation-wide", quarter: x.quarter_label ?? "—",
      week: x.week_number ? `Week ${x.week_number} ${x.week_year}` : "—", status: sessionStatusLabel[x.status] ?? x.status, facilitator: x.facilitator_name ?? "—", notes: x.notes,
      decisions: x.decisions, openActions: x.open_actions, risks: x.risks, minutes: x.minutes_status ?? "None",
    }));
    summary = [
      { label: "Sessions", value: s.length }, { label: "Completed", value: s.filter((x) => x.status === "COMPLETED").length },
      { label: "Open actions across these sessions", value: s.reduce((a, x) => a + x.open_actions, 0) },
      { label: "Completed sessions without finalised minutes", value: s.filter((x) => x.status === "COMPLETED" && x.minutes_status !== "FINALISED").length },
    ];
  } else if (d.kind === "decisions") {
    const r = d.decisions ?? [];
    columns = [col("reference", "Reference"), col("date", "Decision date", "date"), col("title", "Decision"), col("status", "Status", "status"), col("by", "Approved or rejected by"), col("session", "Session"),
      col("unit", "Affected unit"), col("description", "Description"), col("outcome", "Expected outcome"), col("followUp", "Follow-up"), col("links", "Linked OKR components"),
      col("supersededBy", "Superseded by"), col("supersedes", "Supersedes")];
    rows = r.map((x) => ({
      reference: x.reference, date: x.decision_date, title: x.title, status: decisionStatusLabel[x.status], by: x.decided_by_name ?? "—", session: x.session_reference, unit: x.affected_bu_name ?? "—",
      description: x.description, outcome: x.expected_outcome ?? "", followUp: x.follow_up ?? "", links: x.links.map((l) => l.label).join("; "), supersededBy: x.superseded_by_reference ?? "", supersedes: x.supersedes_reference ?? "",
    }));
    summary = (["APPROVED", "PROPOSED", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const).map((s) => ({ label: decisionStatusLabel[s], value: r.filter((x) => x.status === s).length }));
    notes.push("Only an APPROVED decision is a formal decision; a PROPOSED one was recorded but not approved by a person with that authority.");
  } else if (d.kind === "risks") {
    const r = d.risks ?? [];
    columns = [col("reference", "Reference"), col("kind", "Kind"), col("title", "Title"), col("unit", "Business unit"), col("category", "Category"), col("severity", "Severity", "status"), col("status", "Status", "status"),
      col("owner", "Owner"), col("target", "Target date", "date"), col("session", "Recorded in"), col("times", "Sessions raised in", "number"), col("reviews", "Times reviewed", "number"), col("mitigation", "Mitigation")];
    rows = r.map((x) => ({
      reference: x.reference, kind: x.kind, title: x.title, unit: x.business_unit_name ?? "—", category: x.category, severity: x.severity, status: x.status, owner: x.owner_name ?? "—",
      target: x.target_date ?? "", session: x.session_reference, times: x.raised_in_sessions, reviews: x.reviews, mitigation: x.mitigation ?? "",
    }));
    summary = [
      { label: "Open or mitigating", value: r.filter((x) => x.status === "OPEN" || x.status === "MITIGATING").length }, { label: "Overdue", value: r.filter((x) => x.overdue).length },
      { label: "Raised in more than one session", value: r.filter((x) => x.raised_in_sessions > 1).length },
    ];
  } else {
    let a = d.actions ?? [];
    if (d.kind === "outstanding-actions") a = a.filter((x) => OPEN.has(x.status));
    if (d.kind === "overdue-actions") a = a.filter((x) => x.overdue);
    columns = [col("reference", "Reference"), col("description", "Action"), col("unit", "Responsible unit"), col("assignee", "Assigned to"), col("priority", "Priority", "status"), col("status", "Status", "status"),
      col("assigned", "Assigned", "date"), col("due", "Due", "date"), col("daysOver", "Days overdue", "number"), col("completed", "Completed", "date"), col("onTime", "On time"), col("session", "Source session"),
      col("reviews", "Times reviewed in later sessions", "number"), col("extensions", "Deadline extensions", "number"), col("blocked", "Blocked because"), col("progress", "Latest progress"), col("verification", "Verification")];
    const today = d.generatedAt.slice(0, 10);
    rows = a.map((x) => ({
      reference: x.reference, description: x.description, unit: x.business_unit_name ?? "—", assignee: x.assignee_name ?? "—", priority: x.priority, status: actionStatusLabel[x.status], assigned: x.assigned_at.slice(0, 10),
      due: x.due_date, daysOver: x.overdue ? Math.max(0, Math.round((Date.parse(today) - Date.parse(x.due_date)) / 86_400_000)) : "", completed: x.completed_at?.slice(0, 10) ?? "",
      onTime: x.completed_at ? (x.completed_at.slice(0, 10) <= x.due_date ? "Yes" : "No") : "", session: x.origin_session_reference, reviews: x.reviews, extensions: x.extensions,
      blocked: x.blocked_reason ?? "", progress: x.progress_note ?? "", verification: x.requires_verification ? x.verification_status : "Not required",
    }));
    const done = a.filter((x) => x.status === "COMPLETED");
    const counted = a.filter((x) => x.status !== "CANCELLED");
    summary = [
      { label: "Actions", value: a.length }, { label: "Outstanding", value: a.filter((x) => OPEN.has(x.status)).length }, { label: "Overdue", value: a.filter((x) => x.overdue).length },
      { label: "Blocked", value: a.filter((x) => x.status === "BLOCKED").length }, { label: "Completed", value: done.length },
      { label: "Completion rate", value: counted.length ? Math.round((1000 * done.length) / counted.length) / 10 : null, unit: "%", note: "completed ÷ all actions not cancelled" },
      ...(d.kind === "action-completion"
        ? [{ label: "Completed on or before the due date", value: done.length ? Math.round((1000 * done.filter((x) => x.completed_at!.slice(0, 10) <= x.due_date).length) / done.length) / 10 : null, unit: "%" }]
        : []),
    ];
  }

  return {
    reportId: `okr-sessions-${d.kind}`, title: REGISTER_KINDS[d.kind], definitionVersion: "session-notes-1.0.0", generatedAt: d.generatedAt, scope: d.params.buId ? "BUSINESS_UNIT" : "ORGANISATION",
    scopeLabel: d.scopeLabel, periodLabel: d.periodLabel, params: d.params, columns, rows, summary, charts: [], notes, dataStatus: rows.length ? "COMPLETE" : "NO_DATA", metricIds: [],
  };
}

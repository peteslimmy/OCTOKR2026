import "server-only";
import { defaultQuarter, listBusinessUnits, listQuarters } from "@/lib/data";
import { getBuWeekTrend, getDashboardCells } from "@/lib/data/analytics";
import { getBuIntelligence, getExecutiveReport } from "@/lib/data/intelligence";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";
import { getWorkspace, listActions, listDecisions, listRisks, searchSessions } from "@/lib/data/session-notes";
import type { TaskHistoryRow, TaskRow, ToolData } from "./types";

/** What the tools read from the application: the existing data layer, as the signed-in person. Nothing here uses the service role. */
export function liveToolData(): ToolData {
  return {
    sessions: {
      search: (f) => searchSessions({ q: f.q, bu: f.bu, quarter: f.quarter, from: f.from, to: f.to, status: f.status, noteCategory: f.noteCategory, decisionStatus: f.decisionStatus, actionStatus: f.actionStatus, limit: f.limit ?? 12 }),
      detail: (id) => getWorkspace(id),
      actions: (f) => listActions(f),
      decisions: (f) => listDecisions(f),
      risks: (f) => listRisks({ bu: f.bu, quarter: f.quarter, status: f.status, severity: f.severity, openOnly: f.openOnly, limit: f.limit }),
    },
    async quarter(spec) {
      const all = await listQuarters();
      const s = (spec ?? "").trim().toLowerCase();
      const m = /^q([1-4])\s*(\d{4})$/.exec(s);
      const q = m ? all.find((x) => x.quarter_number === Number(m[1]) && x.year === Number(m[2])) : await defaultQuarter();
      return q ? { id: q.id, label: `Q${q.quarter_number} ${q.year}` } : null;
    },
    async units() {
      return (await listBusinessUnits()).filter((b) => b.reports_weekly && b.status === "ACTIVE").map((b) => ({ id: b.id, code: b.code, name: b.name }));
    },
    async buAnalysis(unit, quarterId) {
      const r = await getBuIntelligence(unit.id, unit.name, quarterId);
      return r ? { quarterLabel: r.quarterLabel, analysis: r.analysis } : null;
    },
    async orgReport(quarterId) {
      const r = await getExecutiveReport(quarterId);
      return r ? { quarterLabel: r.quarterLabel, report: r.report } : null;
    },
    trend: (buId, quarterId) => getBuWeekTrend(buId, quarterId),
    cells: (quarterId) => getDashboardCells(quarterId),
    async unresolvedTasks(buId, limit): Promise<TaskRow[]> {
      const sb = await userClient();
      let q = sb.from("tasks")
        .select("id, description, status, business_unit_id, business_units(code), smart_goals!inner(title, weekly_report_id, weekly_reports!inner(id, reporting_weeks!inner(week_number, week_start_at, week_end_at, status)))")
        .neq("status", "DONE").is("deleted_at", null).eq("smart_goals.weekly_reports.reporting_weeks.status", "FINAL_LOCKED").limit(limit * 3);
      if (buId) q = q.eq("business_unit_id", buId);
      const { data, error } = await q;
      if (error) throw dbError(error, "unresolved tasks");
      type Row = { id: string; description: string; status: string; business_unit_id: string; business_units: { code: string } | { code: string }[] | null;
        smart_goals: { title: string; weekly_report_id: string; weekly_reports: { id: string; reporting_weeks: { week_number: number; week_start_at: string; week_end_at: string } | { week_number: number; week_start_at: string; week_end_at: string }[] } | { id: string; reporting_weeks: unknown }[] } | unknown[] };
      const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
      return ((data ?? []) as unknown as Row[]).flatMap((r): TaskRow[] => {
        const g = one(r.smart_goals as never) as { title: string; weekly_reports: unknown } | undefined;
        const wr = one(g?.weekly_reports as never) as { id: string; reporting_weeks: unknown } | undefined;
        const w = one(wr?.reporting_weeks as never) as { week_number: number; week_start_at: string; week_end_at: string } | undefined;
        if (!g || !wr || !w) return [];
        return [{ id: r.id, description: r.description, status: r.status, goalTitle: g.title, reportId: wr.id, weekNumber: w.week_number, weekStart: w.week_start_at, dueAt: w.week_end_at,
          buId: r.business_unit_id, buCode: one(r.business_units)?.code ?? "" }];
      }).sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.description.localeCompare(b.description)).slice(0, limit);
    },
    async taskHistory(taskId): Promise<TaskHistoryRow[] | null> {
      const sb = await userClient();
      const t = await sb.from("tasks").select("id").eq("id", taskId).maybeSingle();       // not visible to this person: treated as not existing
      if (t.error || !t.data) return null;
      const { data, error } = await sb.from("task_status_history").select("from_status, to_status, change_source, occurred_at").eq("task_id", taskId).order("occurred_at");
      if (error) throw dbError(error, "task history");
      return ((data ?? []) as { from_status: string; to_status: string; change_source: string; occurred_at: string }[]).map((h) => ({ from: h.from_status, to: h.to_status, source: h.change_source, at: h.occurred_at }));
    },
  };
}

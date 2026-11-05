import "server-only";
import { cache } from "react";
import { normaliseCells, type Cell, type TrendCell } from "@/lib/analytics";
import { listQuarters } from "@/lib/data";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/**
 * One row per unit per reporting week of the quarter, limited by row-level security to the units the caller may see.
 * Several parts of one page ask for the same quarter (the totals, the trend, the unit's own weeks): within one request the database is asked once.
 */
export const getDashboardCells = cache(async (quarterId: string): Promise<Cell[]> => {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_dashboard_cells", { p_quarter_id: quarterId });
  if (error) throw dbError(error, "dashboard analytics");
  // only units that file a weekly report are scored or ranked; Departments that do not report never appear in these figures
  return normaliseCells(data).filter((c) => c.reportsWeekly);
});

export interface BuTrendPoint {
  week: string; label: string; reportId: string | null; goals: number | null; tasks: number | null; score: number | null;
  goalsDone: number; goalsTotal: number; tasksDone: number; tasksTotal: number;
}
/** One unit's weeks so far in a quarter: the share of goals done and of tasks done, and the weekly score. Holiday weeks are left out. */
export async function getBuWeekTrend(buId: string, quarterId: string): Promise<BuTrendPoint[]> {
  const cells = (await getDashboardCells(quarterId)).filter((c) => c.businessUnitId === buId && !c.holiday && new Date(c.weekStart) <= new Date())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
  return cells.map((c) => ({
    week: `W${c.weekNumber}`, label: `Week ${c.weekNumber} · ${short.format(new Date(c.weekStart))}`, reportId: c.reportId,
    goals: pct(c.goalsDone, c.goalsTotal), tasks: pct(c.tasksDone, c.tasksTotal), score: c.score,
    goalsDone: c.goalsDone, goalsTotal: c.goalsTotal, tasksDone: c.tasksDone, tasksTotal: c.tasksTotal,
  }));
}

/** Every unit's weeks in every quarter that has started: the history behind the performance chart, which can group by month, quarter or year. */
export async function getTrendHistory(): Promise<TrendCell[]> {
  const now = Date.now();
  const quarters = (await listQuarters()).filter((q) => new Date(q.starts_on).getTime() <= now);
  const perQuarter = await Promise.all(quarters.map(async (q) => (await getDashboardCells(q.id)).filter((c) => !c.holiday).map((c): TrendCell => ({
    businessUnitId: c.businessUnitId, name: c.name, weekId: c.weekId, weekNumber: c.weekNumber, weekStart: c.weekStart, year: q.year, quarter: q.quarter_number,
    tasksTotal: c.tasksTotal, tasksDone: c.tasksDone, goalsTotal: c.goalsTotal, goalsDone: c.goalsDone,
  }))));
  return perQuarter.flat();
}

/** How many of a unit's people were present at each week's OKR session, by reporting week. */
export async function getBuAttendance(buId: string, quarterId: string): Promise<Map<string, { present: number; total: number }>> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_bu_attendance", { p_bu: buId, p_quarter: quarterId });
  if (error) throw dbError(error, "attendance");
  return new Map(((data ?? []) as { reporting_week_id: string; present: number; total: number }[]).map((r) => [r.reporting_week_id, { present: Number(r.present), total: Number(r.total) }]));
}

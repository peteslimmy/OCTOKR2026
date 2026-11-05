// Pure folding of the dashboard rows (read_dashboard_cells) into the totals, series and rankings the dashboard draws.
// No score is recalculated here: weekly scores come from the scoring engine snapshots exactly as stored.

export interface Cell {
  businessUnitId: string; code: string; name: string; reportsWeekly: boolean;
  weekId: string; weekNumber: number; weekYear: number; weekStart: string; holiday: boolean;
  reportId: string | null; submitted: boolean; onTime: boolean;
  tasksTotal: number; tasksDone: number; tasksNotDone: number; tasksUndefined: number; goalsTotal: number; goalsDone: number; goalsNotDone: number;
  score: number | null; scoreState: string | null; compliance: "COMPLIANT" | "NON_COMPLIANT" | null;
}

export function normaliseCells(raw: unknown): Cell[] {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return (Array.isArray(raw) ? raw : []).map((r: Record<string, unknown>) => ({
    businessUnitId: String(r.business_unit_id), code: String(r.bu_code), name: String(r.business_unit), reportsWeekly: r.reports_weekly !== false,
    weekId: String(r.reporting_week_id), weekNumber: n(r.week_number), weekYear: n(r.week_year), weekStart: String(r.week_start_at), holiday: r.reporting_state === "ORGANIZATION_HOLIDAY",
    reportId: (r.weekly_report_id as string | null) ?? null, submitted: r.submission_status === "SUBMITTED", onTime: r.submitted_on_time === true,
    tasksTotal: n(r.tasks_total), tasksDone: n(r.tasks_done), tasksNotDone: n(r.tasks_not_done), tasksUndefined: n(r.tasks_undefined), goalsTotal: n(r.goals_total), goalsDone: n(r.goals_done), goalsNotDone: n(r.goals_not_done),
    score: r.final_score === null || r.final_score === undefined ? null : Number(r.final_score), scoreState: (r.score_state as string | null) ?? null,
    compliance: (r.compliance_status as Cell["compliance"]) ?? null,
  }));
}

/** Weeks that have started. A week in the future has nothing to show yet. */
export const elapsed = (cells: Cell[], nowIso: string) => cells.filter((c) => c.weekStart <= nowIso);

export interface Totals {
  tasksTotal: number; tasksDone: number; tasksNotDone: number; tasksUndefined: number; completion: number | null;
  goalsTotal: number; goalsDone: number; goalsNotDone: number;
  reportableWeeks: number; submittedWeeks: number; onTimeWeeks: number; missingWeeks: number; onTimeRate: number | null;
  scoredWeeks: number; avgScore: number | null;
  /** The average weekly score where weeks that are not final yet count at the share of their goals done (what the score would be before any penalty). */
  avgScoreToDate: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function totals(cells: Cell[]): Totals {
  const t: Totals = { tasksTotal: 0, tasksDone: 0, tasksNotDone: 0, tasksUndefined: 0, completion: null, goalsTotal: 0, goalsDone: 0, goalsNotDone: 0, reportableWeeks: 0, submittedWeeks: 0, onTimeWeeks: 0, missingWeeks: 0, onTimeRate: null, scoredWeeks: 0, avgScore: null, avgScoreToDate: null };
  let scoreSum = 0, toDateSum = 0, toDateWeeks = 0;
  for (const c of cells) {
    t.tasksTotal += c.tasksTotal; t.tasksDone += c.tasksDone; t.tasksNotDone += c.tasksNotDone; t.tasksUndefined += c.tasksUndefined;
    t.goalsTotal += c.goalsTotal; t.goalsDone += c.goalsDone; t.goalsNotDone += c.goalsNotDone;
    if (c.reportsWeekly && !c.holiday) {
      t.reportableWeeks += 1;
      if (c.submitted) t.submittedWeeks += 1;
      if (c.onTime) t.onTimeWeeks += 1;
      if (c.compliance === "NON_COMPLIANT") t.missingWeeks += 1;
      if (c.score !== null) { t.scoredWeeks += 1; scoreSum += c.score; }
      const toDate = c.score ?? (c.submitted && c.goalsTotal > 0 ? (c.goalsDone / c.goalsTotal) * 100 : null);
      if (toDate !== null) { toDateSum += toDate; toDateWeeks += 1; }
    }
  }
  t.completion = pct(t.tasksDone, t.tasksTotal);
  t.onTimeRate = pct(t.onTimeWeeks, t.reportableWeeks);
  t.avgScore = t.scoredWeeks ? scoreSum / t.scoredWeeks : null;
  t.avgScoreToDate = toDateWeeks ? toDateSum / toDateWeeks : null;
  return t;
}

export interface UnitRow extends Totals { id: string; code: string; name: string; reportsWeekly: boolean }

export function byUnit(cells: Cell[]): UnitRow[] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells) groups.set(c.businessUnitId, [...(groups.get(c.businessUnitId) ?? []), c]);
  return [...groups.entries()].map(([id, list]) => ({ id, code: list[0].code, name: list[0].name, reportsWeekly: list[0].reportsWeekly, ...totals(list) }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1) || b.tasksTotal - a.tasksTotal || a.name.localeCompare(b.name));
}

export interface WeekPoint extends Totals { weekId: string; label: string; weekStart: string; holiday: boolean }

export function byWeek(cells: Cell[]): WeekPoint[] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells) groups.set(c.weekId, [...(groups.get(c.weekId) ?? []), c]);
  return [...groups.entries()].map(([weekId, list]) => ({ weekId, label: `W${list[0].weekNumber}`, weekStart: list[0].weekStart, holiday: list.every((c) => c.holiday), ...totals(list) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export type HeatState = "HOLIDAY" | "NOT_REQUIRED" | "MISSING" | "PENDING" | "SCORED";
export function heatState(c: Cell): HeatState {
  if (c.holiday) return "HOLIDAY";
  if (!c.reportsWeekly) return "NOT_REQUIRED";
  if (c.compliance === "NON_COMPLIANT" && c.score === null) return "MISSING";
  if (c.score !== null) return c.scoreState === "NOT_SUBMITTED" ? "MISSING" : "SCORED";
  return "PENDING";
}

export interface Trend { value: number; direction: "up" | "down" | "flat" }

/**
 * How the last week moved against the one before it, using the last two weeks that have a value.
 * "relative" is a percentage change (for counts); "points" is the difference in percentage points (for scores and rates).
 * Returns null when there is nothing to compare, or when a percentage change would divide by zero.
 */
export function trendOf(series: (number | null)[], mode: "relative" | "points"): Trend | null {
  const have = series.filter((v): v is number => v !== null && Number.isFinite(v));
  if (have.length < 2) return null;
  const last = have[have.length - 1], prev = have[have.length - 2];
  if (mode === "relative" && prev === 0) return last === 0 ? { value: 0, direction: "flat" } : null;
  const value = mode === "relative" ? ((last - prev) / Math.abs(prev)) * 100 : last - prev;
  return { value, direction: Math.abs(value) < 0.05 ? "flat" : value > 0 ? "up" : "down" };
}

/** The comparison table as CSV, safe to open in a spreadsheet (text that could run as a formula is neutralised). */
export function unitsCsv(rows: UnitRow[], csvEscape: (v: unknown) => string): string {
  const head = ["Code", "Unit", "Type", "Tasks", "Tasks done", "Tasks not done", "Tasks not yet marked", "Task completion %", "Goals", "Goals done", "Goals not done", "Goal completion %", "Average score %"];
  const f1 = (v: number | null) => (v === null ? "" : v.toFixed(1));
  const lines = rows.map((u) => [u.code, u.name, u.reportsWeekly ? "Business Unit" : "Department", u.tasksTotal, u.tasksDone, u.tasksNotDone, u.tasksUndefined, f1(u.completion),
    u.goalsTotal, u.goalsDone, u.goalsNotDone, f1(u.goalsTotal ? (u.goalsDone / u.goalsTotal) * 100 : null), u.reportsWeekly ? f1(u.avgScoreToDate) : ""]);
  return [head, ...lines].map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

// ---------------------------------------------------------------- performance over time: tasks against goals, by week, month, quarter or year
/** One unit in one reporting week, with the quarter it belongs to. The history behind the trend chart spans every quarter. */
export interface TrendCell {
  businessUnitId: string; name: string; weekId: string; weekNumber: number; weekStart: string; year: number; quarter: number;
  tasksTotal: number; tasksDone: number; goalsTotal: number; goalsDone: number;
}
export type TrendBy = "week" | "month" | "quarter" | "year";
export interface TrendPoint { key: string; label: string; tasks: number | null; goals: number | null; units: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The calendar month a week starts in, in the organisation's time zone (Africa/Lagos, one hour ahead of UTC all year). */
function lagosMonth(iso: string): { y: number; m: number } {
  const d = new Date(new Date(iso).getTime() + 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

/**
 * The weekly average score of task completion against goal completion. Within each period (a week, a month, a quarter or a year) every unit that had tasks has a
 * task completion rate, every unit that had goals has a goal completion rate, and each line is the average of those rates: a big unit counts once, like a small one.
 * Only weeks that have started count. Pass `quarterKey` ("2026-4") to keep a week-by-week view to one quarter.
 */
export function trendSeries(cells: TrendCell[], by: TrendBy, nowIso: string, unitId: string | "all", quarterKey: string | null): TrendPoint[] {
  const now = new Date(nowIso).getTime();
  const rows = cells.filter((c) => new Date(c.weekStart).getTime() <= now && (unitId === "all" || c.businessUnitId === unitId) && (by !== "week" || quarterKey === null || `${c.year}-${c.quarter}` === quarterKey));
  const keyOf = (c: TrendCell): { key: string; label: string } => {
    if (by === "week") return { key: c.weekStart, label: `W${c.weekNumber}` };
    if (by === "month") { const { y, m } = lagosMonth(c.weekStart); return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${y}` }; }
    if (by === "quarter") return { key: `${c.year}-${c.quarter}`, label: `Q${c.quarter} ${c.year}` };
    return { key: String(c.year), label: String(c.year) };
  };
  const groups = new Map<string, { label: string; perUnit: Map<string, { td: number; tt: number; gd: number; gt: number }> }>();
  for (const c of rows) {
    const { key, label } = keyOf(c);
    const g = groups.get(key) ?? { label, perUnit: new Map() };
    const u = g.perUnit.get(c.businessUnitId) ?? { td: 0, tt: 0, gd: 0, gt: 0 };
    u.td += c.tasksDone; u.tt += c.tasksTotal; u.gd += c.goalsDone; u.gt += c.goalsTotal;
    g.perUnit.set(c.businessUnitId, u); groups.set(key, g);
  }
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([key, g]) => {
    const us = [...g.perUnit.values()];
    return { key, label: g.label, tasks: mean(us.filter((u) => u.tt > 0).map((u) => (u.td / u.tt) * 100)), goals: mean(us.filter((u) => u.gt > 0).map((u) => (u.gd / u.gt) * 100)), units: us.filter((u) => u.tt > 0 || u.gt > 0).length };
  }).filter((p) => p.tasks !== null || p.goals !== null);
}

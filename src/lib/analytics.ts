// Pure folding of the dashboard rows (read_dashboard_cells) into the totals, series and rankings the dashboard draws.
// No score is recalculated here: weekly scores come from the scoring engine snapshots exactly as stored.

export interface Cell {
  businessUnitId: string; code: string; name: string; reportsWeekly: boolean;
  weekId: string; weekNumber: number; weekYear: number; weekStart: string; holiday: boolean;
  reportId: string | null; submitted: boolean; onTime: boolean;
  tasksTotal: number; tasksDone: number; tasksNotDone: number; tasksUndefined: number; goalsTotal: number; goalsDone: number;
  score: number | null; scoreState: string | null; compliance: "COMPLIANT" | "NON_COMPLIANT" | null;
}

export function normaliseCells(raw: unknown): Cell[] {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return (Array.isArray(raw) ? raw : []).map((r: Record<string, unknown>) => ({
    businessUnitId: String(r.business_unit_id), code: String(r.bu_code), name: String(r.business_unit), reportsWeekly: r.reports_weekly !== false,
    weekId: String(r.reporting_week_id), weekNumber: n(r.week_number), weekYear: n(r.week_year), weekStart: String(r.week_start_at), holiday: r.reporting_state === "ORGANIZATION_HOLIDAY",
    reportId: (r.weekly_report_id as string | null) ?? null, submitted: r.submission_status === "SUBMITTED", onTime: r.submitted_on_time === true,
    tasksTotal: n(r.tasks_total), tasksDone: n(r.tasks_done), tasksNotDone: n(r.tasks_not_done), tasksUndefined: n(r.tasks_undefined), goalsTotal: n(r.goals_total), goalsDone: n(r.goals_done),
    score: r.final_score === null || r.final_score === undefined ? null : Number(r.final_score), scoreState: (r.score_state as string | null) ?? null,
    compliance: (r.compliance_status as Cell["compliance"]) ?? null,
  }));
}

/** Weeks that have started. A week in the future has nothing to show yet. */
export const elapsed = (cells: Cell[], nowIso: string) => cells.filter((c) => c.weekStart <= nowIso);

export interface Totals {
  tasksTotal: number; tasksDone: number; tasksNotDone: number; tasksUndefined: number; completion: number | null;
  goalsTotal: number; goalsDone: number;
  reportableWeeks: number; submittedWeeks: number; onTimeWeeks: number; missingWeeks: number; onTimeRate: number | null;
  scoredWeeks: number; avgScore: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function totals(cells: Cell[]): Totals {
  const t: Totals = { tasksTotal: 0, tasksDone: 0, tasksNotDone: 0, tasksUndefined: 0, completion: null, goalsTotal: 0, goalsDone: 0, reportableWeeks: 0, submittedWeeks: 0, onTimeWeeks: 0, missingWeeks: 0, onTimeRate: null, scoredWeeks: 0, avgScore: null };
  let scoreSum = 0;
  for (const c of cells) {
    t.tasksTotal += c.tasksTotal; t.tasksDone += c.tasksDone; t.tasksNotDone += c.tasksNotDone; t.tasksUndefined += c.tasksUndefined;
    t.goalsTotal += c.goalsTotal; t.goalsDone += c.goalsDone;
    if (c.reportsWeekly && !c.holiday) {
      t.reportableWeeks += 1;
      if (c.submitted) t.submittedWeeks += 1;
      if (c.onTime) t.onTimeWeeks += 1;
      if (c.compliance === "NON_COMPLIANT") t.missingWeeks += 1;
      if (c.score !== null) { t.scoredWeeks += 1; scoreSum += c.score; }
    }
  }
  t.completion = pct(t.tasksDone, t.tasksTotal);
  t.onTimeRate = pct(t.onTimeWeeks, t.reportableWeeks);
  t.avgScore = t.scoredWeeks ? scoreSum / t.scoredWeeks : null;
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
  const head = ["Rank", "Code", "Unit", "Type", "Tasks", "Done", "Not done", "Not yet marked", "Completion %", "Average score %", "On-time %", "Missing weeks"];
  const f1 = (v: number | null) => (v === null ? "" : v.toFixed(1));
  const lines = rows.map((u, i) => [i + 1, u.code, u.name, u.reportsWeekly ? "Business Unit" : "Department", u.tasksTotal, u.tasksDone, u.tasksNotDone, u.tasksUndefined,
    f1(u.completion), u.reportsWeekly ? f1(u.avgScore) : "", u.reportsWeekly ? f1(u.onTimeRate) : "", u.reportsWeekly ? u.missingWeeks : ""]);
  return [head, ...lines].map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

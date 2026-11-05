import { z } from "zod";
import { cleanDeep, cleanText } from "../safety";
import { SESSION_TOOLS } from "./sessions";
import { isError, type Asker, type TaskRow, type ToolContext, type ToolDef, type ToolRun, type Unit } from "./types";

/**
 * The only things the model may ask for (4COREPAL). Each is a named, read-only function with checked arguments. Scope is decided here in code from who is asking:
 *  - someone with ai.insights.org and the executive dashboard permission may ask about any unit and the organisation;
 *  - anyone else (a BU Lead) may ask about their own unit only, and asking about another returns the same answer as asking about one that does not exist.
 * The data underneath is also read as the signed-in person, so row-level security narrows it a second time. Results are cleaned of anything that could pass
 * for an instruction before the model sees them, and carry the records they came from.
 */
export const isOrgWide = (a: Asker) => a.permissions.has("ai.insights.org") && a.permissions.has("dashboard.executive.view");
const mayBu = (a: Asker) => a.permissions.has("ai.insights.org") || a.permissions.has("ai.insights.bu");

const out = (message: string, error: "OUT_OF_SCOPE" | "NOT_FOUND" | "NO_DATA" | "INVALID" = "INVALID"): ToolRun => ({ error, message });
const outOfScope = (): ToolRun => out("That is outside what you are allowed to see, or it does not exist.", "OUT_OF_SCOPE");
const period = (label: string) => label;
const quarterArg = z.string().max(20).optional();
const unitArg = z.string().min(1).max(80).optional();

async function resolveUnit(ctx: ToolContext, spec: string | undefined): Promise<{ unit: Unit } | { run: ToolRun }> {
  const { asker, data } = ctx;
  if (!mayBu(asker)) return { run: outOfScope() };
  const visible = await data.units();
  const allowed = isOrgWide(asker) ? visible : visible.filter((u) => u.id === asker.buId);
  const want = (spec ?? "").trim().toLowerCase();
  if (!want || want === "mine" || want === "my unit" || want === "my") {
    const own = allowed.find((u) => u.id === asker.buId);
    return own ? { unit: own } : { run: out("Say which business unit you mean.", "INVALID") };
  }
  const hit = allowed.find((u) => u.code.toLowerCase() === want || u.name.toLowerCase() === want) ?? allowed.find((u) => u.name.toLowerCase().includes(want));
  return hit ? { unit: hit } : { run: outOfScope() };
}
const quarterOf = async (ctx: ToolContext, spec?: string) => ctx.data.quarter(spec);
const link = (path: string, quarterId: string) => `${path}?quarter=${quarterId}`;
const tok = (ctx: ToolContext, u: { code: string; name: string }) => ctx.px.token(u.code, u.name);
const namer = async (ctx: ToolContext) => { const m = new Map((await ctx.data.units()).map((u) => [u.name, u] as const)); return (name: string) => { const u = m.get(name); return u ? ctx.px.token(u.code, u.name) : cleanText(name, 80); }; };
const round = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

const listBusinessUnits: ToolDef = {
  name: "list_business_units", description: "The business units you may ask about.", args: "{}",
  async run(ctx) {
    if (!mayBu(ctx.asker)) return outOfScope();
    const visible = await ctx.data.units();
    const allowed = isOrgWide(ctx.asker) ? visible : visible.filter((u) => u.id === ctx.asker.buId);
    return { data: { units: allowed.map((u) => ({ unit: tok(ctx, u), code: u.code })) }, sources: [], period: "now" };
  },
};

const orgSummary: ToolDef = {
  name: "get_org_summary", description: "Organisation-wide performance for a quarter: actual to date, forecast, target, units on track, at risk and off track, this week against last week.", args: "{ quarter?: \"Q4 2026\" }",
  async run(ctx, raw) {
    const a = z.object({ quarter: quarterArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    if (!isOrgWide(ctx.asker)) return outOfScope();
    const q = await quarterOf(ctx, a.data.quarter); if (!q) return out("No such quarter.", "NOT_FOUND");
    const r = await ctx.data.orgReport(q.id); if (!r) return out("No data for that quarter.", "NO_DATA");
    const o = r.report.org;
    const nm = await namer(ctx);
    const names = (l: string[]) => l.map(nm);
    return {
      period: period(r.quarterLabel),
      data: cleanDeep({
        quarter: r.quarterLabel, units: o.units, onTrack: o.counts.ON_TRACK, atRisk: o.counts.AT_RISK, offTrack: o.counts.OFF_TRACK, targetPct: o.target,
        actualToDatePct: round(o.actualToDate), reportedPct: round(o.reported), forecastUnweightedPct: round(o.projectedUnweighted), forecastWeightedByGoalsPct: round(o.projectedWeighted),
        unitsBelowTarget: o.belowTarget, unitsMateriallyBelowTarget: o.materiallyBelow, thisWeekPct: round(o.thisWeek), lastWeekPct: round(o.lastWeek), weekChangePoints: round(o.weekDelta),
        latestWeek: o.latestWeek, previousWeek: o.previousWeek, weeksRemaining: o.weeksRemaining, neededWeeklyPct: round(o.neededWeekly), recentWeeklyPct: round(o.recentWeekly),
        improving: names(o.improving), deteriorating: names(o.deteriorating), needingExecutiveAttention: names(o.needsIntervention), verdict: o.verdict,
      }),
      sources: [{ label: `Management brief, ${r.quarterLabel}`, href: link("/insights", q.id), period: r.quarterLabel, kind: "organisation" }],
      limitations: ["Forecasts are estimates from the weeks settled so far, not promises."],
    };
  },
};

const rankBus: ToolDef = {
  name: "rank_business_units", description: "Every unit ranked, best first, by forecast quarter score, score to date or last week's score.", args: "{ by?: \"forecast\" | \"to_date\" | \"last_week\", quarter?: \"Q4 2026\" }",
  async run(ctx, raw) {
    const a = z.object({ by: z.enum(["forecast", "to_date", "last_week"]).optional(), quarter: quarterArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    if (!isOrgWide(ctx.asker)) return outOfScope();
    const q = await quarterOf(ctx, a.data.quarter); if (!q) return out("No such quarter.", "NOT_FOUND");
    const r = await ctx.data.orgReport(q.id); if (!r) return out("No data for that quarter.", "NO_DATA");
    const nm = await namer(ctx);
    const by = a.data.by ?? "forecast";
    const val = (u: (typeof r.report.units)[number]) => (by === "forecast" ? u.projected : by === "to_date" ? u.scoreToDate : u.last);
    const rows = r.report.units.filter((u) => val(u) !== null).sort((x, y) => (val(y) ?? 0) - (val(x) ?? 0));
    return {
      period: period(r.quarterLabel),
      data: cleanDeep({ rankedBy: by, rows: rows.map((u, i) => ({ rank: i + 1, unit: nm(u.name), valuePct: round(val(u)), outlook: u.outlook, direction: u.direction })), notRanked: r.report.units.length - rows.length }),
      sources: [{ label: `Management brief, ${r.quarterLabel}`, href: link("/insights", q.id), period: r.quarterLabel, kind: "organisation" }],
    };
  },
};

const buPerformance: ToolDef = {
  name: "get_bu_performance", description: "One unit's quarter: outlook and forecast, last week against the week before, the main reason it is behind, capacity, goal outlooks.", args: "{ unit?: \"code or name; omit for your own\", quarter?: \"Q4 2026\" }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    const res = await resolveUnit(ctx, a.data.unit); if ("run" in res) return res.run;
    const q = await quarterOf(ctx, a.data.quarter); if (!q) return out("No such quarter.", "NOT_FOUND");
    const r = await ctx.data.buAnalysis(res.unit, q.id); if (!r) return out("No data for that quarter.", "NO_DATA");
    const x = r.analysis, i = x.intel;
    return {
      period: period(r.quarterLabel),
      data: cleanDeep({
        unit: tok(ctx, res.unit), quarter: r.quarterLabel, outlook: i.outlook, headline: i.headline, targetPct: i.prediction.target, forecastQuarterScorePct: round(i.prediction.projectedQuarterScore),
        lastWeekPct: round(x.change.last), weekBeforePct: round(x.change.previous), changePoints: round(x.change.delta), settledWeeks: i.evidenceWeeks,
        mainReason: x.cause ? { reason: x.cause.label, detail: x.cause.detail } : null,
        capacity: { plannedTasksPerWeek: round(x.capacity.plannedPerWeek), finishedTasksPerWeek: round(x.capacity.donePerWeek), finishedSharePct: round(x.capacity.ratio), overCommitted: x.capacity.overcommitted },
        unitGoals: i.goals.map((g) => ({ title: g.title, outlook: g.outlook, forecastPct: round(g.projected), weeklyGoals: g.weeklyGoals })),
        attendancePct: round(x.governance.attendanceRate), openViolations: x.governance.openViolations,
      }),
      sources: [{ label: `${res.unit.name}: dashboard, ${r.quarterLabel}`, href: link("/dashboard", q.id), period: r.quarterLabel, kind: "unit" }],
      limitations: i.evidenceWeeks < 3 ? ["Fewer than three settled weeks: the forecast is provisional."] : [],
    };
  },
};

const weeklyTrend: ToolDef = {
  name: "get_weekly_trend", description: "A unit's weeks so far: share of goals done, share of tasks done and the weekly score; or the organisation's average weekly score.", args: "{ unit?: \"code or name, or organisation\", quarter?: \"Q4 2026\" }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    const q = await quarterOf(ctx, a.data.quarter); if (!q) return out("No such quarter.", "NOT_FOUND");
    if ((a.data.unit ?? "").trim().toLowerCase() === "organisation") {
      if (!isOrgWide(ctx.asker)) return outOfScope();
      const r = await ctx.data.orgReport(q.id); if (!r) return out("No data for that quarter.", "NO_DATA");
      const s = r.report.org.series;
      return { period: period(r.quarterLabel), data: { scope: "organisation", weeks: s.map((w, i) => ({ week: w.week, averageScorePct: round(w.value), unitsFiled: w.units, changeFromPreviousPoints: i ? round(w.value - s[i - 1].value) : null })) },
        sources: [{ label: `Management brief, ${r.quarterLabel}`, href: link("/insights", q.id), period: r.quarterLabel, kind: "organisation" }] };
    }
    const res = await resolveUnit(ctx, a.data.unit); if ("run" in res) return res.run;
    const t = await ctx.data.trend(res.unit.id, q.id);
    if (!t.length) return out("No weeks have been reported yet.", "NO_DATA");
    return {
      period: period(q.label),
      data: cleanDeep({ unit: tok(ctx, res.unit), weeks: t.map((w, i) => ({ week: w.week, goalsDonePct: round(w.goals), tasksDonePct: round(w.tasks), scorePct: round(w.score), changeFromPreviousPoints: i && w.score !== null && t[i - 1].score !== null ? round((w.score ?? 0) - (t[i - 1].score ?? 0)) : null })) }),
      sources: t.filter((w) => w.reportId).slice(-6).map((w) => ({ label: `${res.unit.name}: ${w.label}`, href: `/weekly/${w.reportId}`, period: w.label, kind: "weekly report" as const })),
    };
  },
};

const carriedGoals: ToolDef = {
  name: "list_carried_goals", description: "Goals set again and again without being finished: a unit's, or across the organisation with how each is classified.", args: "{ unit?: \"code or name; omit for your own, or organisation\", quarter?: \"Q4 2026\" }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    const q = await quarterOf(ctx, a.data.quarter); if (!q) return out("No such quarter.", "NOT_FOUND");
    if ((a.data.unit ?? "").trim().toLowerCase() === "organisation") {
      if (!isOrgWide(ctx.asker)) return outOfScope();
      const r = await ctx.data.orgReport(q.id); if (!r) return out("No data for that quarter.", "NO_DATA");
      const nm = await namer(ctx);
      return { period: period(r.quarterLabel), data: cleanDeep({ goals: r.report.repeated.slice(0, 25).map((g) => ({ unit: nm(g.unit), goal: g.title, weeksSet: g.weeksSet, weeksUnfinished: g.weeksUnfinished, firstWeek: g.first, lastWeek: g.last, taskProgressPct: round(g.progressPct), classification: g.classification, why: g.why })) }),
        sources: [{ label: `Executive report, repeated goals, ${r.quarterLabel}`, href: link("/insights", q.id), period: r.quarterLabel, kind: "organisation" }],
        limitations: ["The application does not record who owns a goal, when it was created or its original due date: a goal belongs to its unit and its due date is the end of the week it was set for."] };
    }
    const res = await resolveUnit(ctx, a.data.unit); if ("run" in res) return res.run;
    const r = await ctx.data.buAnalysis(res.unit, q.id); if (!r) return out("No data for that quarter.", "NO_DATA");
    return { period: period(r.quarterLabel), data: cleanDeep({ unit: tok(ctx, res.unit), goals: r.analysis.capacity.carryOver.map((c) => ({ goal: c.title, weeksSetUnfinished: c.weeks })) }),
      sources: [{ label: `${res.unit.name}: dashboard, ${r.quarterLabel}`, href: link("/dashboard", q.id), period: r.quarterLabel, kind: "unit" }] };
  },
};

const unresolvedTasks: ToolDef = {
  name: "list_unresolved_tasks", description: "Tasks in finished weeks that were not done, with the week they were due. A task is due at the end of the week it was set for.", args: "{ unit?: \"code or name; omit for your own, or all\" }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    let buId: string | null;
    if ((a.data.unit ?? "").trim().toLowerCase() === "all") { if (!isOrgWide(ctx.asker)) return outOfScope(); buId = null; }
    else { const res = await resolveUnit(ctx, a.data.unit); if ("run" in res) return res.run; buId = res.unit.id; }
    const byCode = new Map((await ctx.data.units()).map((u) => [u.code, u] as const));
    const rows: TaskRow[] = (await ctx.data.unresolvedTasks(buId, 40)).filter((t) => isOrgWide(ctx.asker) || t.buId === ctx.asker.buId);
    return {
      period: "finished weeks",
      data: cleanDeep({ count: rows.length, tasks: rows.map((t) => ({ taskId: t.id, unit: byCode.get(t.buCode) ? tok(ctx, byCode.get(t.buCode)!) : cleanText(t.buCode, 20), task: cleanText(t.description, 200), goal: cleanText(t.goalTitle, 160), status: t.status, week: t.weekNumber, dueAt: t.dueAt.slice(0, 10) })) }),
      sources: [...new Set(rows.map((t) => t.reportId))].slice(0, 8).map((id) => { const t = rows.find((x) => x.reportId === id)!; return { label: `Week ${t.weekNumber} report`, href: `/weekly/${id}`, period: `Week ${t.weekNumber}`, kind: "weekly report" as const }; }),
      limitations: rows.length >= 40 ? ["Only the first 40 are shown."] : ["No per-task remark is recorded yet, so the reason a task was not done is not known."],
    };
  },
};

const taskHistory: ToolDef = {
  name: "get_task_history", description: "How one task's status changed over time.", args: "{ taskId: \"uuid from list_unresolved_tasks\" }",
  async run(ctx, raw) {
    const a = z.object({ taskId: z.string().uuid() }).safeParse(raw); if (!a.success) return out("A task id from list_unresolved_tasks is required.");
    if (!mayBu(ctx.asker)) return outOfScope();
    const h = await ctx.data.taskHistory(a.data.taskId);
    if (h === null) return outOfScope();
    return { period: "history", data: { changes: h.map((x) => ({ from: x.from, to: x.to, source: x.source, at: x.at.slice(0, 16).replace("T", " ") })), count: h.length },
      sources: [], limitations: h.length ? [] : ["The status of this task was never changed after it was created."] };
  },
};

const compliance: ToolDef = {
  name: "get_reporting_compliance", description: "Weekly reports filed, missed and late for a unit this quarter, or for every unit.", args: "{ unit?: \"code or name; omit for your own, or all\", quarter?: \"Q4 2026\" }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg }).safeParse(raw ?? {}); if (!a.success) return out("Bad arguments.");
    const q = await quarterOf(ctx, a.data.quarter); if (!q) return out("No such quarter.", "NOT_FOUND");
    const all = (a.data.unit ?? "").trim().toLowerCase() === "all";
    if (all && !isOrgWide(ctx.asker)) return outOfScope();
    let only: Unit | null = null;
    if (!all) { const res = await resolveUnit(ctx, a.data.unit); if ("run" in res) return res.run; only = res.unit; }
    const now = Date.now();
    const cells = (await ctx.data.cells(q.id)).filter((c) => c.reportsWeekly && !c.holiday && new Date(c.weekStart).getTime() <= now && (all ? isOrgWide(ctx.asker) : c.businessUnitId === only!.id));
    const by = new Map<string, { code: string; name: string; weeks: number; filed: number; late: number; missed: number }>();
    for (const c of cells) {
      const e = by.get(c.businessUnitId) ?? { code: c.code, name: c.name, weeks: 0, filed: 0, late: 0, missed: 0 };
      e.weeks++; if (c.submitted) { e.filed++; if (!c.onTime) e.late++; } else if (c.compliance === "NON_COMPLIANT") e.missed++;
      by.set(c.businessUnitId, e);
    }
    return { period: period(q.label), data: cleanDeep({ units: [...by.values()].map((e) => ({ unit: ctx.px.token(e.code, e.name), weeksDue: e.weeks, filed: e.filed, filedLate: e.late, missed: e.missed })) }),
      sources: [{ label: `Dashboard, ${q.label}`, href: link("/dashboard", q.id), period: q.label, kind: "organisation" }],
      limitations: ["Weeks still open are counted as due but not as missed until the final lock."] };
  },
};

export const TOOLS: readonly ToolDef[] = [listBusinessUnits, orgSummary, rankBus, buPerformance, weeklyTrend, carriedGoals, unresolvedTasks, taskHistory, compliance, ...SESSION_TOOLS];
export const TOOL_NAMES = TOOLS.map((t) => t.name);
export { isError };

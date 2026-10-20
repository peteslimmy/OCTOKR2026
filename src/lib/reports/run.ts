import "server-only";
import { currentQuarter, listQuarters, serverNow, type Quarter } from "@/lib/data";
import { dbError } from "@/lib/data/errors";
import type { Actor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { REPORTS, REPORTS_VERSION, reportById } from "./catalogue";
import { projectQuarterEnd, scenarioQuarterEnd } from "./forecast";
import { formatWeekLabel, formatWeekShort } from "@/lib/domain/week-label";
import { change, linearRegression, mean, rankDescending, round } from "./stats";
import type { ChartSeries, ChartSpec, ReportColumn, ReportDefinition, ReportParams, ReportResult, SummaryItem } from "./types";

// ---------------------------------------------------------------- row shapes returned by the read_report_* functions
export interface WeeklyRow {
  business_unit_id: string; bu_code: string; business_unit: string; reporting_week_id: string; week_number: number; week_year: number;
  week_start_at: string; content_lock_at: string; final_lock_at: string; week_status: string; reporting_state: "NORMAL" | "ORGANIZATION_HOLIDAY";
  result_state: "SCORED" | "NOT_SUBMITTED" | "PENDING" | "HOLIDAY"; final_score: number | null; base_score: number | null; snapshot_version: number | null;
  compliance_status: "COMPLIANT" | "NON_COMPLIANT" | null; compliance_reason: string | null; weekly_report_id: string | null;
  submission_status: string | null; submitted_at: string | null; review_status: string | null; submitted_before_content_lock: boolean | null;
  late_exception_status: "AUTHORISED" | "SUBMITTED" | "APPLIED" | null;
}
export interface QuarterRow {
  business_unit_id: string; bu_code: string; business_unit: string; version_number: number | null; calculation_status: string | null; score: number | null;
  score_reason: string | null; denominator_count: number | null; numerator: number | null; missing_report_zero_count: number | null;
  excluded_holiday_count: number | null; source: string | null; versions: number; previous_year: number | null; previous_quarter_number: number | null;
  previous_score: number | null;
}
interface KrRow {
  key_result_id: string; kr_code: string; kr_title: string; kr_sequence: number; sub_key_result_id: string; sub_code: string; sub_title: string;
  sub_sequence: number; reporting_week_id: string; week_number: number; week_start_at: string; mapped_goals: number; done_goals: number;
}
export interface GovernanceItem { category: string; ref_id: string; title: string; status: string; since: string; owner: string | null; path: string; age_days: number; priority: "HIGH" | "MEDIUM" | "LOW" }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const isScored = (r: WeeklyRow) => r.reporting_state === "NORMAL" && r.week_status === "FINAL_LOCKED" && r.final_score !== null;
const weekLabel = (r: { week_number: number; week_start_at: string }) => formatWeekLabel(r);
const qLabel = (q: Quarter) => `Q${q.quarter_number} ${q.year}${q.status === "ACTIVE" ? "" : ` (${q.status.toLowerCase()})`}`;
const pct = (n: number, d: number) => (d > 0 ? round((n * 100) / d) : null);

export async function rpcRows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw dbError(error, fn);
  return (data as T[]) ?? [];
}

export async function resolveQuarter(id?: string): Promise<Quarter | null> {
  if (!id) return currentQuarter();
  return (await listQuarters()).find((q) => q.id === id) ?? null;
}

/** Weekly rows grouped per BU in chronological order. */
function byBu(rows: WeeklyRow[]) {
  const m = new Map<string, WeeklyRow[]>();
  for (const r of rows) (m.get(r.business_unit_id) ?? m.set(r.business_unit_id, []).get(r.business_unit_id)!).push(r);
  return m;
}

function weeklyLineSeries(rows: WeeklyRow[], bus: string[]): ChartSeries[] {
  const weeks = [...new Map(rows.map((r) => [r.reporting_week_id, r])).values()].sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));
  return bus.map((id) => {
    const name = rows.find((r) => r.business_unit_id === id)!.business_unit;
    return {
      name,
      points: weeks.map((w) => {
        const r = rows.find((x) => x.business_unit_id === id && x.reporting_week_id === w.reporting_week_id);
        return { x: formatWeekShort(w), label: weekLabel(w), y: r && isScored(r) ? num(r.final_score) : null };
      }),
    };
  });
}

// ---------------------------------------------------------------- the runner
export async function runReport(def: ReportDefinition, params: ReportParams, actor: Actor): Promise<ReportResult> {
  const orgWide = actor.permissions.has("weekly_report.view_all");
  const base = {
    reportId: def.id, title: def.title, definitionVersion: REPORTS_VERSION, generatedAt: await serverNow(),
    scope: (orgWide ? "ORGANISATION" : "BUSINESS_UNIT") as ReportResult["scope"],
    scopeLabel: orgWide ? "All Business Units" : `Business Unit: ${actor.buName ?? "your unit"}`,
    params, metricIds: def.metricIds, charts: [] as ChartSpec[], notes: [] as string[], summary: [] as SummaryItem[],
  };
  if (!orgWide) base.notes.push("You can see your own Business Unit only, so organisation-wide averages, rankings and comparisons are not shown.");

  const needsQuarter = def.params.includes("quarter");
  const q = needsQuarter ? await resolveQuarter(params.quarterId) : null;
  if (needsQuarter && !q) {
    return { ...base, periodLabel: "No quarter", columns: [], rows: [], dataStatus: "NO_DATA", notes: [...base.notes, "No quarter is configured yet."] };
  }
  const ctx = { ...base, q, orgWide, buId: params.buId ?? (orgWide ? undefined : actor.buId ?? undefined) };

  switch (def.id) {
    case "org-performance-summary": return orgSummary(ctx);
    case "bu-scorecard": return buScorecard(ctx);
    case "performance-trends": return trends(ctx);
    case "quarter-forecast": return forecastReport(ctx);
    case "weekly-compliance": return complianceReport(ctx);
    case "reporting-register": return register(ctx);
    case "late-report-register": return lateRegister(ctx);
    case "okr-health": return okrHealth(ctx);
    case "governance-outstanding": return governance(ctx);
    case "integrity-corrections": return integrity(ctx);
    case "holiday-impact": return holidays(ctx);
    case "fund-actuals": return fund(ctx);
    case "data-quality": return dataQuality(ctx);
    default: throw new Error(`report ${def.id} has no runner`);
  }
}

type Ctx = Omit<ReportResult, "columns" | "rows" | "dataStatus" | "periodLabel"> & { q: Quarter | null; orgWide: boolean; buId?: string };
const done = (c: Ctx, periodLabel: string, columns: ReportColumn[], rows: Record<string, unknown>[], extra: Partial<ReportResult> = {}): ReportResult => {
  const { q: _q, orgWide: _o, buId: _b, ...rest } = c;
  void _q; void _o; void _b;
  return { ...rest, periodLabel, columns, rows, dataStatus: rows.length ? (extra.dataStatus ?? "COMPLETE") : "NO_DATA", ...extra, notes: [...c.notes, ...(extra.notes ?? [])],
    summary: extra.summary ?? c.summary, charts: extra.charts ?? c.charts } as ReportResult;
};

// ---------------------------------------------------------------- 1. organisation summary
async function orgSummary(c: Ctx) {
  const q = c.q!;
  const [weekly, quarter] = await Promise.all([
    rpcRows<WeeklyRow>("read_report_weekly_scores", { p_quarter_id: q.id, p_bu: c.buId ?? null }),
    rpcRows<QuarterRow>("read_report_quarter_scores", { p_quarter_id: q.id }),
  ]);
  const weeks = [...new Map(weekly.map((r) => [r.reporting_week_id, r])).values()].sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));
  let prevMean: number | null = null;
  const rows = weeks.map((w) => {
    const rs = weekly.filter((r) => r.reporting_week_id === w.reporting_week_id);
    const scored = rs.filter(isScored);
    const scores = scored.map((r) => Number(r.final_score));
    const avg = mean(scores);
    const mv = change(avg, prevMean);
    if (avg !== null) prevMean = avg;
    return {
      week: weekLabel(w), week_short: formatWeekShort(w), week_start_at: w.week_start_at,
      state: w.reporting_state === "ORGANIZATION_HOLIDAY" ? "Holiday (excluded)" : w.week_status === "FINAL_LOCKED" ? "Finalised" : "Not finalised",
      bus_scored: scored.length, mean_score: avg === null ? null : round(avg), min_score: scores.length ? Math.min(...scores) : null,
      max_score: scores.length ? Math.max(...scores) : null, movement: mv.abs,
      compliant: rs.filter((r) => r.compliance_status === "COMPLIANT").length, non_compliant: rs.filter((r) => r.compliance_status === "NON_COMPLIANT").length,
    };
  });
  const scoredQ = quarter.filter((r) => r.score !== null);
  const avgQ = mean(scoredQ.map((r) => Number(r.score)));
  const both = quarter.filter((r) => r.score !== null && r.previous_score !== null);
  const avgBothNow = mean(both.map((r) => Number(r.score)));
  const avgBothPrev = mean(both.map((r) => Number(r.previous_score)));
  const mvQ = change(avgBothNow, avgBothPrev);
  const comp = weekly.filter((r) => r.compliance_status);
  const compliant = comp.filter((r) => r.compliance_status === "COMPLIANT").length;
  const provisional = quarter.filter((r) => r.calculation_status === "PROVISIONAL").length;
  const summary: SummaryItem[] = [
    { label: "Average of BU quarterly scores", value: avgQ === null ? null : round(avgQ), unit: "points", metricId: "org_mean_bu_score", note: `${scoredQ.length} BU${scoredQ.length === 1 ? "" : "s"} with a score; not an official organisation score`, tone: "neutral" },
    { label: "Change from previous quarter", value: mvQ.abs, unit: "points", metricId: "quarter_vs_previous", note: both.length ? `Compared over the ${both.length} BU${both.length === 1 ? "" : "s"} scored in both quarters` : "No BU has a score in both quarters", tone: mvQ.abs === null ? "neutral" : mvQ.abs >= 0 ? "good" : "bad" },
    { label: "Reporting compliance", value: pct(compliant, comp.length), unit: "%", metricId: "compliance_rate", note: `${compliant} of ${comp.length} finalised BU-weeks`, tone: "neutral" },
    { label: "Missing reports", value: comp.length - compliant, unit: "BU-weeks", metricId: "missing_reports", tone: comp.length - compliant ? "warn" : "good" },
    { label: "Scores still provisional", value: provisional, unit: "BUs", metricId: "quarterly_score", note: "Provisional until the quarter is locked and every week finalised and reviewed" },
  ];
  const charts: ChartSpec[] = [{
    id: "org-trend", kind: "line", title: "Average of BU weekly scores", unit: "points", yMin: 0, yMax: 100,
    series: [{ name: "Average of BU scores", points: rows.map((r) => ({ x: r.week_short as string, label: r.week as string, y: r.mean_score as number | null })) },
             { name: "Lowest BU", points: rows.map((r) => ({ x: r.week_short as string, label: r.week as string, y: r.min_score as number | null })) },
             { name: "Highest BU", points: rows.map((r) => ({ x: r.week_short as string, label: r.week as string, y: r.max_score as number | null })) }],
    caption: "Weeks not yet finalised and holiday weeks are left blank, never plotted as zero.",
  }];
  const notes = ["The average of BU scores is a summary of the visible BUs. The application defines no official organisation-level score."];
  return done({ ...c, summary, charts }, qLabel(q), [
    { key: "week", label: "Week", type: "text" }, { key: "state", label: "State", type: "status" },
    { key: "bus_scored", label: "BUs scored", type: "number" }, { key: "mean_score", label: "Average score", type: "number", metricId: "org_mean_bu_score" },
    { key: "min_score", label: "Lowest", type: "number" }, { key: "max_score", label: "Highest", type: "number" },
    { key: "movement", label: "Movement", type: "number", metricId: "score_movement", hint: "points vs previous scored week" },
    { key: "compliant", label: "Compliant", type: "number", metricId: "compliance_rate" }, { key: "non_compliant", label: "Missing", type: "number", metricId: "missing_reports" },
  ], rows, { notes });
}

// ---------------------------------------------------------------- 2. BU scorecard
function cumulativeMeans(rows: WeeklyRow[], throughIndex: number) {
  const weeks = [...new Set(rows.filter(isScored).map((r) => r.reporting_week_id))];
  const use = new Set(weeks.slice(0, throughIndex + 1));
  const m = byBu(rows.filter((r) => isScored(r) && use.has(r.reporting_week_id)));
  const out = new Map<string, number>();
  for (const [id, rs] of m) out.set(id, mean(rs.map((r) => Number(r.final_score)))!);
  return { out, weeks };
}

async function buScorecard(c: Ctx) {
  const q = c.q!;
  const [weekly, quarter] = await Promise.all([
    rpcRows<WeeklyRow>("read_report_weekly_scores", { p_quarter_id: q.id, p_bu: c.buId ?? null }),
    rpcRows<QuarterRow>("read_report_quarter_scores", { p_quarter_id: q.id }),
  ]);
  const quarterRows = c.buId ? quarter.filter((r) => r.business_unit_id === c.buId) : quarter;
  const scoredWeeks = [...new Set(weekly.filter(isScored).sort((a, b) => a.week_start_at.localeCompare(b.week_start_at)).map((r) => r.reporting_week_id))];
  const last = scoredWeeks.length - 1;
  const now = cumulativeMeans(weekly, last);
  const before = last >= 1 ? cumulativeMeans(weekly, last - 1) : null;
  const buIds = quarterRows.map((r) => r.business_unit_id);
  const rankNow = rankDescending(buIds.map((id) => quarterRows.find((r) => r.business_unit_id === id)!.score as number | null));
  const rankBeforeArr = before ? rankDescending(buIds.map((id) => before.out.get(id) ?? null)) : null;
  const rankNowCum = rankDescending(buIds.map((id) => now.out.get(id) ?? null));
  const grouped = byBu(weekly);
  const rows = quarterRows.map((r, i) => {
    const rs = grouped.get(r.business_unit_id) ?? [];
    const scored = rs.filter(isScored).sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));
    const lastScore = scored.length ? num(scored[scored.length - 1].final_score) : null;
    const prevScore = scored.length > 1 ? num(scored[scored.length - 2].final_score) : null;
    const comp = rs.filter((x) => x.compliance_status);
    const compliant = comp.filter((x) => x.compliance_status === "COMPLIANT").length;
    const qoq = change(num(r.score), num(r.previous_score));
    return {
      rank: rankNow[i], business_unit: r.business_unit, score: num(r.score), status: r.score === null ? "No score yet" : r.calculation_status === "FINAL" ? "Final" : "Provisional",
      previous_score: num(r.previous_score), qoq_change: qoq.abs, last_week_score: lastScore, wow_change: change(lastScore, prevScore).abs,
      rank_movement: rankBeforeArr && rankBeforeArr[i] !== null && rankNowCum[i] !== null ? rankBeforeArr[i]! - rankNowCum[i]! : null,
      compliance_rate: pct(compliant, comp.length), missing_reports: comp.length - compliant, versions: r.versions,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const best = rows[0]; const scored = rows.filter((r) => r.score !== null);
  const summary: SummaryItem[] = [
    { label: "BUs with a score", value: scored.length, unit: `of ${rows.length}`, metricId: "quarterly_score" },
    { label: "Highest quarterly score", value: best?.score ?? null, unit: "points", note: best?.score !== null && best ? best.business_unit : undefined, metricId: "quarterly_score" },
    { label: "Spread (highest − lowest)", value: scored.length > 1 ? round(Number(scored[0].score) - Number(scored[scored.length - 1].score)) : null, unit: "points" },
  ];
  const charts: ChartSpec[] = [{ id: "bu-bars", kind: "bar", title: "Quarterly score by BU", unit: "points", yMin: 0, yMax: 100,
    series: [{ name: "This quarter", points: rows.map((r) => ({ x: r.business_unit, y: r.score })) }, { name: "Previous quarter", points: rows.map((r) => ({ x: r.business_unit, y: r.previous_score })) }] }];
  const notes = ["Rank alone does not show direction. Read it with the change columns. Rank movement compares the cumulative average of finalised weeks before and after the latest week."];
  if (scored.some((r) => r.status === "Provisional")) notes.push("Provisional scores are still rising as weeks are finalised; compare BUs, not this quarter's number with a finished quarter.");
  return done({ ...c, summary, charts }, qLabel(q), [
    { key: "rank", label: "Rank", type: "number", metricId: "rank" }, { key: "business_unit", label: "Business Unit", type: "text" },
    { key: "score", label: "Quarter score", type: "number", metricId: "quarterly_score" }, { key: "status", label: "Status", type: "status" },
    { key: "previous_score", label: "Previous quarter", type: "number" }, { key: "qoq_change", label: "Quarter change", type: "number", metricId: "quarter_vs_previous", hint: "points" },
    { key: "last_week_score", label: "Latest week", type: "number", metricId: "weekly_score" }, { key: "wow_change", label: "Week change", type: "number", metricId: "score_movement", hint: "points" },
    { key: "rank_movement", label: "Rank movement", type: "number", metricId: "rank_movement", hint: "+ = moved up" },
    { key: "compliance_rate", label: "Compliance", type: "percent", metricId: "compliance_rate" }, { key: "missing_reports", label: "Missing", type: "number", metricId: "missing_reports" },
    { key: "versions", label: "Score versions", type: "number" },
  ], rows, { notes });
}

// ---------------------------------------------------------------- 3. weekly trends
async function trends(c: Ctx) {
  const q = c.q!;
  const weekly = await rpcRows<WeeklyRow>("read_report_weekly_scores", { p_quarter_id: q.id, p_bu: c.buId ?? null });
  const grouped = byBu(weekly);
  const rows: Record<string, unknown>[] = [];
  for (const [, rs] of grouped) {
    let prev: number | null = null;
    for (const r of rs.sort((a, b) => a.week_start_at.localeCompare(b.week_start_at))) {
      if (new Date(r.week_start_at) > new Date(c.generatedAt)) continue;   // not started yet: no row (the chart still shows the quarter's full span)
      const scored = isScored(r);
      const score = scored ? num(r.final_score) : null;
      rows.push({ week: weekLabel(r), week_start_at: r.week_start_at, business_unit: r.business_unit, state: r.result_state === "HOLIDAY" ? "Holiday" : r.result_state === "PENDING" ? "Not finalised" : r.result_state === "NOT_SUBMITTED" ? "Missing report" : "Scored",
        score, movement: change(score, prev).abs, snapshot_version: r.snapshot_version });
      if (score !== null) prev = score;
    }
  }
  rows.sort((a, b) => String(a.week_start_at).localeCompare(String(b.week_start_at)) || String(a.business_unit).localeCompare(String(b.business_unit)));
  const ids = [...grouped.keys()].slice(0, 12);
  const declining = [...grouped.values()].filter((rs) => { const s = rs.filter(isScored).map((x) => Number(x.final_score)); const r = linearRegression(s.slice(-6).map((y, i) => ({ x: i, y }))); return r && r.slope < -2; }).length;
  const summary: SummaryItem[] = [
    { label: "BUs shown", value: grouped.size }, { label: "BUs with a downward trend", value: declining, note: "Slope below −2 points per week over the last 6 scored weeks", tone: declining ? "warn" : "good" },
  ];
  const charts: ChartSpec[] = [{ id: "bu-lines", kind: "line", title: "Weekly score by BU", unit: "points", yMin: 0, yMax: 100, series: weeklyLineSeries(weekly, ids),
    caption: ids.length < grouped.size ? `Showing the first ${ids.length} BUs; the table has all of them.` : undefined }];
  return done({ ...c, summary, charts }, qLabel(q), [
    { key: "week", label: "Week", type: "text" }, { key: "business_unit", label: "Business Unit", type: "text" }, { key: "state", label: "State", type: "status" },
    { key: "score", label: "Weekly score", type: "number", metricId: "weekly_score" }, { key: "movement", label: "Movement", type: "number", metricId: "score_movement", hint: "points vs previous scored week" },
    { key: "snapshot_version", label: "Score version", type: "number", hint: ">1 means a correction or amendment was applied" },
  ], rows);
}

// ---------------------------------------------------------------- 4. forecast
async function forecastReport(c: Ctx) {
  const q = c.q!;
  const [weekly, quarter] = await Promise.all([
    rpcRows<WeeklyRow>("read_report_weekly_scores", { p_quarter_id: q.id, p_bu: c.buId ?? null }),
    rpcRows<QuarterRow>("read_report_quarter_scores", { p_quarter_id: q.id }),
  ]);
  const grouped = byBu(weekly);
  const rows: Record<string, unknown>[] = [];
  const notes: string[] = [];
  let chartSeries: ChartSpec | null = null;
  for (const qr of c.buId ? quarter.filter((x) => x.business_unit_id === c.buId) : quarter) {
    const rs = (grouped.get(qr.business_unit_id) ?? []).sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));
    const scores = rs.filter(isScored).map((r) => Number(r.final_score));
    const eligible = rs.filter((r) => r.reporting_state === "NORMAL").length;
    const denominator = qr.denominator_count ?? eligible;
    const sum = scores.reduce((a, b) => a + b, 0);
    const f = projectQuarterEnd({ weeklyScores: scores, denominator });
    const reconciles = qr.numerator === null || Math.abs(Number(qr.numerator) - sum) < 0.011;
    if (!reconciles) notes.push(`${qr.business_unit}: weekly scores sum to ${round(sum)} but the quarterly snapshot numerator is ${qr.numerator}. The snapshot is the official figure; check data quality.`);
    rows.push({
      business_unit: qr.business_unit, scored_weeks: scores.length, eligible_weeks: denominator, official_score: num(qr.score), status: qr.calculation_status ?? "—",
      projection_status: f.status === "OK" ? "Projection" : f.status === "COMPLETE" ? "Final" : "Not enough history",
      projected: f.status === "OK" ? f.projected : null, low: f.status === "OK" ? f.low : null, high: f.status === "OK" ? f.high : null,
      method: f.method === "TREND" ? "Fitted trend" : f.method === "MEAN" ? "Average of scored weeks" : "—",
      backtest_error: f.backtest.points < 3 ? null : f.method === "TREND" ? f.backtest.maeTrend : f.method === "MEAN" ? f.backtest.maeMean : null,   // unmeasured below 3 held-out weeks
      floor_if_zero: denominator ? scenarioQuarterEnd(sum, denominator, f.weeksRemaining, 0) : null,
      ceiling_if_perfect: denominator ? scenarioQuarterEnd(sum, denominator, f.weeksRemaining, 100) : null,
      note: f.limitations[0] ?? "",
    });
    if (!chartSeries && f.status === "OK") {
      let run = 0;
      const actual = scores.map((s, i) => { run += s; return { x: `W${i + 1}`, label: `Week ${i + 1} of the quarter`, y: round(run / denominator), kind: "actual" as const }; });
      const proj = f.cumulative.map((p, i) => ({ x: `W${scores.length + i + 1}`, y: p.score, low: p.low, high: p.high, kind: "projected" as const }));
      chartSeries = { id: "forecast", kind: "forecast", title: `${qr.business_unit}: official score to date and projected finish`, unit: "points", yMin: 0, yMax: 100,
        series: [{ name: "Official score to date", points: actual }, { name: "Projection (95% range)", points: [actual[actual.length - 1], ...proj] }],
        caption: "Solid line: actual. Dashed line and band: projection. The projection is not a result." };
    }
  }
  const ok = rows.filter((r) => r.projection_status === "Projection").length;
  const summary: SummaryItem[] = [
    { label: "BUs with a projection", value: ok, unit: `of ${rows.length}`, metricId: "forecast_quarter_score" },
    { label: "Weeks needed before a projection", value: 4, note: "Fewer scored weeks gives “not enough history”, never a guess" },
  ];
  notes.unshift("Projected values are estimates, shown separately from the official score. They assume remaining weeks look like the weeks scored so far and do not predict holidays, amendments, corrections or penalties. Floor and ceiling are pure arithmetic bounds, not forecasts.");
  return done({ ...c, summary, charts: chartSeries ? [chartSeries] : [] }, qLabel(q), [
    { key: "business_unit", label: "Business Unit", type: "text" }, { key: "scored_weeks", label: "Scored weeks", type: "number" }, { key: "eligible_weeks", label: "Eligible weeks", type: "number" },
    { key: "official_score", label: "Official score now", type: "number", metricId: "quarterly_score" }, { key: "status", label: "Official status", type: "status" },
    { key: "projection_status", label: "Projection", type: "status" }, { key: "projected", label: "Projected finish", type: "number", metricId: "forecast_quarter_score" },
    { key: "low", label: "95% low", type: "number" }, { key: "high", label: "95% high", type: "number" }, { key: "method", label: "Method", type: "text" },
    { key: "backtest_error", label: "Back-test error", type: "number", hint: "mean absolute error, points" },
    { key: "floor_if_zero", label: "Floor (all 0)", type: "number" }, { key: "ceiling_if_perfect", label: "Ceiling (all 100)", type: "number" }, { key: "note", label: "Limitation", type: "text" },
  ], rows, { notes, dataStatus: ok === 0 && rows.length ? "PARTIAL" : "COMPLETE" });
}

// ---------------------------------------------------------------- 5. compliance by BU
async function complianceReport(c: Ctx) {
  const q = c.q!;
  const weekly = await rpcRows<WeeklyRow>("read_report_weekly_scores", { p_quarter_id: q.id, p_bu: c.buId ?? null });
  const mk = (name: string, rs: WeeklyRow[]) => {
    const due = rs.filter((r) => r.reporting_state === "NORMAL" && r.week_status === "FINAL_LOCKED");
    const compliant = due.filter((r) => r.compliance_status === "COMPLIANT").length;
    const non = due.filter((r) => r.compliance_status === "NON_COMPLIANT").length;
    const submitted = due.filter((r) => r.submission_status === "SUBMITTED");
    const reviewed = submitted.filter((r) => r.review_status === "REVIEWED").length;
    const early = due.filter((r) => r.submitted_before_content_lock).length;
    return {
      business_unit: name, due_weeks: due.length, compliant, non_compliant: non, compliance_rate: pct(compliant, compliant + non),
      early_rate: pct(early, due.length), review_rate: pct(reviewed, submitted.length),
      holiday_weeks: rs.filter((r) => r.reporting_state === "ORGANIZATION_HOLIDAY").length, pending_weeks: rs.filter((r) => r.reporting_state === "NORMAL" && r.week_status !== "FINAL_LOCKED").length,
      late_open: rs.filter((r) => r.late_exception_status === "AUTHORISED" || r.late_exception_status === "SUBMITTED").length,
      late_applied: rs.filter((r) => r.late_exception_status === "APPLIED").length,
    };
  };
  const grouped = byBu(weekly);
  const rows = [...grouped.values()].map((rs) => mk(rs[0].business_unit, rs)).sort((a, b) => (a.compliance_rate ?? 101) - (b.compliance_rate ?? 101));
  const all = mk("All Business Units", weekly);
  if (rows.length > 1) rows.push(all);
  const summary: SummaryItem[] = [
    { label: "Compliance rate", value: all.compliance_rate, unit: "%", metricId: "compliance_rate", note: `${all.compliant} compliant of ${all.compliant + all.non_compliant} finalised BU-weeks`, tone: all.compliance_rate === null ? "neutral" : all.compliance_rate >= 90 ? "good" : all.compliance_rate >= 70 ? "warn" : "bad" },
    { label: "Missing reports", value: all.non_compliant, unit: "BU-weeks", metricId: "missing_reports" },
    { label: "Late-report exceptions open / applied", value: `${all.late_open} / ${all.late_applied}`, metricId: "late_exceptions", note: "Exceptions never turn a missed week into a compliant one" },
    { label: "Review rate", value: all.review_rate, unit: "%", metricId: "review_rate" },
  ];
  const charts: ChartSpec[] = [{ id: "comp-bars", kind: "bar", title: "Compliance rate by BU", unit: "%", yMin: 0, yMax: 100,
    series: [{ name: "Compliance rate", points: rows.filter((r) => r.business_unit !== "All Business Units").map((r) => ({ x: r.business_unit, y: r.compliance_rate })) }] }];
  return done({ ...c, summary, charts }, qLabel(q), [
    { key: "business_unit", label: "Business Unit", type: "text" }, { key: "due_weeks", label: "Finalised weeks due", type: "number" },
    { key: "compliant", label: "Compliant", type: "number" }, { key: "non_compliant", label: "Non-compliant", type: "number", metricId: "missing_reports" },
    { key: "compliance_rate", label: "Compliance rate", type: "percent", metricId: "compliance_rate" }, { key: "early_rate", label: "Before content lock", type: "percent", metricId: "early_submission_rate", hint: "pending approval" },
    { key: "review_rate", label: "Reviewed", type: "percent", metricId: "review_rate" }, { key: "holiday_weeks", label: "Holiday weeks (excluded)", type: "number" },
    { key: "pending_weeks", label: "Not yet finalised", type: "number" }, { key: "late_open", label: "Late exceptions open", type: "number", metricId: "late_exceptions" },
    { key: "late_applied", label: "Late exceptions applied", type: "number", metricId: "late_exceptions" },
  ], rows, { notes: ["Holiday weeks and weeks before a BU existed are not in the denominator. Weeks not yet finalised are not counted either way."] });
}

// ---------------------------------------------------------------- 6. register
async function register(c: Ctx) {
  const q = c.q!;
  const weekly = await rpcRows<WeeklyRow>("read_report_weekly_scores", { p_quarter_id: q.id, p_bu: c.buId ?? null });
  const opened = weekly.filter((r) => new Date(r.week_start_at) <= new Date(c.generatedAt));   // weeks that have not started yet are not part of the register
  const rows = opened.map((r) => ({
    week: weekLabel(r), week_start_at: r.week_start_at, business_unit: r.business_unit,
    result: r.result_state === "HOLIDAY" ? "Holiday (not required)" : r.result_state === "PENDING" ? "Not finalised" : r.result_state === "NOT_SUBMITTED" ? "No report" : "Scored",
    submitted_at: r.submitted_at, before_content_lock: r.submitted_before_content_lock === null ? null : r.submitted_before_content_lock ? "Yes" : "No",
    compliance: r.compliance_status ? (r.compliance_status === "COMPLIANT" ? "Compliant" : "Non-compliant") : "—",
    review: r.submission_status === "SUBMITTED" ? (r.review_status === "REVIEWED" ? "Reviewed" : "Not reviewed") : "—",
    late_exception: r.late_exception_status ?? "—", score: num(r.final_score), report: r.weekly_report_id ? `/weekly/${r.weekly_report_id}` : null,
  })).sort((a, b) => String(b.week_start_at).localeCompare(String(a.week_start_at)) || String(a.business_unit).localeCompare(String(b.business_unit)));
  return done({ ...c, summary: [{ label: "Rows", value: rows.length }] }, qLabel(q), [
    { key: "week", label: "Week", type: "text" }, { key: "business_unit", label: "Business Unit", type: "text" }, { key: "result", label: "Result", type: "status" },
    { key: "submitted_at", label: "Submitted", type: "datetime" }, { key: "before_content_lock", label: "Before content lock", type: "text" },
    { key: "compliance", label: "Compliance", type: "status", metricId: "compliance_rate" }, { key: "review", label: "Review", type: "status" },
    { key: "late_exception", label: "Late exception", type: "status", metricId: "late_exceptions" }, { key: "score", label: "Score", type: "number", metricId: "weekly_score" },
    { key: "report", label: "Report", type: "link" },
  ], rows);
}

// ---------------------------------------------------------------- 7. late-report register
async function lateRegister(c: Ctx) {
  const items = await rpcRows<{ id: string; status: string; reason: string; authorised_at: string; authorised_by: string; business_unit_id: string; business_unit: string; week_number: number; week_year: number; week_start_at: string;
    submitted_at: string | null; review_status: string | null; applied_at: string | null; revoke_reason: string | null; weekly_report_id: string | null;
    amendment: { old_weekly_score: number; new_weekly_score: number; old_quarterly_score: number | null; new_quarterly_score: number | null; quarter_locked: boolean } | null }>("read_late_report_exceptions", {});
  const list = c.buId ? items.filter((i) => i.business_unit_id === c.buId) : items;
  const rows = list.map((i) => ({
    business_unit: i.business_unit, week: weekLabel(i), stage: i.status === "APPLIED" ? "Score amended" : i.status === "REVOKED" ? "Closed" : i.status === "SUBMITTED" ? "Submitted, awaiting review/apply" : "Authorised, awaiting report",
    authorised_by: i.authorised_by, authorised_at: i.authorised_at, submitted_at: i.submitted_at, review: i.review_status ?? "—", applied_at: i.applied_at,
    weekly_before: i.amendment?.old_weekly_score ?? null, weekly_after: i.amendment?.new_weekly_score ?? null,
    quarterly_before: i.amendment?.old_quarterly_score ?? null, quarterly_after: i.amendment?.new_quarterly_score ?? null,
    quarter_locked: i.amendment ? (i.amendment.quarter_locked ? "Yes" : "No") : "—", reason: i.reason, report: i.weekly_report_id ? `/weekly/${i.weekly_report_id}` : null,
  }));
  const count = (s: string) => list.filter((i) => i.status === s).length;
  const summary: SummaryItem[] = [
    { label: "Authorised", value: count("AUTHORISED"), metricId: "late_exceptions" }, { label: "Submitted", value: count("SUBMITTED"), metricId: "late_exceptions" },
    { label: "Score amended", value: count("APPLIED"), metricId: "late_exceptions" }, { label: "Closed without amendment", value: count("REVOKED") },
  ];
  return done({ ...c, summary }, "All periods", [
    { key: "business_unit", label: "Business Unit", type: "text" }, { key: "week", label: "Week", type: "text" }, { key: "stage", label: "Stage", type: "status" },
    { key: "authorised_by", label: "Authorised by", type: "text" }, { key: "authorised_at", label: "Authorised", type: "datetime" }, { key: "submitted_at", label: "Submitted", type: "datetime" },
    { key: "review", label: "Review", type: "status" }, { key: "applied_at", label: "Applied", type: "datetime" },
    { key: "weekly_before", label: "Weekly before", type: "number" }, { key: "weekly_after", label: "Weekly after", type: "number" },
    { key: "quarterly_before", label: "Quarter before", type: "number" }, { key: "quarterly_after", label: "Quarter after", type: "number" },
    { key: "quarter_locked", label: "Quarter locked", type: "text" }, { key: "reason", label: "Reason", type: "text" }, { key: "report", label: "Report", type: "link" },
  ], rows, { notes: ["Applying an exception adds new score versions. The week's compliance determination is not changed by it."] });
}

// ---------------------------------------------------------------- 8. OKR health
async function okrHealth(c: Ctx) {
  const q = c.q!;
  const data = await rpcRows<KrRow>("read_report_kr_execution", { p_quarter_id: q.id });
  const groups = new Map<string, KrRow[]>();
  for (const r of data) (groups.get(r.sub_key_result_id) ?? groups.set(r.sub_key_result_id, []).get(r.sub_key_result_id)!).push(r);
  const series: ChartSeries[] = [];
  const rows = [...groups.values()].map((rs) => {
    rs.sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));
    let mapped = 0, doneN = 0;
    const cum = rs.map((r) => { mapped += r.mapped_goals; doneN += r.done_goals; return { week: r.week_number, start: r.week_start_at, mapped, done: doneN, exec: mapped ? (doneN * 100) / mapped : null }; });
    const withGoals = cum.filter((x) => x.exec !== null).slice(-6);
    const reg = withGoals.length >= 3 ? linearRegression(withGoals.map((x, i) => ({ x: i, y: x.exec as number }))) : null;
    const trend = mapped === 0 ? "No goals mapped" : !reg ? "Not enough history" : reg.slope > 2 ? "Improving" : reg.slope < -2 ? "Declining" : "Steady";
    series.push({ name: `${rs[0].sub_code}`, points: cum.map((x) => ({ x: `W${x.week}`, label: weekLabel({ week_number: x.week, week_start_at: x.start }), y: x.exec === null ? null : round(x.exec) })) });
    return { kr: `${rs[0].kr_code} ${rs[0].kr_title}`, sub_kr: `${rs[0].sub_code} ${rs[0].sub_title}`, mapped_goals: mapped, done_goals: doneN,
      execution: mapped ? round((doneN * 100) / mapped) : null, trend, slope: reg ? round(reg.slope) : null };
  });
  const withData = rows.filter((r) => r.execution !== null);
  const summary: SummaryItem[] = [
    { label: "Sub-KRs", value: rows.length }, { label: "With no goals mapped", value: rows.length - withData.length, tone: rows.length - withData.length ? "warn" : "good", note: "Nothing is being reported against these" },
    { label: "Declining", value: rows.filter((r) => r.trend === "Declining").length, metricId: "sub_kr_trend", tone: rows.some((r) => r.trend === "Declining") ? "bad" : "good" },
  ];
  const charts: ChartSpec[] = [{ id: "kr-lines", kind: "line", title: "Cumulative Sub-KR execution", unit: "%", yMin: 0, yMax: 100, series, caption: "Share of mapped goals fully done, accumulated week by week." }];
  return done({ ...c, summary, charts }, qLabel(q), [
    { key: "kr", label: "Key result", type: "text" }, { key: "sub_kr", label: "Sub-KR", type: "text" }, { key: "mapped_goals", label: "Goals mapped", type: "number" },
    { key: "done_goals", label: "Goals done", type: "number" }, { key: "execution", label: "Execution", type: "percent", metricId: "sub_kr_execution" },
    { key: "trend", label: "Trend", type: "status", metricId: "sub_kr_trend" }, { key: "slope", label: "Slope", type: "number", hint: "points per week" },
  ], rows, { notes: ["Execution is goals done over goals mapped, in submitted final-locked reports. Key results have no numeric target in the application, so target-versus-actual attainment is not available."] });
}

// ---------------------------------------------------------------- 9. governance
async function governance(c: Ctx) {
  const items = await rpcRows<GovernanceItem>("read_report_governance_items", {});
  const cats = [...new Set(items.map((i) => i.category))];
  const label: Record<string, string> = { ATTENDANCE_AMENDMENT: "Attendance amendments", DISBURSEMENT: "Disbursement requests", LATE_REPORT: "Late-report exceptions", REPORT_REVIEW: "Reports awaiting review", FINAL_LOCK_PENDING: "Weeks awaiting finalisation" };
  const rows = items.map((i) => ({ priority: i.priority, category: label[i.category] ?? i.category, item: i.title, status: i.status.replaceAll("_", " ").toLowerCase(), since: i.since, age_days: i.age_days, owner: i.owner ?? "—", open: i.path }));
  const high = items.filter((i) => i.priority === "HIGH").length;
  const summary: SummaryItem[] = [
    { label: "Items needing attention", value: items.length, tone: items.length ? "warn" : "good" }, { label: "High priority (over 7 days)", value: high, metricId: "governance_age", tone: high ? "bad" : "good" },
    { label: "Oldest item", value: items.length ? Math.max(...items.map((i) => i.age_days)) : 0, unit: "days" },
  ];
  const charts: ChartSpec[] = [{ id: "gov-bars", kind: "bar", title: "Outstanding items by type", unit: "items", series: [{ name: "Items", points: cats.map((k) => ({ x: label[k] ?? k, y: items.filter((i) => i.category === k).length })) }] }];
  return done({ ...c, summary, charts }, "Now", [
    { key: "priority", label: "Priority", type: "status", metricId: "governance_age" }, { key: "category", label: "Type", type: "text" }, { key: "item", label: "Item", type: "text" },
    { key: "status", label: "Status", type: "status" }, { key: "since", label: "Since", type: "datetime" }, { key: "age_days", label: "Age (days)", type: "number" },
    { key: "owner", label: "Raised by / unit", type: "text" }, { key: "open", label: "Open", type: "link" },
  ], rows, { notes: ["Only items you are allowed to see are listed. Priority bands are a proposed default pending approval; no service-level targets exist in the application. Session-outcome corrections and ledger reversals will appear here once those workflows exist."] });
}

// ---------------------------------------------------------------- 10. integrity corrections
async function integrity(c: Ctx) {
  const q = c.q!;
  const items = await rpcRows<{ id: string; created_at: string; business_unit: string; week_number: number; week_year: number; week_start_at: string; from_status: string; to_status: string;
    penalty_decision: string; penalty_rate: number | null; reason: string; actor: string | null; weekly_report_id: string; score_before: number | null }>("read_report_integrity", { p_quarter_id: q.id, p_bu: c.buId ?? null });
  const rows = items.map((i) => ({ created_at: i.created_at, business_unit: i.business_unit, week: weekLabel(i), change: `${i.from_status.replace("_", " ").toLowerCase()} → ${i.to_status.replace("_", " ").toLowerCase()}`,
    decision: i.penalty_decision === "APPLY" ? "Penalty applied" : i.penalty_decision === "WAIVE" ? "Penalty waived" : "No penalty", rate: i.penalty_rate === null ? null : round(Number(i.penalty_rate) * 100),
    score_before: num(i.score_before), by: i.actor ?? "—", reason: i.reason, report: `/weekly/${i.weekly_report_id}` }));
  const perBu = new Map<string, number>(); items.forEach((i) => perBu.set(i.business_unit, (perBu.get(i.business_unit) ?? 0) + 1));
  const summary: SummaryItem[] = [
    { label: "Corrections", value: items.length, metricId: "integrity_corrections" }, { label: "Penalties applied", value: items.filter((i) => i.penalty_decision === "APPLY").length },
    { label: "Penalties waived", value: items.filter((i) => i.penalty_decision === "WAIVE").length },
  ];
  const charts: ChartSpec[] = [{ id: "ic-bars", kind: "bar", title: "Corrections by BU", unit: "corrections", series: [{ name: "Corrections", points: [...perBu].map(([x, y]) => ({ x, y })) }] }];
  return done({ ...c, summary, charts }, qLabel(q), [
    { key: "created_at", label: "When", type: "datetime" }, { key: "business_unit", label: "Business Unit", type: "text" }, { key: "week", label: "Week", type: "text" },
    { key: "change", label: "Task status change", type: "text" }, { key: "decision", label: "Penalty decision", type: "status" }, { key: "rate", label: "Rate", type: "percent" },
    { key: "score_before", label: "Weekly score before", type: "number" }, { key: "by", label: "By", type: "text" }, { key: "reason", label: "Reason", type: "text" }, { key: "report", label: "Report", type: "link" },
  ], rows, { notes: ["A correction is not evidence of wrongdoing; honest errors are corrected here too."] });
}

// ---------------------------------------------------------------- 11. holidays
async function holidays(c: Ctx) {
  const q = c.q!;
  const items = await rpcRows<{ reporting_week_id: string; week_number: number; week_year: number; week_start_at: string; week_status: string; reporting_state: string; state_changes: number; latest_reason: string | null; post_lock_amendments: number }>("read_report_holidays", { p_quarter_id: q.id });
  const rows = items.map((i) => ({ week: weekLabel(i), starts: i.week_start_at, current_state: i.reporting_state === "ORGANIZATION_HOLIDAY" ? "Holiday (excluded from scores)" : "Normal reporting week",
    week_status: i.week_status === "FINAL_LOCKED" ? "Final locked" : "Open or scheduled", changes: i.state_changes, amendments: i.post_lock_amendments, latest_reason: i.latest_reason ?? "—" }));
  const summary: SummaryItem[] = [
    { label: "Holiday weeks now", value: items.filter((i) => i.reporting_state === "ORGANIZATION_HOLIDAY").length }, { label: "Post-lock amendments", value: items.reduce((a, i) => a + i.post_lock_amendments, 0) },
  ];
  return done({ ...c, summary }, qLabel(q), [
    { key: "week", label: "Week", type: "text" }, { key: "starts", label: "Starts", type: "date" }, { key: "current_state", label: "Current state", type: "status" }, { key: "week_status", label: "Lock state", type: "status" },
    { key: "changes", label: "State changes", type: "number" }, { key: "amendments", label: "Post-lock amendments", type: "number" }, { key: "latest_reason", label: "Latest reason", type: "text" },
  ], rows, { notes: ["Holiday weeks leave both the numerator and the denominator of the quarterly score."] });
}

// ---------------------------------------------------------------- 12. fund actuals
async function fund(c: Ctx) {
  const today = (await serverNow()).slice(0, 10);
  const to = c.params.to ?? today;
  const from = c.params.from ?? new Date(new Date(to).getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const [months, disb] = await Promise.all([
    rpcRows<{ month: string; credits: string; debits: string; net: string; closing_balance: string; ledger_entries: number; violations_raised: number; fines_raised: string }>("read_report_finance", { p_from: from, p_to: to }),
    rpcRows<{ status: string; requests: number; amount: string }>("read_report_disbursement_status", {}),
  ]);
  const rows = months.map((m) => ({ month: m.month, credits: num(m.credits), debits: num(m.debits), net: num(m.net), closing_balance: num(m.closing_balance), ledger_entries: m.ledger_entries, violations_raised: m.violations_raised, fines_raised: num(m.fines_raised) }));
  const credits = rows.reduce((a, r) => a + (r.credits ?? 0), 0), debits = rows.reduce((a, r) => a + (r.debits ?? 0), 0);
  const summary: SummaryItem[] = [
    { label: "Closing balance", value: rows.length ? rows[rows.length - 1].closing_balance : null, unit: "NGN", metricId: "ledger_balance" },
    { label: "Credits in period", value: round(credits), unit: "NGN" }, { label: "Debits in period", value: round(debits), unit: "NGN" },
    ...disb.map((d) => ({ label: `Disbursement requests ${d.status.replace("_", " ").toLowerCase()}`, value: d.requests, note: `NGN ${Number(d.amount).toLocaleString("en-NG")}` })),
  ];
  const charts: ChartSpec[] = [{ id: "fund-bars", kind: "bar", title: "Fund movement by month", unit: "NGN",
    series: [{ name: "Credits", points: rows.map((r) => ({ x: String(r.month).slice(0, 7), y: r.credits })) }, { name: "Debits", points: rows.map((r) => ({ x: String(r.month).slice(0, 7), y: r.debits })) }] }];
  return done({ ...c, summary, charts }, `${from} to ${to}`, [
    { key: "month", label: "Month", type: "date" }, { key: "credits", label: "Credits", type: "money", metricId: "ledger_balance" }, { key: "debits", label: "Debits", type: "money" },
    { key: "net", label: "Net", type: "money" }, { key: "closing_balance", label: "Closing balance", type: "money", metricId: "ledger_balance" },
    { key: "ledger_entries", label: "Ledger entries", type: "number" }, { key: "violations_raised", label: "Violations raised", type: "number" }, { key: "fines_raised", label: "Fines raised", type: "money" },
  ], rows, { notes: ["Actuals only, in NGN. The application holds no budget, projection or revenue data, so projection-versus-actual and variance analysis are not available."] });
}

// ---------------------------------------------------------------- 13. data quality
async function dataQuality(c: Ctx) {
  const q = c.q!;
  const checks = await rpcRows<{ check: string; severity: string; count: number; detail: string }>("read_report_data_quality", { p_quarter_id: q.id });
  const rows = checks.map((k) => ({ severity: k.severity, check: k.check, count: k.count, detail: k.detail }));
  const bad = checks.filter((k) => k.severity === "CRITICAL" || k.severity === "WARNING").length;
  return done({ ...c, summary: [{ label: "Checks needing attention", value: bad, tone: bad ? "warn" : "good" }, { label: "Checks run", value: checks.length }] }, qLabel(q),
    [{ key: "severity", label: "Result", type: "status" }, { key: "check", label: "Check", type: "text" }, { key: "count", label: "Count", type: "number" }, { key: "detail", label: "Detail", type: "text" }], rows,
    { dataStatus: bad ? "PARTIAL" : "COMPLETE" });
}

export { REPORTS, reportById };

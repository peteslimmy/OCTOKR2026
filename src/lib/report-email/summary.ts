import { DateTime } from "luxon";
import { BUSINESS_ZONE } from "@/lib/domain/time";
import { deriveFindings, type InsightQuarter, type InsightWeekly } from "@/lib/reports/insights";
import { mean } from "@/lib/reports/stats";
import { previousPeriod, trendWindow, type Period } from "./periods";

/**
 * Turns organisation-wide rows into the figures of one summary (ADR-115). Pure and deterministic: the same rows always give the same
 * summary, every number is a score the scoring engine already wrote, and the words come from the same rules engine as Insights (no AI).
 * Business Unit level only: no person is named and no finance figure is included.
 */
export interface WeeklyRow {
  business_unit_id: string; business_unit: string; week_number: number; week_year: number; week_start_at: string; week_status: string;
  reporting_state: string; result_state: string; final_score: number | string | null; compliance_status: string | null; submitted_before_content_lock: boolean | null;
}
export interface QuarterRow { business_unit_id: string; business_unit: string; score: number | string | null; denominator_count: number | null; previous_score: number | string | null }

export interface SummaryInput {
  period: Period;
  /** Weekly rows from the start of the trend window to the end of the period (also covers the previous period when it falls inside). */
  weekly: WeeklyRow[];
  /** Weekly rows of the previous period. */
  previousWeekly: WeeklyRow[];
  /** Official quarterly rows: one entry per quarter of the period (quarterly: 1, annual: up to 4); empty for weekly and monthly. */
  quarters: QuarterRow[][];
  previousQuarters: QuarterRow[][];
}

export type Movement = "UP" | "DOWN" | "FLAT" | "NEW" | "NONE";
export interface RankedUnit { name: string; score: number | null; previous: number | null; delta: number | null; rank: number | null; movement: Movement }
export interface Summary {
  version: 1;
  frequency: Period["frequency"];
  periodKey: string;
  periodLabel: string;
  start: string;
  end: string;
  empty: boolean;
  headlines: { score: number | null; previousScore: number | null; delta: number | null; units: number; scoredUnits: number; expected: number; onTime: number; onTimePct: number | null; missed: number; holidays: number };
  ranking: RankedUnit[];
  trend: { label: string; value: number | null }[];
  highlights: { top: { name: string; score: number }[]; improved: { name: string; delta: number }[] };
  attention: { name: string; issue: string }[];
  insights: string[];
  previousLabel: string;
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
export const r1 = (n: number) => Math.round(n * 10) / 10;
const scored = (r: WeeklyRow) => r.reporting_state === "NORMAL" && r.week_status === "FINAL_LOCKED" && num(r.final_score) !== null;
export const inRange = (r: WeeklyRow, from: string, to: string) => {
  const d = DateTime.fromISO(r.week_start_at).setZone(BUSINESS_ZONE).toFormat("yyyy-LL-dd");
  return d >= from && d <= to;
};

/** One score per unit for a period: quarterly and annual use the official quarterly scores, weekly and monthly the mean of the scored weeks. */
function unitScores(frequency: Period["frequency"], weekly: WeeklyRow[], quarters: QuarterRow[][]): Map<string, { name: string; score: number | null }> {
  const out = new Map<string, { name: string; score: number | null }>();
  if (frequency === "QUARTERLY" || frequency === "ANNUAL") {
    const per = new Map<string, { name: string; v: number[] }>();
    for (const q of quarters) for (const r of q) {
      const e = per.get(r.business_unit_id) ?? { name: r.business_unit, v: [] };
      const s = num(r.score); if (s !== null) e.v.push(s);
      per.set(r.business_unit_id, e);
    }
    for (const [id, e] of per) out.set(id, { name: e.name, score: mean(e.v) === null ? null : r1(mean(e.v)!) });
    return out;
  }
  const per = new Map<string, { name: string; v: number[] }>();
  for (const r of weekly) {
    const e = per.get(r.business_unit_id) ?? { name: r.business_unit, v: [] };
    if (scored(r)) e.v.push(Number(r.final_score));
    per.set(r.business_unit_id, e);
  }
  for (const [id, e] of per) out.set(id, { name: e.name, score: e.v.length ? r1(mean(e.v)!) : null });
  return out;
}

/** Trend buckets: a week each (weekly), a month each (monthly), a quarter each (quarterly and annual). */
function trendOf(period: Period, weekly: WeeklyRow[]): Summary["trend"] {
  const win = trendWindow(period);
  const buckets = new Map<string, { label: string; v: number[]; sort: string }>();
  for (const r of weekly.filter((x) => inRange(x, win.from, win.to))) {
    const d = DateTime.fromISO(r.week_start_at).setZone(BUSINESS_ZONE);
    let key: string, label: string;
    if (period.frequency === "WEEKLY") { key = d.toFormat("yyyy-LL-dd"); label = `W${r.week_number}`; }
    else if (period.frequency === "MONTHLY") { key = d.toFormat("yyyy-LL"); label = d.toFormat("LLL yyyy"); }
    else { const q = Math.ceil(d.month / 3); key = `${d.year}-${q}`; label = `Q${q} ${d.year}`; }
    const e = buckets.get(key) ?? { label, v: [], sort: key };
    if (scored(r)) e.v.push(Number(r.final_score));
    buckets.set(key, e);
  }
  return [...buckets.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map((b) => ({ label: b.label, value: b.v.length ? r1(mean(b.v)!) : null }));
}

export function buildSummary(input: SummaryInput): Summary {
  const { period } = input;
  const prev = previousPeriod(period);
  const current = input.weekly.filter((r) => inRange(r, period.start, period.end));
  const cur = unitScores(period.frequency, current, input.quarters);
  const before = unitScores(period.frequency, input.previousWeekly, input.previousQuarters);

  const rows: RankedUnit[] = [...cur.entries()].map(([id, c]) => {
    const p = before.get(id)?.score ?? null;
    const delta = c.score !== null && p !== null ? r1(c.score - p) : null;
    const movement: Movement = c.score === null ? "NONE" : p === null ? "NEW" : Math.abs(delta!) < 0.5 ? "FLAT" : delta! > 0 ? "UP" : "DOWN";
    return { name: c.name, score: c.score, previous: p, delta, rank: null, movement };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  let rank = 0;
  for (const u of rows) if (u.score !== null) u.rank = ++rank;

  const scoredRows = rows.filter((u) => u.score !== null);
  const score = scoredRows.length ? r1(mean(scoredRows.map((u) => u.score!))!) : null;
  const prevScored = [...before.values()].filter((u) => u.score !== null);
  const previousScore = prevScored.length ? r1(mean(prevScored.map((u) => u.score!))!) : null;

  // reporting compliance counts only weeks that are over and not holidays
  const due = current.filter((r) => r.reporting_state === "NORMAL" && r.week_status === "FINAL_LOCKED");
  const onTime = due.filter((r) => r.submitted_before_content_lock === true).length;
  const holidays = current.filter((r) => r.reporting_state === "ORGANIZATION_HOLIDAY").length;

  const attention: Summary["attention"] = [];
  const missedBy = new Map<string, number>();
  for (const r of due) if (r.submitted_before_content_lock !== true) missedBy.set(r.business_unit, (missedBy.get(r.business_unit) ?? 0) + 1);
  for (const [name, n] of [...missedBy.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) attention.push({ name, issue: `${n} ${n === 1 ? "week" : "weeks"} without an on-time report` });
  for (const u of rows) if (u.delta !== null && u.delta <= -10) attention.push({ name: u.name, issue: `score down ${Math.abs(u.delta)} points on ${prev.label}` });
  for (const u of rows) if (u.score === null && due.length) attention.push({ name: u.name, issue: "no score for this period" });

  const insightQuarter: InsightQuarter[] = (input.quarters[input.quarters.length - 1] ?? []).map((q) => ({ business_unit: q.business_unit, score: num(q.score), previous_score: num(q.previous_score), denominator_count: q.denominator_count }));
  const findings = deriveFindings({
    period: period.label, orgWide: true, governance: [], quarter: insightQuarter,
    weekly: input.weekly.filter((r) => inRange(r, trendWindow(period).from, period.end)).map((r) => ({ ...r, final_score: num(r.final_score), compliance_status: (r.compliance_status as InsightWeekly["compliance_status"]) ?? null })),
  });
  const rank3 = { ATTENTION: 0, WATCH: 1, INFO: 2 } as const;
  const insights = findings.filter((f) => f.kind !== "RECOMMENDATION").sort((a, b) => rank3[a.severity] - rank3[b.severity]).slice(0, 4).map((f) => f.statement);

  return {
    version: 1, frequency: period.frequency, periodKey: period.key, periodLabel: period.label, start: period.start, end: period.end,
    empty: scoredRows.length === 0 && due.length === 0,
    headlines: { score, previousScore, delta: score !== null && previousScore !== null ? r1(score - previousScore) : null, units: rows.length, scoredUnits: scoredRows.length,
      expected: due.length, onTime, onTimePct: due.length ? r1((onTime * 100) / due.length) : null, missed: due.length - onTime, holidays },
    ranking: rows,
    trend: trendOf(period, input.weekly),
    highlights: {
      top: scoredRows.slice(0, 3).map((u) => ({ name: u.name, score: u.score! })),
      improved: rows.filter((u) => u.delta !== null && u.delta >= 1).sort((a, b) => b.delta! - a.delta!).slice(0, 3).map((u) => ({ name: u.name, delta: u.delta! })),
    },
    attention: attention.slice(0, 8),
    insights,
    previousLabel: prev.label,
  };
}

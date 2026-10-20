import { formatWeekLabel } from "@/lib/domain/week-label";
import { projectQuarterEnd } from "./forecast";
import { linearRegression, mean, round, zScore } from "./stats";

/**
 * Evidence-linked findings from the authoritative report data (ADR-053). This is a deterministic rules engine, NOT a language model:
 * every finding states the numbers it rests on, the comparison baseline and the report where they can be checked. It separates
 * observations from recommendations and never asserts a cause. Anomalies are statistical, not findings of misconduct.
 */
export const INSIGHTS_VERSION = "rules-engine-1.0.0";

export interface InsightWeekly {
  business_unit_id: string; business_unit: string; week_number: number; week_start_at: string; reporting_state: string; week_status: string;
  final_score: number | null; compliance_status: "COMPLIANT" | "NON_COMPLIANT" | null;
}
export interface InsightQuarter { business_unit: string; score: number | null; previous_score: number | null; denominator_count: number | null }
export interface InsightGov { category: string; priority: "HIGH" | "MEDIUM" | "LOW"; age_days: number }

export interface Evidence { label: string; value: string; baseline?: string; period?: string }
export interface Finding {
  id: string;
  kind: "OBSERVATION" | "ANOMALY" | "RECOMMENDATION";
  severity: "INFO" | "WATCH" | "ATTENTION";
  title: string;
  statement: string;
  evidence: Evidence[];
  reportId: string;
  limitations: string[];
}

const scored = (r: InsightWeekly) => r.reporting_state === "NORMAL" && r.week_status === "FINAL_LOCKED" && r.final_score !== null;
const sorted = (rs: InsightWeekly[]) => [...rs].sort((a, b) => a.week_start_at.localeCompare(b.week_start_at));

export function deriveFindings(input: { period: string; weekly: InsightWeekly[]; quarter: InsightQuarter[]; governance: InsightGov[]; orgWide: boolean }): Finding[] {
  const out: Finding[] = [];
  const { period, weekly, quarter, governance } = input;
  const byBu = new Map<string, InsightWeekly[]>();
  for (const r of weekly) (byBu.get(r.business_unit) ?? byBu.set(r.business_unit, []).get(r.business_unit)!).push(r);

  // 1. direction of the average (needs at least 4 scored weeks and more than one BU to be about "the organisation")
  const weekMeans = new Map<string, { n: number; start: string; v: number[] }>();
  for (const r of weekly.filter(scored)) {
    const k = String(r.week_number);
    const e = weekMeans.get(k) ?? { n: r.week_number, start: r.week_start_at, v: [] as number[] };
    e.v.push(Number(r.final_score)); weekMeans.set(k, e);
  }
  const series = [...weekMeans.values()].sort((a, b) => a.start.localeCompare(b.start)).map((e) => ({ n: e.n, start: e.start, v: mean(e.v)! }));
  const lbl = (p: { n: number; start: string }) => formatWeekLabel({ week_number: p.n, week_start_at: p.start });
  if (input.orgWide && series.length >= 4) {
    const last = series.slice(-6);
    const reg = linearRegression(last.map((p, i) => ({ x: i, y: p.v })));
    if (reg && Math.abs(reg.slope) > 2) {
      const down = reg.slope < 0;
      out.push({
        id: "org-trend", kind: "OBSERVATION", severity: down ? "ATTENTION" : "INFO",
        title: down ? "The average BU score is falling" : "The average BU score is rising",
        statement: `Across the last ${last.length} scored weeks the average BU score moved ${down ? "down" : "up"} by about ${round(Math.abs(reg.slope))} points per week, from ${round(last[0].v)} (${lbl(last[0])}) to ${round(last[last.length - 1].v)} (${lbl(last[last.length - 1])}).`,
        evidence: [{ label: "Average BU score, first week", value: String(round(last[0].v)), period: lbl(last[0]) }, { label: "Average BU score, latest week", value: String(round(last[last.length - 1].v)), period: lbl(last[last.length - 1]) },
          { label: "Fitted slope", value: `${round(reg.slope)} points per week`, baseline: `fit quality R² ${round(reg.r2)}` }],
        reportId: "performance-trends", limitations: ["Describes movement, not its cause.", "Weekly averages change when the mix of BUs or goal counts changes."],
      });
    }
  }

  for (const [bu, rs] of byBu) {
    const s = sorted(rs).filter(scored);
    const scores = s.map((r) => Number(r.final_score));
    // 2. sharp drop against the BU's own recent average
    if (scores.length >= 4) {
      const latest = scores[scores.length - 1];
      const prior = mean(scores.slice(-4, -1))!;
      if (prior - latest >= 15) {
        out.push({
          id: `bu-drop:${bu}`, kind: "OBSERVATION", severity: "ATTENTION", title: `${bu}: sharp fall in the latest week`,
          statement: `${bu} scored ${round(latest)} in ${formatWeekLabel(s[s.length - 1])}, ${round(prior - latest)} points below its average of ${round(prior)} over the three weeks before.`,
          evidence: [{ label: "Latest weekly score", value: String(round(latest)), period: formatWeekLabel(s[s.length - 1]) }, { label: "Average of previous three weeks", value: String(round(prior)) }],
          reportId: "performance-trends", limitations: ["A missing report scores 0 and can explain a drop: check the reporting register.", "One week is a small sample."],
        });
      } else if (scores.length >= 5) {
        // 3. statistical anomaly (only if not already reported as a drop)
        const z = zScore(latest, scores.slice(0, -1));
        if (z !== null && Math.abs(z) >= 2) {
          out.push({
            id: `anomaly:${bu}`, kind: "ANOMALY", severity: "WATCH", title: `${bu}: unusual week`,
            statement: `${bu}'s latest weekly score of ${round(latest)} is ${round(Math.abs(z))} standard deviations ${z < 0 ? "below" : "above"} its own earlier average. This is a statistical flag, not a finding that anything went wrong.`,
            evidence: [{ label: "Latest weekly score", value: String(round(latest)) }, { label: "Earlier weeks, mean", value: String(round(mean(scores.slice(0, -1))!)) }, { label: "z-score", value: String(round(z)) }],
            reportId: "performance-trends", limitations: ["Needs at least five scored weeks.", "Assumes scores vary roughly symmetrically."],
          });
        }
      }
    }
    // 4. repeated missed reports among the last four finalised, due weeks
    const due = sorted(rs).filter((r) => r.reporting_state === "NORMAL" && r.week_status === "FINAL_LOCKED" && r.compliance_status).slice(-4);
    const missed = due.filter((r) => r.compliance_status === "NON_COMPLIANT");
    if (missed.length >= 2) {
      out.push({
        id: `repeat-miss:${bu}`, kind: "OBSERVATION", severity: "ATTENTION", title: `${bu}: repeated missing reports`,
        statement: `${bu} did not submit a report by the final lock in ${missed.length} of its last ${due.length} finalised weeks (${missed.map((r) => formatWeekLabel(r)).join("; ")}).`,
        evidence: [{ label: "Missing in the last four finalised weeks", value: `${missed.length} of ${due.length}` }],
        reportId: "reporting-register", limitations: ["Holiday weeks are excluded.", "A late-report exception does not change this count."],
      });
    }
  }

  // 5. projection below last quarter even at the top of the range
  for (const q of quarter) {
    if (q.score === null || q.previous_score === null || !q.denominator_count) continue;
    const rs = sorted(byBu.get(q.business_unit) ?? []).filter(scored).map((r) => Number(r.final_score));
    const f = projectQuarterEnd({ weeklyScores: rs, denominator: q.denominator_count });
    if (f.status === "OK" && f.high !== null && f.high < q.previous_score) {
      out.push({
        id: `forecast-below:${q.business_unit}`, kind: "OBSERVATION", severity: "WATCH", title: `${q.business_unit}: projected to finish below last quarter`,
        statement: `Even at the top of its 95% range (${f.high}), ${q.business_unit}'s projected quarter-end score is below last quarter's ${q.previous_score}. This is a projection from weeks scored so far, not a result.`,
        evidence: [{ label: "Projected finish", value: `${f.projected} (95% range ${f.low}–${f.high})`, baseline: `method: ${f.method === "TREND" ? "fitted trend" : "average of scored weeks"}` }, { label: "Previous quarter", value: String(q.previous_score) }],
        reportId: "quarter-forecast", limitations: f.limitations,
      });
    }
  }

  // 6. governance backlog (counts only; the report names the items)
  const reviewOld = governance.filter((g) => g.category === "REPORT_REVIEW" && g.age_days > 7).length;
  if (reviewOld > 0) {
    out.push({
      id: "review-backlog", kind: "RECOMMENDATION", severity: "WATCH", title: "Submitted reports are waiting for review",
      statement: `${reviewOld} final-locked report${reviewOld === 1 ? " has" : "s have"} waited more than 7 days for review. Unreviewed reports keep quarterly scores provisional. Reviewing them is the action that finalises those scores.`,
      evidence: [{ label: "Reports unreviewed after 7+ days", value: String(reviewOld) }], reportId: "governance-outstanding", limitations: ["The 7-day band is a proposed default pending approval."],
    });
  }
  const high = governance.filter((g) => g.priority === "HIGH" && g.category !== "REPORT_REVIEW");
  if (high.length) {
    out.push({
      id: "governance-high", kind: "RECOMMENDATION", severity: "ATTENTION", title: "Approvals and exceptions are overdue",
      statement: `${high.length} approval or exception item${high.length === 1 ? " has" : "s have"} been waiting more than 7 days (oldest ${Math.max(...high.map((g) => g.age_days))} days).`,
      evidence: [{ label: "Items waiting over 7 days", value: String(high.length) }, { label: "Types", value: [...new Set(high.map((g) => g.category))].join(", ") }], reportId: "governance-outstanding",
      limitations: ["Only items you are allowed to see are counted."],
    });
  }

  const order = { ATTENTION: 0, WATCH: 1, INFO: 2 } as const;
  void period;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

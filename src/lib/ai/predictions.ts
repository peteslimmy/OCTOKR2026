import type { ExecutiveReport, ForecastClass, UnitView } from "@/lib/insights/executive-report";
import type { CoverageRow } from "@/lib/insights/management-brief";

/**
 * Predictions for 4COREPAL (docs/38 section 11). Every figure here comes from the application's own forecasting rules (the recent weeks weighted towards the latest, a
 * damped continuation of the trend, weeks with no report counted as zero): the model never produces a number. Each prediction states what is expected, for which period,
 * on what history, under what assumptions, how sure, what moves it and what to do. A prediction is never a promise.
 */
export interface Prediction {
  id: string;
  kind: "UNIT_QUARTER" | "UNIT_COMMITMENTS" | "SUB_KR";
  subject: string;
  outcome: string;
  period: string;
  evidence: string[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
  factors: string[];
  recommendation: string;
  /** How worrying: 3 act now, 2 watch, 1 fine, 0 cannot say. */
  concern: 0 | 1 | 2 | 3;
}

const METHOD = [
  "The estimate weights the unit's recent weeks towards the latest and continues the trend only partly.",
  "A week with no report counts as a zero, as it will at the final lock.",
  "The remaining weeks are filled with the projected level; it assumes nothing changes in how the unit plans or reports.",
];
const pc = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "n/a" : `${n.toFixed(d)}%`);
const CONCERN: Record<ForecastClass, 0 | 1 | 2 | 3> = { exceed: 1, achieve: 1, intervention: 2, unlikely: 3, none: 0 };

function unitOutcome(u: UnitView, target: number): string {
  if (u.forecast === "none" || u.projected === null) return "Cannot be forecast yet: too few settled weeks.";
  const gap = u.projected - target;
  const word = u.forecast === "exceed" ? "Likely to finish above the target" : u.forecast === "achieve" ? "Likely to reach the target" : u.forecast === "intervention" ? "Could reach the target only with intervention" : "Unlikely to reach the target";
  return `${word}: forecast quarter score ${pc(u.projected)} against a target of ${target}% (${gap >= 0 ? "+" : ""}${gap.toFixed(0)} points).`;
}

function unitRecommendation(u: UnitView): string {
  if (u.forecast === "exceed" || u.forecast === "achieve") return "No intervention needed. Keep the current way of working and watch the next two weeks.";
  if (u.forecast === "none") return "Wait for more settled weeks before judging. Make sure the unit files every week meanwhile.";
  const step = u.stepUp !== null && u.stepUp > 0 ? `The weekly score must rise by about ${u.stepUp.toFixed(0)} points to about ${pc(u.needed)} for the rest of the quarter. ` : "";
  const cause = u.cause ? `Start with the main reason found: ${u.cause.label.toLowerCase()}. ` : "";
  return `${step}${cause}Ask the unit lead for a recovery plan this cycle.`.trim();
}

export function buildPredictions(report: Pick<ExecutiveReport, "units" | "quarterLabel" | "org">, coverage: CoverageRow[] = []): Prediction[] {
  const out: Prediction[] = [];
  const target = report.org.target;
  for (const u of report.units) {
    const series = u.series.map((v, i) => `week ${i + 1} of those filed: ${pc(v)}`);
    out.push({
      id: `unit:${u.id}`, kind: "UNIT_QUARTER", subject: u.name, outcome: unitOutcome(u, target), period: report.quarterLabel,
      evidence: [`Score to date ${pc(u.scoreToDate)}; last week ${pc(u.last)}; week before ${pc(u.previous)}.`, `${u.filed} of ${u.elapsed} settled weeks filed${u.missed ? `, ${u.missed} missed` : ""}.`, ...series.slice(-4)],
      assumptions: METHOD, confidence: u.confidence,
      factors: [
        u.direction === "improving" ? "Scores have been rising." : u.direction === "deteriorating" ? "Scores have been falling." : u.direction === "stagnant" ? "Scores have been flat." : "Too few weeks to see a direction.",
        ...(u.slope !== null ? [`Trend ${u.slope >= 0 ? "+" : ""}${u.slope.toFixed(1)} points a week.`] : []),
        ...(u.volatility >= 15 ? [`Results swing by about ${u.volatility.toFixed(0)} points from week to week, so the forecast is less certain.`] : []),
        ...(u.missed > 0 ? [`${u.missed} week${u.missed === 1 ? "" : "s"} with no report counted as zero.`] : []),
        ...(u.cause ? [`Main reason found: ${u.cause.label}.`] : []),
      ],
      recommendation: unitRecommendation(u), concern: CONCERN[u.forecast],
    });
    const cap = u.analysis.capacity;
    if (cap.ratio !== null && cap.overcommitted && cap.plannedPerWeek !== null && cap.donePerWeek !== null) {
      out.push({
        id: `commit:${u.id}`, kind: "UNIT_COMMITMENTS", subject: u.name,
        outcome: `Likely to leave about ${(100 - cap.ratio).toFixed(0)}% of its planned tasks unfinished each week if it keeps planning this much.`, period: report.quarterLabel,
        evidence: [`Plans ${cap.plannedPerWeek.toFixed(1)} tasks a week and finishes ${cap.donePerWeek.toFixed(1)} (${pc(cap.ratio)}).`],
        assumptions: ["The recent weekly pattern of planned and finished tasks continues.", "Tasks that are not done are not rolled into a smaller plan."],
        confidence: u.filed >= 5 ? "medium" : "low", factors: cap.carryOver.length ? [`${cap.carryOver.length} goal${cap.carryOver.length === 1 ? "" : "s"} set repeatedly without being finished.`] : ["The plan is larger than the unit's recent output."],
        recommendation: "Agree a smaller weekly plan with the unit lead, or the support it needs to deliver the plan it has.", concern: 2,
      });
    }
  }
  for (const k of coverage) {
    if (k.status === "uncovered") {
      out.push({ id: `subkr:${k.code}`, kind: "SUB_KR", subject: `${k.code} ${k.title}`, outcome: "Will not move this quarter unless a unit takes it up: no weekly goal supports it.", period: report.quarterLabel,
        evidence: [`${k.goals} weekly goals, ${k.units} units working on it.`], assumptions: ["Judged on weekly goals only: the application records no numeric target for a Sub-KR, so this is a coverage forecast, not a score forecast."],
        confidence: "high", factors: ["No unit has set a weekly goal against it."], recommendation: "Ask which unit owns it and have them set a weekly goal for it, or confirm it is intentionally parked.", concern: 3 });
    } else if (k.goals >= 3 && k.doneRate !== null && k.doneRate < 50) {
      out.push({ id: `subkr:${k.code}`, kind: "SUB_KR", subject: `${k.code} ${k.title}`, outcome: `At risk: fewer than half of the weekly goals that support it are finished (${pc(k.doneRate, 1)}).`, period: report.quarterLabel,
        evidence: [`${k.goals} weekly goals from ${k.units} unit${k.units === 1 ? "" : "s"}, ${pc(k.doneRate, 1)} finished, ${pc(k.sharePct)} of all goals.`],
        assumptions: ["Judged on the share of weekly goals finished: the application records no numeric target for a Sub-KR."], confidence: k.goals >= 6 ? "medium" : "low",
        factors: k.status === "concentrated" ? ["Effort is concentrated in one unit."] : ["Several units work on it."], recommendation: "Review the unfinished goals with the units concerned and decide whether to unblock, resize or reassign them.", concern: 2 });
    }
  }
  return out.sort((a, b) => b.concern - a.concern || a.subject.localeCompare(b.subject));
}

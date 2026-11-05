// The Executive Performance Intelligence Report: the management brief taken one level deeper. Every figure and finding here is a fixed rule over data the
// application already holds (goals, tasks, weekly scores, submissions, logged actions): the same data always gives the same report, and nothing is guessed.
// Each finding says what kind of statement it is (a fact, a calculation, an interpretation, a forecast, a hypothesis to check or a recommendation), and anything the
// application does not record (who owns a goal, whether it was rolled over, what blocks it) is listed as a limitation instead of being invented.

import { keys, mean, round1, slope, stdev, TARGET_QUARTER_SCORE, type GoalFact, type Outlook, type QuarterFrame } from "./bu-intelligence";
import type { CauseCode, ManagementBrief, UnitAnalysis } from "./management-brief";

export type Basis = "FACT" | "CALCULATED" | "INTERPRETATION" | "FORECAST" | "HYPOTHESIS" | "RECOMMENDATION";
export type Direction = "improving" | "deteriorating" | "stagnant" | "insufficient";
export type ForecastClass = "exceed" | "achieve" | "intervention" | "unlikely" | "none";
export type RiskBand = "Low" | "Moderate" | "High" | "Very High" | "Critical";
export type Velocity = "Immediate" | "Near-term" | "Longer-term";

/** Proposed thresholds: there is no approved organisational policy for them in the application, so they are shown to management for approval. */
export const THRESHOLDS = {
  target: TARGET_QUARTER_SCORE, materiallyBelow: 10, exceed: 85, intervention: 55,
  improving: 8, volatilitySd: 25, tasksOverGoals: 25, concentration: 60, stagnationBand: 5,
} as const;

export interface UnitView {
  id: string; name: string; outlook: Outlook; elapsed: number; filed: number; missed: number; series: number[]; scoreToDate: number | null; projected: number | null;
  variance: number | null; last: number | null; previous: number | null; delta: number | null; direction: Direction; slope: number | null; volatility: number; maxSwing: number;
  recentAvg: number | null; needed: number | null; stepUp: number | null; remaining: number; reachable: boolean | null; confidence: "low" | "medium" | "high"; forecast: ForecastClass;
  taskCompletion: number | null; goalCompletion: number | null; goalsTotal: number; stagnationRun: number; declineRun: number; earlierAvg: number | null;
  concentrationPct: number | null; cause: { code: CauseCode; label: string; detail: string } | null; analysis: UnitAnalysis;
}
export interface OrgSnapshot {
  units: number; withForecast: number; counts: Record<Outlook, number>; target: number; actualToDate: number | null; reported: number | null;
  projectedUnweighted: number | null; projectedWeighted: number | null; median: number | null; min: { name: string; value: number } | null; max: { name: string; value: number } | null;
  spread: number | null; belowTarget: number; materiallyBelow: number; masking: boolean; improving: string[]; deteriorating: string[]; stagnant: string[]; needsIntervention: string[];
  thisWeek: number | null; lastWeek: number | null; weekDelta: number | null; latestWeek: number | null; previousWeek: number | null; weeksRemaining: number; neededWeekly: number | null; recentWeekly: number | null;
  stepUp: number | null; reachable: boolean | null; series: { week: number; value: number; units: number }[]; verdict: string;
}
export interface RepeatedGoal {
  unit: string; unitId: string; title: string; weeksSet: number; weeksUnfinished: number; first: number; last: number; run: number; progressPct: number | null;
  classification: "Stagnant goal" | "Potentially abandoned" | "Repeatedly rolled-over goal" | "Poorly defined goal" | "Delayed execution"; why: string; refs: string[]; stillActive: boolean;
}
export interface Pattern {
  id: string; title: string; description: string; units: string[]; evidence: { unit: string; text: string }[]; frequency: string; scope: "Organisation-wide" | "Unit-level" | "Not detected";
  rootCause: { text: string; status: "Confirmed from the data" | "Plausible, needs validation" }; consequence: string; intervention: string;
}
export interface RiskRow {
  id: string; title: string; category: "Strategic" | "Execution" | "Accountability" | "Reporting" | "Governance" | "Operational"; units: string[]; description: string; evidence: string;
  likelihood: number; impact: number; inherent: number; controls: string; effectiveness: string; residualLikelihood: number; residual: number; band: RiskBand; velocity: Velocity;
  consequence: string; owner: string; mitigation: string; trigger: string; resolution: string; status: "Open" | "Monitoring" | "Mitigating" | "Escalated"; provisional: boolean; basis: string;
}
export interface Indicator {
  id: string; title: string; description: string; warning: string; escalation: string; response: string;
  affected: { unit: string; value: string; level: "warning" | "escalate" }[]; observed: string;
}
export interface Action {
  tier: "Immediate" | "Short-term" | "Medium-term"; priority: "Critical" | "High" | "Medium" | "Low"; finding: string; evidence: string; action: string; outcome: string;
  owner: string; deadline: string; measure: string; escalation: string;
}
export interface Decision { decision: string; why: string; evidence: string; ifNot: string; position: string }
export interface ExecutiveReport {
  quarterLabel: string; latestWeek: number | null; generatedFor: string; units: UnitView[]; org: OrgSnapshot; repeated: RepeatedGoal[];
  themes: { theme: string; units: string[]; examples: string[] }[]; patterns: Pattern[]; risks: RiskRow[]; topRisks: RiskRow[]; collective: { category: string; count: number; units: string[]; note: string }[];
  indicators: Indicator[]; cross: {
    causes: { label: string; units: string[] }[]; underperformers: string[]; fastest: { name: string; delta: number }[];
    practices: { measure: string; top: string; others: string }[]; practicesNote: string; systemic: string[]; individual: string[];
  };
  positives: { unit: string; kind: "Sustained improvement" | "One-week movement" | "Recovering" | "Steady and strong"; text: string; sustainable: string }[];
  actions: Action[]; decisions: Decision[]; summary: { headline: string; findings: { text: string; basis: Basis }[] };
  quality: { limitations: string[]; checks: { check: string; result: "Agrees" | "Differs" | "Not checkable"; detail: string }[]; assumptions: string[] };
}

const NUMBER = /\d/;
const DEADLINE = /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b|\bby\b|\bbefore\b|\buntil\b|\bend of\b|\b\d{1,2}[/:.]\d{1,2}\b|\b\d{1,2}(st|nd|rd|th)\b/i;
const GENERIC = new Set(["complete", "publish", "resolve", "open", "send", "prepare", "review", "update", "close", "finalise", "deliver", "weekly", "report", "team", "unit", "state", "goal", "task", "follow", "new"]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pc = (n: number | null, d = 0) => (n === null ? "not known" : `${n.toFixed(d)}%`);
const list = (a: string[], max = 4) => (a.length <= max ? a.join(", ") : `${a.slice(0, max).join(", ")} and ${a.length - max} more`);

// ------------------------------------------------------------------------------------------------ a unit, in one view
function viewOf(u: UnitAnalysis, facts: GoalFact[]): UnitView {
  const series = u.weeks.filter((w) => w.score !== null).map((w) => w.score as number);
  const p = u.intel.prediction;
  const last = u.change.last, previous = u.change.previous;
  const swings = series.slice(1).map((v, i) => Math.abs(v - series[i]));
  const recent = series.slice(-3);
  let direction: Direction = "insufficient";
  if (series.length >= 3) {
    const now2 = mean(series.slice(-2)) as number, before = mean(series.slice(Math.max(0, series.length - 4), series.length - 2)) as number;
    direction = now2 - before >= THRESHOLDS.improving ? "improving" : before - now2 >= THRESHOLDS.improving ? "deteriorating" : "stagnant";
  }
  let stagnationRun = 0;
  for (let i = series.length - 1; i > 0 && Math.abs(series[i] - series[i - 1]) <= THRESHOLDS.stagnationBand && series[i] < THRESHOLDS.target; i--) stagnationRun++;
  let declineRun = 0;
  for (let i = series.length - 1; i > 0 && series[i] <= series[i - 1] - 5; i--) declineRun++;
  const planned = u.weeks.reduce((n, w) => n + w.tasksPlanned, 0), doneT = u.weeks.reduce((n, w) => n + w.tasksDone, 0);
  const goalsTotal = u.weeks.reduce((n, w) => n + w.goals, 0), goalsDone = u.weeks.reduce((n, w) => n + Math.round(((w.score ?? 0) / 100) * w.goals), 0);
  const mine = facts.filter((f) => f.businessUnitId === u.businessUnitId && f.done && f.buGoalId);
  const perGoal = new Map<string, number>();
  for (const f of mine) perGoal.set(f.buGoalId as string, (perGoal.get(f.buGoalId as string) ?? 0) + 1);
  const topShare = mine.length >= 6 && perGoal.size >= 2 ? Math.max(...perGoal.values()) / mine.length : null;
  const projected = p.projectedQuarterScore;
  const evidence = u.intel.evidenceWeeks;
  const recentAvg = recent.length ? round1(mean(recent) as number) : null;
  const needed = p.neededWeeklyAverage;
  return {
    id: u.businessUnitId, name: u.unitName, outlook: u.intel.outlook, elapsed: p.weeksElapsed, filed: series.length, missed: Math.max(0, p.weeksElapsed - series.length), series, scoreToDate: p.scoreToDate,
    projected, variance: projected === null ? null : round1(projected - THRESHOLDS.target), last, previous, delta: u.change.delta, direction, slope: slope(series) === null ? null : round1(slope(series) as number),
    volatility: round1(stdev(series)), maxSwing: swings.length ? Math.max(...swings) : 0, recentAvg, needed, stepUp: needed !== null && recentAvg !== null ? round1(needed - recentAvg) : null, remaining: p.weeksRemaining,
    reachable: p.reachable, confidence: evidence >= 6 ? "high" : evidence >= 3 ? "medium" : "low",
    forecast: projected === null ? "none" : projected >= THRESHOLDS.exceed ? "exceed" : projected >= THRESHOLDS.target ? "achieve" : projected >= THRESHOLDS.intervention ? "intervention" : "unlikely",
    taskCompletion: planned ? round1((doneT / planned) * 100) : null, goalCompletion: goalsTotal ? round1((goalsDone / goalsTotal) * 100) : null, goalsTotal, stagnationRun, declineRun,
    earlierAvg: series.length >= 4 ? round1(mean(series.slice(0, -2)) as number) : null, concentrationPct: topShare === null ? null : round1(topShare * 100), cause: u.cause, analysis: u,
  };
}

// ------------------------------------------------------------------------------------------------ goals set again and again
function repeatedGoals(units: UnitView[], facts: GoalFact[]): RepeatedGoal[] {
  const out: RepeatedGoal[] = [];
  for (const u of units) {
    const settled = new Set(u.analysis.weeks.map((w) => w.number));
    const latest = Math.max(0, ...settled);
    const mine = facts.filter((f) => f.businessUnitId === u.id && settled.has(f.weekNumber)).sort((a, b) => a.weekNumber - b.weekNumber);
    const clusters: { key: Set<string>; title: string; weeks: Map<number, { done: boolean; td: number; tt: number }>; ids: string[]; smart: number[] }[] = [];
    for (const f of mine) {
      const k = keys(f.title);
      if (k.size < 3) continue;
      let c = clusters.find((x) => { const shared = [...k].filter((s) => x.key.has(s)).length; return shared / Math.min(k.size, x.key.size) >= 0.6; });
      if (!c) { c = { key: k, title: f.title, weeks: new Map(), ids: [], smart: [] }; clusters.push(c); }
      c.title = f.title;
      const w = c.weeks.get(f.weekNumber) ?? { done: false, td: 0, tt: 0 };
      c.weeks.set(f.weekNumber, { done: w.done || f.done, td: w.td + f.tasksDone, tt: w.tt + f.tasksTotal });
      c.ids.push(f.goalId.slice(0, 8));
      if (f.smart !== null) c.smart.push(f.smart);
    }
    for (const c of clusters) {
      const wk = [...c.weeks.entries()].sort((a, b) => a[0] - b[0]);
      const open = wk.filter(([, v]) => !v.done);
      if (open.length < 2) continue;
      const td = open.reduce((n, [, v]) => n + v.td, 0), tt = open.reduce((n, [, v]) => n + v.tt, 0);
      const progress = tt ? round1((td / tt) * 100) : null;
      let run = 0, cur = 0, prev = -1;
      for (const [n, v] of wk) { if (!v.done && (prev < 0 || n - prev <= 1)) cur++; else cur = v.done ? 0 : 1; run = Math.max(run, cur); prev = n; }
      const lastSet = wk[wk.length - 1][0], stillActive = latest - lastSet <= 0;
      const lowProgress = progress !== null && progress < 25;
      const measurable = NUMBER.test(c.title), dated = DEADLINE.test(c.title);
      let classification: RepeatedGoal["classification"], why: string;
      if (open.length >= 3 && lowProgress && !stillActive) { classification = "Potentially abandoned"; why = `Left unfinished in ${open.length} weeks with ${pc(progress)} of its tasks done, and not set again since week ${lastSet}.`; }
      else if (open.length >= 3 && lowProgress) { classification = "Stagnant goal"; why = `Unfinished in ${open.length} weeks with only ${pc(progress)} of its tasks done: little recorded advance.`; }
      else if (open.length >= 3) { classification = "Repeatedly rolled-over goal"; why = `Unfinished in ${open.length} weeks although ${pc(progress)} of its tasks were done: the work moves but the goal does not close.`; }
      else if (!measurable && !dated) { classification = "Poorly defined goal"; why = "Set in two weeks without finishing, and its wording has neither a number nor a deadline to tell when it is done."; }
      else { classification = "Delayed execution"; why = `Unfinished in two weeks with ${pc(progress)} of its tasks done; two weeks may still be a normal span for this goal.`; }
      out.push({ unit: u.name, unitId: u.id, title: c.title, weeksSet: wk.length, weeksUnfinished: open.length, first: wk[0][0], last: lastSet, run, progressPct: progress, classification, why, refs: [...new Set(c.ids)].slice(0, 3), stillActive });
    }
  }
  const rank = { "Potentially abandoned": 0, "Stagnant goal": 1, "Repeatedly rolled-over goal": 2, "Poorly defined goal": 3, "Delayed execution": 4 } as const;
  return out.sort((a, b) => rank[a.classification] - rank[b.classification] || b.weeksUnfinished - a.weeksUnfinished);
}

/** Words that keep coming back in the unfinished goals of several units: a theme, rather than one unit's difficulty. */
function themesOf(repeated: RepeatedGoal[], unitNames: string[]) {
  const by = new Map<string, { units: Set<string>; examples: string[]; word: string }>();
  const own = new Set(unitNames.flatMap((n) => [...keys(n)]));                       // a unit's own name in its goals is not a theme
  for (const r of repeated) {
    const raw = new Map<string, string>();
    for (const t of r.title.split(/[^A-Za-z]+/)) for (const k of keys(t)) raw.set(k, t.toLowerCase());
    for (const k of keys(r.title)) {
      if (GENERIC.has(k) || k.length < 5 || own.has(k)) continue;
      const e = by.get(k) ?? { units: new Set<string>(), examples: [], word: raw.get(k) ?? k };
      e.units.add(r.unit);
      if (e.examples.length < 2 && !e.examples.includes(r.title)) e.examples.push(r.title);
      by.set(k, e);
    }
  }
  return [...by.entries()].filter(([, e]) => e.units.size >= 3).sort((a, b) => b[1].units.size - a[1].units.size).slice(0, 5)
    .map(([, e]) => ({ theme: e.word, units: [...e.units].sort(), examples: e.examples.map((t) => t.slice(0, 110)) }));
}

// ------------------------------------------------------------------------------------------------ the organisation
function snapshot(units: UnitView[], brief: ManagementBrief): OrgSnapshot {
  const withF = units.filter((u) => u.projected !== null);
  const proj = withF.map((u) => u.projected as number);
  const weights = withF.map((u) => Math.max(1, u.goalsTotal));
  const weighted = withF.length ? round1(withF.reduce((n, u, i) => n + (u.projected as number) * weights[i], 0) / weights.reduce((a, b) => a + b, 0)) : null;
  const sorted = [...proj].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  const lo = withF.length ? withF.reduce((m, u) => ((u.projected as number) < (m.projected as number) ? u : m)) : null;
  const hi = withF.length ? withF.reduce((m, u) => ((u.projected as number) > (m.projected as number) ? u : m)) : null;
  const weekMap = new Map<number, number[]>();
  for (const u of units) for (const w of u.analysis.weeks) if (w.score !== null) weekMap.set(w.number, [...(weekMap.get(w.number) ?? []), w.score]);
  const series = [...weekMap.entries()].sort((a, b) => a[0] - b[0]).map(([week, v]) => ({ week, value: round1(mean(v) as number), units: v.length }));
  const thisW = series.length ? series[series.length - 1] : null, lastW = series.length > 1 ? series[series.length - 2] : null;
  const remaining = Math.max(0, ...units.map((u) => u.remaining));
  const neededList = units.map((u) => u.needed).filter((v): v is number => v !== null);
  const recentList = units.map((u) => u.recentAvg).filter((v): v is number => v !== null);
  const needed = neededList.length ? round1(mean(neededList) as number) : null, recent = recentList.length ? round1(mean(recentList) as number) : null;
  const below = withF.filter((u) => (u.projected as number) < THRESHOLDS.target), material = withF.filter((u) => (u.projected as number) < THRESHOLDS.target - THRESHOLDS.materiallyBelow);
  const avg = proj.length ? round1(mean(proj) as number) : null;
  const names = (d: Direction) => units.filter((u) => u.direction === d).map((u) => u.name);
  const reachable = needed === null ? null : needed <= 100;
  const todayList = units.map((u) => u.scoreToDate).filter((v): v is number => v !== null);
  const reportedList = units.filter((u) => u.filed > 0).map((u) => mean(u.series) as number);
  const masking = avg !== null && avg >= THRESHOLDS.target && below.length > 0;
  const verdict = avg === null ? "There is not yet enough data to say where the organisation stands."
    : avg >= THRESHOLDS.target && below.length === 0 ? "On track: the average and every unit are projected at or above target."
    : masking ? `The average meets the target, but ${plural(below.length, "unit")} ${below.length === 1 ? "is" : "are"} projected below it: the average is hiding weak units.`
    : avg >= THRESHOLDS.target ? "On track on average."
    : THRESHOLDS.target - avg < 1 ? `Marginally below target: the average is projected at ${avg.toFixed(1)}% against ${THRESHOLDS.target}%, ${(THRESHOLDS.target - avg).toFixed(1)} points short, and ${plural(below.length, "unit")} ${below.length === 1 ? "is" : "are"} below it.`
    : `Below target: the average is projected at ${avg.toFixed(1)}% against ${THRESHOLDS.target}%.`;
  return {
    units: units.length, withForecast: withF.length, counts: brief.org.counts, target: THRESHOLDS.target, actualToDate: todayList.length ? round1(mean(todayList) as number) : null,
    reported: reportedList.length ? round1(mean(reportedList) as number) : null, projectedUnweighted: avg, projectedWeighted: weighted, median: median === null ? null : round1(median),
    min: lo ? { name: lo.name, value: lo.projected as number } : null, max: hi ? { name: hi.name, value: hi.projected as number } : null, spread: proj.length ? round1(stdev(proj)) : null,
    belowTarget: below.length, materiallyBelow: material.length, masking, improving: names("improving"), deteriorating: names("deteriorating"), stagnant: names("stagnant"),
    needsIntervention: units.filter((u) => u.outlook === "OFF_TRACK" || (u.outlook === "AT_RISK" && (u.direction === "deteriorating" || u.forecast === "unlikely"))).map((u) => u.name),
    thisWeek: thisW?.value ?? null, lastWeek: lastW?.value ?? null, weekDelta: thisW && lastW ? round1(thisW.value - lastW.value) : null, latestWeek: thisW?.week ?? null, previousWeek: lastW?.week ?? null,
    weeksRemaining: remaining, neededWeekly: needed, recentWeekly: recent, stepUp: needed !== null && recent !== null ? round1(needed - recent) : null, reachable, series, verdict,
  };
}

// ------------------------------------------------------------------------------------------------ patterns
function patternsOf(units: UnitView[], repeated: RepeatedGoal[]): Pattern[] {
  const N = units.length;
  const scope = (n: number): Pattern["scope"] => (n === 0 ? "Not detected" : n >= Math.max(3, Math.ceil(N * 0.3)) ? "Organisation-wide" : "Unit-level");
  const freq = (n: number, extra = "") => `${n} of ${N} reporting units${extra}`;
  const out: Pattern[] = [];
  const add = (p: Omit<Pattern, "scope" | "frequency" | "units" | "evidence"> & { hits: { unit: string; text: string }[]; extra?: string }) => {
    const { hits, extra, ...rest } = p;
    out.push({ ...rest, units: hits.map((h) => h.unit), evidence: hits, scope: scope(hits.length), frequency: freq(hits.length, extra) });
  };
  add({ id: "P1", title: "Execution without outcomes", description: "Tasks are being completed, but the goals they belong to are not closing.",
    hits: units.filter((u) => u.taskCompletion !== null && u.goalCompletion !== null && u.goalsTotal >= 6 && u.taskCompletion >= 60 && u.taskCompletion - u.goalCompletion >= THRESHOLDS.tasksOverGoals)
      .map((u) => ({ unit: u.name, text: `${pc(u.taskCompletion)} of tasks done against ${pc(u.goalCompletion)} of goals over ${plural(u.elapsed, "week")}.` })),
    rootCause: { text: "The data confirms the gap between tasks and goals. Why goals do not close (the last task is left, goals are too big, or tasks are not the work that finishes the goal) is not recorded.", status: "Plausible, needs validation" },
    consequence: "The quarter score stays low although the unit is busy, and management cannot tell effort from result.", intervention: "Review with the BU Lead which task is left undone on each open goal; split goals that stall on one task." });
  add({ id: "P2", title: "Repeated unfinished goals", description: "Similar goals are set again and again without being finished.",
    hits: [...new Set(repeated.map((r) => r.unit))].map((unit) => { const mine = repeated.filter((r) => r.unit === unit); return { unit, text: `${plural(mine.length, "goal")} set in 2 or more weeks without finishing; longest ${Math.max(...mine.map((m) => m.weeksUnfinished))} weeks.` }; }),
    rootCause: { text: "Confirmed from the data: the same goal wording is open in several weeks. Whether it is rolled over on purpose is not recorded, so the reason stays a hypothesis.", status: "Plausible, needs validation" },
    consequence: "Commitments are not being honoured, goals that matter may never close, and the weekly plan loses credibility.", intervention: "Make the owner state a recovery plan for each goal open three weeks or more: finish it, restructure it, or retire it." });
  add({ id: "P3", title: "Goal stagnation", description: "A unit's weekly result barely moves for several weeks while below target.",
    hits: units.filter((u) => u.stagnationRun >= 3).map((u) => ({ unit: u.name, text: `Weekly score within ${THRESHOLDS.stagnationBand} points of the week before for ${plural(u.stagnationRun, "week")} while below ${THRESHOLDS.target}%.` })),
    rootCause: { text: "The flat score is confirmed. The cause behind it is not recorded.", status: "Plausible, needs validation" }, consequence: "Without a change of approach the unit ends the quarter at its current level.",
    intervention: "Ask the BU Lead for what will be done differently next week, not the same plan again." });
  add({ id: "P4", title: "Weakly defined goals", description: "Goals are loosely worded: few carry a number or a deadline.",
    hits: units.filter((u) => u.analysis.difficulty.level === "light" || ((u.analysis.difficulty.measurablePct ?? 100) < 40 && u.goalsTotal >= 6) || ((u.analysis.difficulty.avgSmart ?? 100) < 60 && u.goalsTotal >= 6))
      .map((u) => ({ unit: u.name, text: `${pc(u.analysis.difficulty.measurablePct)} of goals carry a number, ${pc(u.analysis.difficulty.deadlinePct)} a deadline; SMART average ${u.analysis.difficulty.avgSmart === null ? "not known" : u.analysis.difficulty.avgSmart.toFixed(0)}.` })),
    rootCause: { text: "The wording is confirmed from goal text. Whether this is a skill gap, or goals written quickly to fill the report, cannot be told from the data.", status: "Plausible, needs validation" },
    consequence: "A goal that cannot be measured is hard to finish and easy to mark done, so scores mean less.", intervention: "Require a number and a deadline in each goal before it is accepted; use the SMART check as a gate for review, not only a hint." });
  add({ id: "P5", title: "Unrealistic commitments", description: "Units plan far more tasks than they finish.",
    hits: units.filter((u) => u.analysis.capacity.overcommitted).map((u) => ({ unit: u.name, text: `About ${u.analysis.capacity.plannedPerWeek?.toFixed(0)} tasks planned a week, ${u.analysis.capacity.donePerWeek?.toFixed(0)} finished (${pc(u.analysis.capacity.ratio)}).` })),
    rootCause: { text: "The planned-against-finished gap is confirmed. That capacity, not effort, is the limit is a plausible reading.", status: "Plausible, needs validation" },
    consequence: "Goals will keep missing, morale and trust in the plan fall, and the quarter score stays low.", intervention: "Cap the weekly plan at what the unit has finished on average, and carry the rest by choice." });
  add({ id: "P6", title: "Accountability not demonstrable", description: "Goals stay open week after week and the application records no owner or recovery plan for them.",
    hits: [...new Set(repeated.filter((r) => r.weeksUnfinished >= 3).map((r) => r.unit))].map((unit) => ({ unit, text: `${plural(repeated.filter((r) => r.unit === unit && r.weeksUnfinished >= 3).length, "goal")} open three weeks or more with no owner or recovery plan on record.` })),
    rootCause: { text: "The application records no goal owner, so accountability cannot be confirmed or ruled out. This is a hypothesis.", status: "Plausible, needs validation" },
    consequence: "No one can be asked to account for a goal that has stalled.", intervention: "Name an owner and a recovery date for every goal open three weeks or more, and record it in the weekly report." });
  add({ id: "P7", title: "Performance concentrated in few goals", description: "Most of a unit's completed work comes from one of its goals.",
    hits: units.filter((u) => u.concentrationPct !== null && u.concentrationPct >= THRESHOLDS.concentration).map((u) => ({ unit: u.name, text: `${pc(u.concentrationPct)} of completed goals support a single unit goal.` })),
    rootCause: { text: "The concentration is confirmed. It may be a deliberate priority or neglect of the other goals.", status: "Plausible, needs validation" }, consequence: "Other unit goals can fail unnoticed while the score looks fine.", intervention: "Check that the unit's other goals are being worked, or retire them." });
  add({ id: "P8", title: "Volatile performance", description: "Large weekly swings: strong weeks followed by weak ones.",
    hits: units.filter((u) => u.filed >= 4 && (u.volatility >= THRESHOLDS.volatilitySd || u.maxSwing >= 50)).map((u) => ({ unit: u.name, text: `Weekly scores vary by ${u.volatility.toFixed(0)} points (largest one-week swing ${u.maxSwing.toFixed(0)}).` })),
    rootCause: { text: "The swings are confirmed. Uneven goal size, uneven weekly effort or irregular marking are all possible.", status: "Plausible, needs validation" }, consequence: "The forecast is less reliable and one bad week can undo several good ones.", intervention: "Smooth the load: similar-sized goals each week and a steady marking routine." });
  add({ id: "P9", title: "Reported results that need checking", description: "Marking behaviour that makes a score less safe to rely on.",
    hits: units.filter((u) => u.analysis.integrity.level !== "ok").map((u) => ({ unit: u.name, text: `${u.analysis.integrity.flags.join("; ")}.` })),
    rootCause: { text: "The flags are facts about timing and corrections. They do not show intent: they say the score deserves a look, not that it is wrong.", status: "Plausible, needs validation" },
    consequence: "Decisions may rest on scores that do not reflect the work.", intervention: "Have the weekly reviewer sample the flagged unit's tasks against evidence before the next session." });
  add({ id: "P10", title: "Weeks without a report", description: "Weeks that passed with no goals filed, scoring zero.",
    hits: units.filter((u) => u.missed > 0).map((u) => ({ unit: u.name, text: `${plural(u.missed, "week")} of ${u.elapsed} with no report.` })),
    rootCause: { text: "Confirmed from the data: no weekly goals exist for those weeks.", status: "Confirmed from the data" }, consequence: "Each missed week scores zero and cannot be recovered once the quarter is locked.", intervention: "File the missing weeks now, or ask an Admin to suspend the locks so they can be filled in." });
  return out.filter((p) => p.units.length > 0).concat(out.filter((p) => p.units.length === 0));
}

// ------------------------------------------------------------------------------------------------ risks
const band = (s: number): RiskBand => (s >= 20 ? "Critical" : s >= 15 ? "Very High" : s >= 10 ? "High" : s >= 5 ? "Moderate" : "Low");
const vel = (remaining: number, now: boolean): Velocity => (now || remaining <= 3 ? "Immediate" : remaining <= 7 ? "Near-term" : "Longer-term");

function risksOf(units: UnitView[], patterns: Pattern[], repeated: RepeatedGoal[], brief: ManagementBrief, org: OrgSnapshot): RiskRow[] {
  const rows: RiskRow[] = [];
  let n = 0;
  const actionFor = (unitId: string) => brief.actions.filter((a) => a.businessUnitId === unitId);
  const make = (r: { title: string; category: RiskRow["category"]; units: UnitView[] | string[]; description: string; evidence: string; likelihood: number; impact: number; velocity: Velocity; consequence: string; mitigation: string; trigger: string; provisional?: boolean; basis: string; unitIds?: string[]; owner?: string }) => {
    const names = (r.units as (UnitView | string)[]).map((u) => (typeof u === "string" ? u : u.name));
    const ids = r.unitIds ?? (r.units as (UnitView | string)[]).filter((u): u is UnitView => typeof u !== "string").map((u) => u.id);
    const acts = ids.flatMap(actionFor);
    const measured = acts.filter((a) => a.change !== null);
    const good = measured.filter((a) => (a.change as number) >= 5).length, bad = measured.filter((a) => (a.change as number) <= 0).length;
    const controls = acts.length ? `${plural(acts.length, "management action")} logged (${acts.map((a) => a.unitName).filter((x, i, a2) => a2.indexOf(x) === i).join(", ")}); the weekly reporting and scoring cycle detects but does not correct.`
      : "None recorded. The weekly reporting and scoring cycle detects the problem but does not correct it; SMART checks are advisory.";
    const effectiveness = !acts.length ? "No control recorded to assess" : measured.length === 0 ? "Not yet assessable: no settled week since the action" : good > bad ? `Effective so far: unit score ${measured.filter((a) => (a.change as number) >= 5).map((a) => `+${(a.change as number).toFixed(0)}`).join(", ")} after action` : "Not effective so far: the score has not improved since the action";
    const residualL = good > bad && measured.length ? Math.max(1, r.likelihood - 1) : r.likelihood;
    const residual = residualL * r.impact;
    const status: RiskRow["status"] = acts.length ? "Mitigating" : band(residual) === "Low" ? "Monitoring" : "Open";
    n += 1;
    rows.push({ id: `R${String(n).padStart(2, "0")}`, title: r.title, category: r.category, units: names, description: r.description, evidence: r.evidence, likelihood: r.likelihood, impact: r.impact, inherent: r.likelihood * r.impact,
      controls, effectiveness, residualLikelihood: residualL, residual, band: band(residual), velocity: r.velocity, consequence: r.consequence,
      owner: r.owner ?? `Not recorded in the application. Suggested: ${names.length === 1 ? `BU Lead of ${names[0]}` : "an executive sponsor"}.`, mitigation: r.mitigation, trigger: r.trigger,
      resolution: "Not set in the application. Recommended: see the intervention plan.", status, provisional: r.provisional ?? false, basis: r.basis });
  };
  const rem = Math.max(0, ...units.map((u) => u.remaining));
  // quarterly target shortfall, one per unit that is not on track
  for (const u of units.filter((x) => x.outlook === "OFF_TRACK" || x.outlook === "AT_RISK")) {
    const gap = THRESHOLDS.target - (u.projected ?? THRESHOLDS.target);
    const likelihood = u.outlook === "OFF_TRACK" ? (u.reachable === false ? 5 : 4) : u.direction === "deteriorating" ? 4 : 3;
    make({ title: `${u.name} misses the quarterly target`, category: "Strategic", units: [u], description: `The unit is projected at ${pc(u.projected)} against ${THRESHOLDS.target}% at quarter end${u.direction === "deteriorating" ? " and is deteriorating" : ""}.`,
      evidence: `Score to date ${pc(u.scoreToDate)}, last week ${pc(u.last)}, ${plural(u.filed, "filed week")} of ${u.elapsed}; ${u.remaining} weeks left. Needs about ${pc(u.needed)} a week from here against a recent ${pc(u.recentAvg)}.`,
      likelihood, impact: gap >= 30 ? 4 : gap >= 15 ? 3 : 2, velocity: vel(u.remaining, false), consequence: `Unit objectives for the quarter are not met; the organisation average falls by about ${(gap / Math.max(1, org.units)).toFixed(1)} points.`,
      mitigation: u.cause ? `Address the main cause first: ${u.cause.label.toLowerCase()}. ${u.cause.detail}` : "Agree a recovery plan with the BU Lead.", trigger: `Projected score below ${THRESHOLDS.target - 20}% or two further weeks without improvement.`,
      provisional: u.confidence === "low", basis: `Likelihood from outlook (${u.outlook.replace("_", " ").toLowerCase()}${u.reachable === false ? ", target out of reach even with perfect weeks" : ""}); impact from the size of the gap (${gap.toFixed(0)} points).` });
  }
  // patterns that are already happening
  const byPattern = (id: string) => patterns.find((p) => p.id === id);
  const fromPattern = (id: string, cfg: { title: string; category: RiskRow["category"]; likelihood: (u: UnitView) => number; impact: (us: UnitView[]) => number; consequence?: string; trigger: string; basis: string; mitigate?: string; provisional?: boolean }) => {
    const p = byPattern(id);
    if (!p || !p.units.length) return;
    const us = units.filter((u) => p.units.includes(u.name));
    const likelihood = Math.max(...us.map(cfg.likelihood));
    make({ title: cfg.title, category: cfg.category, units: us, description: p.description, evidence: p.evidence.map((e) => `${e.unit}: ${e.text}`).slice(0, 4).join(" "), likelihood, impact: cfg.impact(us),
      velocity: vel(rem, false), consequence: cfg.consequence ?? p.consequence, mitigation: cfg.mitigate ?? p.intervention, trigger: cfg.trigger, provisional: cfg.provisional ?? us.every((u) => u.confidence === "low"), basis: cfg.basis });
  };
  fromPattern("P1", { title: "Task activity is not turning into goal outcomes", category: "Execution", likelihood: () => 4, impact: (us) => (us.length >= 3 ? 4 : 3), trigger: "Tasks-done minus goals-done gap above 35 points, or any further unit showing the same gap.", basis: "Already occurring, so likelihood 4; impact rises with the number of units affected." });
  fromPattern("P2", { title: "Commitments repeatedly carried over without closing", category: "Execution", likelihood: (u) => (repeated.some((r) => r.unitId === u.id && r.weeksUnfinished >= 3) ? 5 : 4), impact: (us) => (repeated.filter((r) => us.some((u) => u.id === r.unitId)).length >= 4 ? 4 : 3),
    trigger: "Any goal open four weeks or more, or a new repeated goal in an affected unit.", basis: "Already occurring; likelihood 5 where a goal has stayed open three weeks or more." });
  fromPattern("P3", { title: "Performance has stalled below target", category: "Execution", likelihood: () => 4, impact: () => 3, trigger: "A fourth flat week.", basis: "Flat weeks already recorded." });
  fromPattern("P4", { title: "Goals too loosely written to measure", category: "Operational", likelihood: () => 3, impact: () => 3, trigger: "SMART average below 50 for a unit.", basis: "Wording is advisory-checked only, so recurrence is possible rather than certain." });
  fromPattern("P5", { title: "Planned work exceeds what units can finish", category: "Operational", likelihood: () => 4, impact: () => 3, trigger: "Finished-to-planned ratio below 40%.", basis: "Planned-against-finished gap already recorded." });
  fromPattern("P6", { title: "No demonstrable owner for stalled goals", category: "Accountability", likelihood: () => 3, impact: (us) => (us.length >= 3 ? 4 : 3), provisional: true, trigger: "A goal open four weeks without a named owner.", basis: "Provisional: the application does not record goal owners, so likelihood is a judgement that needs management validation." });
  fromPattern("P9", { title: "Scores that need checking before they are relied on", category: "Reporting", likelihood: () => 3, impact: () => 4, trigger: "Three or more corrections in a unit, or a second flag.", basis: "Flags indicate risk to reliability, not proven error." });
  fromPattern("P10", { title: "Weeks scored zero for missing reports", category: "Reporting", likelihood: () => 5, impact: (us) => (Math.max(...us.map((u) => u.missed)) >= 2 ? 4 : 3), trigger: "Any further missed week.", basis: "Already occurred; each missed week is a recorded zero." });
  // organisation level
  const systemic = patterns.filter((p) => p.scope === "Organisation-wide");
  if (systemic.length >= 2) make({ title: "Systemic execution and governance weakness", category: "Governance", units: [...new Set(systemic.flatMap((p) => p.units))], description: `${systemic.length} problems recur across many units at once: ${systemic.map((p) => p.title.toLowerCase()).join("; ")}.`,
    evidence: systemic.map((p) => `${p.title}: ${p.frequency}`).join(". ") + ".", likelihood: 4, impact: 4, velocity: vel(rem, false), consequence: "The weakness is not one unit's: it will keep producing misses in the next quarter unless the way goals are set and tracked changes.",
    mitigation: "Organisation-wide reform of goal setting, ownership and weekly review (see decisions).", trigger: "A further pattern spreading to a third of the units.", provisional: false,
    basis: "Likelihood 4 because several patterns already co-occur; impact 4 because it affects a large share of units.", owner: "Executive sponsor to be named by management.", unitIds: [] });
  if (org.masking) make({ title: "The average hides weak units", category: "Strategic", units: units.filter((u) => (u.projected ?? 100) < THRESHOLDS.target), description: "The organisation average meets target while some units are below it, so the headline could be read as safe.",
    evidence: `Average ${pc(org.projectedUnweighted)}; ${plural(org.belowTarget, "unit")} below ${THRESHOLDS.target}%.`, likelihood: 4, impact: 3, velocity: "Near-term", consequence: "Management attention goes elsewhere while individual units fail.",
    mitigation: "Report the number of units below target beside the average.", trigger: "Any unit more than 20 points below target.", basis: "Arithmetic fact about the spread.", owner: "Not recorded.", unitIds: [] });
  const gaps = brief.coverage.filter((c) => c.status === "uncovered");
  if (gaps.length && units.some((u) => u.filed >= 2)) make({ title: "Strategy not covered by weekly work", category: "Strategic", units: ["Organisation"], description: `${plural(gaps.length, "Sub-KR")} have no weekly goal supporting them: ${gaps.slice(0, 5).map((g) => g.code).join(", ")}.`,
    evidence: `${gaps.length} of ${brief.coverage.length} Sub-KRs uncovered after ${plural(Math.max(...units.map((u) => u.filed)), "filed week")}.`, likelihood: 4, impact: gaps.length >= 3 ? 4 : 3, velocity: vel(rem, false),
    consequence: "Parts of the strategy cannot be met because nobody is working on them.", mitigation: "Assign each uncovered Sub-KR to a unit this week, or revise the strategy.", trigger: "Any uncovered Sub-KR with fewer than six weeks left.", basis: "Count of uncovered Sub-KRs from weekly goal alignment.", owner: "Not recorded.", unitIds: [] });
  const q = brief.queues;
  const waits = q ? ([["attendance amendments", q.attendanceAmendments], ["fund requests", q.disbursements], ["configuration changes", q.configChanges], ["late-report exceptions", q.lateReportExceptions]] as const).filter(([, x]) => x.waiting > 0) : [];
  if (waits.length) { const oldest = Math.max(...waits.map(([, x]) => x.oldestDays)); make({ title: "Decisions waiting too long", category: "Governance", units: ["Organisation"], description: `${waits.map(([l, x]) => `${x.waiting} ${l}`).join(", ")} awaiting decision.`,
    evidence: `Oldest has waited ${oldest} ${oldest === 1 ? "day" : "days"}.`, likelihood: oldest >= 7 ? 4 : 3, impact: 2, velocity: oldest >= 7 ? "Near-term" : "Longer-term", consequence: "Delays hold up staff, funds and corrections.", mitigation: "Clear the queues and agree a turnaround time.", trigger: "Any item waiting more than 7 days.", basis: "Queue age from the application.", owner: "Not recorded.", unitIds: [] }); }
  const lowConf = units.filter((u) => u.confidence === "low" && u.projected !== null);
  if (lowConf.length >= 3) make({ title: "Forecasts rest on too little history", category: "Operational", units: lowConf, description: "Several units have fewer than three weeks of evidence, so their projections are weak.", evidence: `${plural(lowConf.length, "unit")} with low forecast confidence.`,
    likelihood: 3, impact: 2, velocity: "Longer-term", consequence: "Decisions could be made on a projection that moves a lot as weeks arrive.", mitigation: "Treat these forecasts as provisional until more weeks are settled.", trigger: "Reassess after three more settled weeks.", provisional: true, basis: "Count of units with fewer than three settled weeks.", owner: "Not recorded.", unitIds: [] });
  return rows.sort((a, b) => b.residual - a.residual || b.inherent - a.inherent);
}

// ------------------------------------------------------------------------------------------------ early warning
function indicatorsOf(units: UnitView[], repeated: RepeatedGoal[], brief: ManagementBrief): Indicator[] {
  const bf = new Map(brief.units.map((u) => [u.businessUnitId, u]));
  const mk = (i: Omit<Indicator, "affected" | "observed">, test: (u: UnitView) => { value: string; level: "warning" | "escalate" } | null): Indicator => {
    const affected = units.flatMap((u) => { const t = test(u); return t ? [{ unit: u.name, ...t }] : []; });
    return { ...i, affected, observed: affected.length ? `${plural(affected.length, "unit")} past a warning line, ${affected.filter((a) => a.level === "escalate").length} past the escalation line.` : "No unit is past a warning line." };
  };
  const level = (v: number, w: number, e: number) => (v >= e ? "escalate" as const : v >= w ? "warning" as const : null);
  const lv = (v: number, w: number, e: number, text: string) => { const l = level(v, w, e); return l ? { value: text, level: l } : null; };
  const repRun = (id: string) => Math.max(0, ...repeated.filter((r) => r.unitId === id).map((r) => r.weeksUnfinished));
  return [
    mk({ id: "E1", title: "Consecutive weeks without progress", description: "Weekly score within 5 points of the week before while below target.", warning: "2 weeks", escalation: "3 weeks", response: "BU Lead presents a changed plan at the next weekly session." }, (u) => lv(u.stagnationRun, 2, 3, `${u.stagnationRun} weeks`)),
    mk({ id: "E2", title: "Repeated goal rollover", description: "The same goal unfinished in consecutive weeks.", warning: "2 weeks", escalation: "3 weeks", response: "Owner states a recovery plan, or the goal is restructured or retired." }, (u) => lv(repRun(u.id), 2, 3, `${repRun(u.id)} weeks`)),
    mk({ id: "E3", title: "Declining weekly performance", description: "Consecutive weekly drops of 5 points or more.", warning: "2 drops", escalation: "3 drops", response: "Find what changed: capacity, staffing, goal size." }, (u) => lv(u.declineRun, 2, 3, `${u.declineRun} drops`)),
    mk({ id: "E4", title: "High volatility", description: "Spread of weekly scores.", warning: `${THRESHOLDS.volatilitySd - 5} points`, escalation: `${THRESHOLDS.volatilitySd + 5} points`, response: "Level the weekly load; review how goals are sized." }, (u) => (u.filed >= 4 ? lv(u.volatility, THRESHOLDS.volatilitySd - 5, THRESHOLDS.volatilitySd + 5, `${u.volatility.toFixed(0)} points`) : null)),
    mk({ id: "E5", title: "Widening quarterly gap", description: "Projected quarter score against target.", warning: `Below ${THRESHOLDS.target}%`, escalation: `Below ${THRESHOLDS.intervention}%`, response: "Recovery plan now; escalate to the executive sponsor." }, (u) => (u.projected === null ? null : u.projected < THRESHOLDS.intervention ? { value: pc(u.projected), level: "escalate" } : u.projected < THRESHOLDS.target ? { value: pc(u.projected), level: "warning" } : null)),
    mk({ id: "E6", title: "Tasks without goal achievement", description: "Share of tasks done minus share of goals done.", warning: `${THRESHOLDS.tasksOverGoals} points`, escalation: "35 points", response: "Review the undone last task of each open goal." }, (u) => (u.taskCompletion !== null && u.goalCompletion !== null && u.goalsTotal >= 6 ? lv(u.taskCompletion - u.goalCompletion, THRESHOLDS.tasksOverGoals, 35, `${(u.taskCompletion - u.goalCompletion).toFixed(0)} points`) : null)),
    mk({ id: "E7", title: "Reporting delays and gaps", description: "Missed weeks and reports filed after the content lock.", warning: "1 missed week or 25% late", escalation: "2 missed weeks or 50% late", response: "Remind the BU Lead; ask an Admin to suspend locks if weeks must be filled." }, (u) => {
      const b = bf.get(u.id)?.integrity.latePct ?? null;
      if (u.missed >= 2 || (b ?? 0) >= 50) return { value: `${u.missed} missed${b === null ? "" : `, ${b.toFixed(0)}% late`}`, level: "escalate" };
      if (u.missed >= 1 || (b ?? 0) >= 25) return { value: `${u.missed} missed${b === null ? "" : `, ${b.toFixed(0)}% late`}`, level: "warning" };
      return null;
    }),
    mk({ id: "E8", title: "Previously strong unit deteriorating", description: "Earlier weeks averaged at or above target; the last two fell well below that.", warning: "20 points below earlier average", escalation: "30 points below", response: "Executive check-in with the BU Lead within the week." },
      (u) => { if (u.earlierAvg === null || u.earlierAvg < THRESHOLDS.target || u.series.length < 4) return null; const now2 = mean(u.series.slice(-2)) as number; return lv(u.earlierAvg - now2, 20, 30, `${u.earlierAvg.toFixed(0)}% earlier, ${now2.toFixed(0)}% now`); }),
    mk({ id: "E9", title: "Dependence on one goal", description: "Share of completed goals supporting a single unit goal.", warning: `${THRESHOLDS.concentration}%`, escalation: "80%", response: "Check that the unit's other goals are worked." }, (u) => (u.concentrationPct === null ? null : lv(u.concentrationPct, THRESHOLDS.concentration, 80, pc(u.concentrationPct)))),
  ];
}

// ------------------------------------------------------------------------------------------------ cross-unit
function crossOf(units: UnitView[], patterns: Pattern[]): ExecutiveReport["cross"] {
  const by = new Map<string, { label: string; units: string[] }>();
  for (const u of units.filter((x) => x.cause)) { const c = u.cause!; const e = by.get(c.code) ?? { label: c.label, units: [] }; e.units.push(u.name); by.set(c.code, e); }
  const causes = [...by.values()].sort((a, b) => b.units.length - a.units.length);
  const underperformers = units.filter((u) => u.filed >= 4 && (u.projected ?? 100) < THRESHOLDS.intervention && u.direction !== "improving").map((u) => u.name);
  const fastest = units.filter((u) => u.series.length >= 4).map((u) => ({ name: u.name, delta: round1((mean(u.series.slice(-2)) as number) - (mean(u.series.slice(0, -2)) as number)) })).filter((x) => x.delta >= THRESHOLDS.improving).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const strong = units.filter((u) => (u.projected ?? 0) >= THRESHOLDS.target && u.filed >= 3), rest = units.filter((u) => u.projected !== null && !strong.includes(u) && u.filed >= 1);
  const avgOf = (us: UnitView[], f: (u: UnitView) => number | null) => { const v = us.map(f).filter((x): x is number => x !== null); return v.length ? round1(mean(v) as number) : null; };
  const fmt = (v: number | null, s = "") => (v === null ? "not known" : `${v.toFixed(1)}${s}`);
  const practices = strong.length && rest.length ? [
    { measure: "Tasks per goal", f: (u: UnitView) => u.analysis.difficulty.tasksPerGoal, s: "" }, { measure: "Goals with a number", f: (u: UnitView) => u.analysis.difficulty.measurablePct, s: "%" },
    { measure: "Goals with a deadline", f: (u: UnitView) => u.analysis.difficulty.deadlinePct, s: "%" }, { measure: "SMART average", f: (u: UnitView) => u.analysis.difficulty.avgSmart, s: "" },
    { measure: "Tasks planned a week", f: (u: UnitView) => u.analysis.capacity.plannedPerWeek, s: "" },
  ].map((m) => ({ measure: m.measure, top: fmt(avgOf(strong, m.f), m.s), others: fmt(avgOf(rest, m.f), m.s) })) : [];
  return { causes, underperformers, fastest, practices,
    practicesNote: strong.length && rest.length ? `Compared across ${plural(strong.length, "unit")} projected at target or better and ${plural(rest.length, "other unit")}. A difference here is a correlation: it does not show that the practice causes the result.` : "No unit is projected at target yet, so there is no strong group to learn from.",
    systemic: patterns.filter((p) => p.scope === "Organisation-wide").map((p) => `${p.title} (${p.frequency})`), individual: patterns.filter((p) => p.scope === "Unit-level").map((p) => `${p.title}: ${list(p.units)}`) };
}

function positivesOf(units: UnitView[]): ExecutiveReport["positives"] {
  const out: ExecutiveReport["positives"] = [];
  for (const u of units) {
    const s = u.series;
    if (s.length < 3) continue;
    const up = s.slice(1).map((v, i) => v - s[i]);
    const lastTwo = up.slice(-2);
    const now3 = mean(s.slice(-3)) as number, before3 = s.length >= 6 ? mean(s.slice(-6, -3)) as number : null;
    if (u.direction === "improving" && lastTwo.every((d) => d > 0) && (before3 === null || now3 - before3 >= 5)) {
      out.push({ unit: u.name, kind: before3 !== null && before3 < THRESHOLDS.intervention ? "Recovering" : "Sustained improvement", text: `Up from ${pc(u.earlierAvg)} earlier to ${pc(mean(s.slice(-2)) as number)} in the last two weeks, rising in each.`,
        sustainable: `Likely to last if the last-two-week level holds: the rise is in ${plural(lastTwo.length, "consecutive week")}, not one. Check that goals were not made lighter.${u.analysis.difficulty.level === "light" ? " Goals are light, so treat the improvement with caution." : ""}` });
    } else if ((u.delta ?? 0) >= 20) {
      out.push({ unit: u.name, kind: "One-week movement", text: `Up ${u.delta?.toFixed(0)} points last week to ${pc(u.last)}, after ${pc(u.previous)}.`, sustainable: "One week is not a trend: wait for a second week above this level before treating it as improvement." });
    } else if (u.filed >= 4 && u.volatility <= 10 && (mean(s) as number) >= 70) {
      out.push({ unit: u.name, kind: "Steady and strong", text: `Averages ${pc(mean(s) as number)} with only ${u.volatility.toFixed(0)} points of swing across ${plural(u.filed, "week")}.`, sustainable: "Stable across several weeks, which is a good sign of a working routine." });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the plan and the decisions
function actionsOf(units: UnitView[], patterns: Pattern[], repeated: RepeatedGoal[], latest: number | null): Action[] {
  const wk = (n: number) => (latest === null ? "Within the next weekly cycle" : `By the end of week ${latest + n}`);
  const out: Action[] = [];
  const off = units.filter((u) => u.outlook === "OFF_TRACK");
  for (const u of off.slice(0, 4)) out.push({ tier: "Immediate", priority: u.reachable === false ? "Critical" : "High", finding: `${u.name} is off track: projected ${pc(u.projected)} against ${THRESHOLDS.target}%.`,
    evidence: `Score to date ${pc(u.scoreToDate)}; last week ${pc(u.last)} (${u.delta === null ? "no comparison" : `${u.delta >= 0 ? "+" : ""}${u.delta.toFixed(0)}`}); ${plural(u.filed, "filed week")} of ${u.elapsed}.${u.cause ? ` Main cause: ${u.cause.label}.` : ""}`,
    action: `Executive meets the BU Lead of ${u.name} this week; the BU Lead brings a recovery plan with at most ${Math.max(3, Math.round((u.analysis.capacity.donePerWeek ?? 6)))} finishable goals a week and a named owner for each.`, outcome: `Weekly score back above ${Math.min(100, Math.max(55, u.needed ?? 55)).toFixed(0)}% for the remaining weeks.`,
    owner: `Executive sponsor with the BU Lead of ${u.name} (suggested; no owner is recorded)`, deadline: wk(1), measure: `Weekly score at or above ${pc(u.needed === null ? null : Math.min(100, u.needed))} for two consecutive weeks.`, escalation: "Score still falling after two weeks." });
  const stalled = repeated.filter((r) => r.classification === "Potentially abandoned" || r.classification === "Stagnant goal").slice(0, 3);
  for (const r of stalled) out.push({ tier: "Immediate", priority: "High", finding: `“${r.title.slice(0, 80)}” (${r.unit}) is ${r.classification.toLowerCase()}.`, evidence: `${r.why} Weeks ${r.first}-${r.last}. Goal refs ${r.refs.join(", ")}.`,
    action: "Owner decides in the next weekly session: finish it with a dated plan, restructure it into smaller goals, or retire it.", outcome: "The goal is closed, restructured or retired and no longer carries forward by default.", owner: `BU Lead of ${r.unit} (suggested)`, deadline: wk(1), measure: "Goal marked done, or retired with a reason, or replaced by smaller dated goals.", escalation: "Still unfinished in the following week." });
  for (const p of patterns.filter((x) => x.scope === "Organisation-wide").slice(0, 3)) out.push({ tier: "Short-term", priority: "High", finding: `${p.title} across ${p.frequency}.`, evidence: p.evidence.slice(0, 3).map((e) => `${e.unit}: ${e.text}`).join(" "),
    action: p.intervention, outcome: `The pattern no longer appears in ${list(p.units, 3)} within two reporting weeks.`, owner: "Executive sponsor to be named", deadline: wk(2), measure: "The unit count for this pattern in the next report is lower.", escalation: "The pattern spreads to more units." });
  for (const u of units.filter((x) => x.outlook === "AT_RISK" && !off.includes(x)).slice(0, 4)) out.push({ tier: "Short-term", priority: "Medium", finding: `${u.name} is at risk: projected ${pc(u.projected)}.`, evidence: `Needs about ${pc(u.needed)} a week against a recent ${pc(u.recentAvg)}.${u.cause ? ` Main cause: ${u.cause.label}.` : ""}`,
    action: u.cause ? `Address "${u.cause.label.toLowerCase()}": ${u.cause.detail}` : "Agree a short recovery plan.", outcome: "Projection moves to target within three weeks.", owner: `BU Lead of ${u.name} (suggested)`, deadline: wk(2), measure: `Projected quarter score at or above ${THRESHOLDS.target}%.`, escalation: "Projection falls further, or the unit becomes off track." });
  const weak = patterns.find((p) => p.id === "P4" && p.units.length);
  if (weak) out.push({ tier: "Medium-term" as const, priority: "Medium", finding: `Weakly defined goals in ${plural(weak.units.length, "unit")}.`, evidence: weak.evidence.slice(0, 2).map((e) => `${e.unit}: ${e.text}`).join(" "), action: "Adopt a rule that every goal carries a number and a deadline before it is accepted, and review the SMART average each week.",
    outcome: "Goals are measurable and dated at the start of the week.", owner: "Executive sponsor with HR (suggested)", deadline: "Before the next quarter's goals are set", measure: "Share of goals with a number and a deadline above 80%.", escalation: "Below 60% after four weeks." });
  const cap = patterns.find((p) => p.id === "P5" && p.units.length);
  if (cap) out.push({ tier: "Medium-term", priority: "Medium", finding: `Over-commitment in ${list(cap.units, 3)}.`, evidence: cap.evidence.slice(0, 2).map((e) => `${e.unit}: ${e.text}`).join(" "), action: "Introduce a weekly planning limit set from each unit's finished average.", outcome: "Planned and finished work move closer together.", owner: "BU Leads (suggested)", deadline: "Next quarter's planning", measure: "Finished-to-planned ratio above 70%.", escalation: "Ratio below 40% in any unit." });
  const own = patterns.find((p) => p.id === "P6" && p.units.length);
  if (own) out.push({ tier: "Medium-term", priority: "Medium", finding: "The application does not record who owns a goal or what blocks it.", evidence: "No owner, rollover or dependency field exists, so accountability for stalled goals cannot be shown.", action: "Add an owner and a blocker note to weekly goals so stalled goals can be traced to a person and a cause.", outcome: "Accountability for each open goal can be shown.", owner: "Product owner of the application (suggested)", deadline: "Next quarter", measure: "Every goal open two weeks or more has an owner recorded.", escalation: "Not applicable." });
  if (!out.length) out.push({ tier: "Short-term", priority: "Low", finding: "No unit needs a corrective plan this week.", evidence: "No unit is off track and no pattern is organisation-wide.", action: "Keep the weekly cycle and review the early warning indicators.", outcome: "Performance holds.", owner: "Not applicable", deadline: wk(1), measure: "All units stay at or above target.", escalation: "Any indicator reaches its escalation line." });
  return out;
}

function decisionsOf(units: UnitView[], patterns: Pattern[], repeated: RepeatedGoal[], org: OrgSnapshot, brief: ManagementBrief): Decision[] {
  const out: Decision[] = [];
  const off = units.filter((u) => u.outlook === "OFF_TRACK");
  if (off.length) out.push({ decision: `Direct executive intervention in ${list(off.map((u) => u.name), 4)}?`, why: "These units are projected well below target and routine weekly review has not turned them round.", evidence: off.map((u) => `${u.name} ${pc(u.projected)}`).join("; "),
    ifNot: "They are likely to finish the quarter far below target, and the average falls with them.", position: "Recommendation: yes, with a named executive and a dated recovery plan for each." });
  const stuck = repeated.filter((r) => r.classification === "Potentially abandoned" || r.classification === "Stagnant goal" || r.classification === "Repeatedly rolled-over goal");
  if (stuck.length) out.push({ decision: `Restructure or retire the ${plural(stuck.length, "goal")} that keep carrying over?`, why: "They have stayed open for three weeks or more.", evidence: stuck.slice(0, 3).map((r) => `${r.unit}: “${r.title.slice(0, 50)}” (${r.weeksUnfinished} weeks)`).join("; "),
    ifNot: "They keep occupying the weekly plan and keep scoring zero.", position: "Recommendation: require each owner to finish, split or retire the goal at the next session." });
  const sys = patterns.filter((p) => p.scope === "Organisation-wide");
  if (sys.length) out.push({ decision: "Reform how goals are set and tracked across the organisation?", why: "The same weaknesses appear in a third or more of the units, which points to the process, not to individual units.", evidence: sys.map((p) => `${p.title}: ${p.frequency}`).join("; "),
    ifNot: "The same misses will repeat next quarter.", position: "Recommendation: yes. Start with a rule for numbers and dates in goals and an owner for any goal open past two weeks." });
  const over = units.filter((u) => u.analysis.capacity.overcommitted);
  if (over.length) out.push({ decision: "Review unrealistic commitments in over-committed units?", why: "They plan far more than they finish.", evidence: over.map((u) => `${u.name} ${pc(u.analysis.capacity.ratio)} finished`).join("; "), ifNot: "Goals keep missing for the same reason.", position: "Recommendation: cap weekly planned tasks at each unit's finished average." });
  const gaps = brief.coverage.filter((c) => c.status === "uncovered");
  if (gaps.length) out.push({ decision: `Assign owners for ${plural(gaps.length, "uncovered Sub-KR")}, or revise the strategy?`, why: "No weekly goal supports them.", evidence: gaps.slice(0, 5).map((g) => g.code).join(", "), ifNot: "Those parts of the strategy cannot be met.", position: "Recommendation: assign each to a unit this week." });
  const q = brief.queues;
  if (q) { const w = [q.attendanceAmendments, q.disbursements, q.configChanges, q.lateReportExceptions].filter((x) => x.waiting > 0 && x.oldestDays >= 7); if (w.length) out.push({ decision: "Clear decisions that have waited a week or more?", why: "Waiting items hold up staff, funds and corrections.", evidence: `${w.reduce((n, x) => n + x.waiting, 0)} items; oldest ${Math.max(...w.map((x) => x.oldestDays))} days.`, ifNot: "Delays compound and trust in the process falls.", position: "Recommendation: decide this week and agree a turnaround time." }); }
  if (org.masking) out.push({ decision: "Report units below target alongside the average?", why: "The average meets target while some units are below it.", evidence: `Average ${pc(org.projectedUnweighted)}, ${plural(org.belowTarget, "unit")} below target.`, ifNot: "The headline can be read as safe while units fail.", position: "Recommendation: yes; show both every week." });
  return out;
}

// ------------------------------------------------------------------------------------------------ the whole report
export function buildExecutiveReport(input: { brief: ManagementBrief; facts: GoalFact[]; frame: QuarterFrame; quarterLabel: string; now: string }): ExecutiveReport {
  const { brief, facts } = input;
  const units = brief.units.map((u) => viewOf(u, facts));
  const org = snapshot(units, brief);
  const repeated = repeatedGoals(units, facts);
  const themes = themesOf(repeated, units.map((u) => u.name));
  const patterns = patternsOf(units, repeated);
  const risks = risksOf(units, patterns, repeated, brief, org);
  const speed = { Immediate: 0, "Near-term": 1, "Longer-term": 2 } as const;
  const topRisks = [...risks].sort((a, b) => b.residual - a.residual || speed[a.velocity] - speed[b.velocity] || b.impact - a.impact).slice(0, 5);
  const moderate = risks.filter((r) => r.band === "Moderate");
  const collective = [...new Set(moderate.map((r) => r.category))].map((c) => ({ category: c, rows: moderate.filter((r) => r.category === c) })).filter((g) => g.rows.length >= 3)
    .map((g) => ({ category: g.category, count: g.rows.length, units: [...new Set(g.rows.flatMap((r) => r.units))], note: `${g.rows.length} moderate ${g.category.toLowerCase()} risks together point to a wider problem than any one of them suggests.` }));
  const indicators = indicatorsOf(units, repeated, brief);
  const cross = crossOf(units, patterns);
  const positives = positivesOf(units);
  const actions = actionsOf(units, patterns, repeated, org.latestWeek);
  const decisions = decisionsOf(units, patterns, repeated, org, brief);

  // ---------------------------------------------------------------- checks on the numbers
  const checks: ExecutiveReport["quality"]["checks"] = [];
  const briefAvg = brief.org.averageProjectedQuarter;
  checks.push({ check: "Organisation average recomputed from the units", result: briefAvg !== null && org.projectedUnweighted !== null ? (Math.abs(briefAvg - org.projectedUnweighted) < 0.2 ? "Agrees" : "Differs") : "Not checkable",
    detail: `Brief ${pc(briefAvg, 1)}, recomputed ${pc(org.projectedUnweighted, 1)}. The average is unweighted: each unit counts once whatever its size. Weighted by goals filed it is ${pc(org.projectedWeighted, 1)}.` });
  const sumCounts = Object.values(org.counts).reduce((a, b) => a + b, 0);
  checks.push({ check: "Units on track + at risk + off track + no data = units", result: sumCounts === units.length ? "Agrees" : "Differs", detail: `${sumCounts} classified of ${units.length} units.` });
  const misclass = units.filter((u) => u.outlook === "ON_TRACK" && u.projected !== null && u.projected < THRESHOLDS.target);
  checks.push({ check: "Every on-track unit is projected at or above target", result: misclass.length ? "Differs" : "Agrees", detail: misclass.length ? `${list(misclass.map((u) => `${u.name} (${pc(u.projected)})`))}: the outlook also considers each unit goal, so a unit can be flagged at risk although its blended figure meets target, or the reverse.` : "No exception." });
  const gap = units.filter((u) => u.taskCompletion !== null && u.goalCompletion !== null && Math.abs(u.taskCompletion - u.goalCompletion) >= 40);
  checks.push({ check: "Tasks done against goals done", result: gap.length ? "Differs" : "Agrees", detail: gap.length ? `${list(gap.map((u) => `${u.name} (${pc(u.taskCompletion)} vs ${pc(u.goalCompletion)})`))}: reported progress and goal outcomes disagree and should be explained.` : "No unit differs by 40 points or more." });
  const missing = units.filter((u) => u.missed > 0);
  checks.push({ check: "Weeks scored from reports", result: missing.length ? "Differs" : "Agrees", detail: missing.length ? `${list(missing.map((u) => `${u.name} (${u.missed})`))} have weeks with no report; these count as zero in "actual to date" but are left out of "reported".` : "Every unit filed every elapsed week." });
  const limitations = [
    "Goal owner: not recorded, so accountability findings are hypotheses.",
    "Rollover: the application does not mark a goal as rolled over. Repeated goals are found by matching wording between weeks, so a goal re-worded each week is missed and two similar goals can be merged.",
    "Goal creation and change history is not used, so a goal whose scope changed cannot be told from one that did not.",
    "Progress on a goal is only done or not done; partial progress is read from the share of its tasks done, which is an approximation.",
    "Blockers, dependencies and escalations are not recorded, so causes are separated into those the data confirms and those that need validation.",
    "Target: one quarter target of 70% applies to every unit. Units have no separate targets in the application.",
    `Forecast: the weekly trend is projected forward with a damped slope and thin coverage pulls it down. ${units.filter((u) => u.confidence === "low").length} units have fewer than three settled weeks, so their forecasts are low confidence.`,
    "History across quarters is not compared here: this report covers the selected quarter only.",
  ];
  const assumptions = [
    "A week still in progress is not counted. A holiday week is excluded.",
    `Classifications: on track at ${THRESHOLDS.target}% projected or more, at risk from 50%, off track below. Forecast classes: exceed at ${THRESHOLDS.exceed}%, achieve at ${THRESHOLDS.target}%, achievable with intervention from ${THRESHOLDS.intervention}%, unlikely below.`,
    `Proposed (not approved) thresholds: materially below target = ${THRESHOLDS.materiallyBelow} points below; improving or deteriorating = a change of ${THRESHOLDS.improving} points between the last two weeks and the two before; volatility warning above ${THRESHOLDS.volatilitySd - 5} points of spread. Risk bands: 1-4 Low, 5-9 Moderate, 10-14 High, 15-19 Very High, 20-25 Critical. Management should approve or change these.`,
    "Risk likelihood and impact are rule-based from the data and shown with their basis; ratings marked provisional need management validation. Residual risk lowers likelihood by one only where a logged management action was followed by an improvement of five points or more.",
  ];

  // ---------------------------------------------------------------- the executive summary
  const findings: { text: string; basis: Basis }[] = [];
  findings.push({ text: `${org.verdict} ${plural(org.counts.ON_TRACK, "unit")} on track, ${org.counts.AT_RISK} at risk, ${org.counts.OFF_TRACK} off track${org.counts.NO_DATA ? `, ${org.counts.NO_DATA} not yet forecastable` : ""}.`, basis: "CALCULATED" });
  if (org.projectedUnweighted !== null) findings.push({ text: `The projected quarter average is ${pc(org.projectedUnweighted, 1)} against ${THRESHOLDS.target}% (median ${pc(org.median)}, range ${org.min ? `${org.min.name} ${org.min.value.toFixed(0)}%` : "n/a"} to ${org.max ? `${org.max.name} ${org.max.value.toFixed(0)}%` : "n/a"}). ${org.belowTarget} of ${org.withForecast} units are below target and ${org.materiallyBelow} are materially below it.${org.reachable === false ? " The remaining weeks cannot lift the average to target even at 100%." : org.stepUp !== null && org.stepUp > 0 ? ` To close the gap units need about ${pc(org.neededWeekly)} a week against a recent ${pc(org.recentWeekly)}: a step-up of ${org.stepUp.toFixed(0)} points.` : ""}`, basis: "FORECAST" });
  if (org.weekDelta !== null) findings.push({ text: `Week ${org.latestWeek} averaged ${pc(org.thisWeek)} against ${pc(org.lastWeek)} in week ${org.previousWeek} (${org.weekDelta >= 0 ? "+" : ""}${org.weekDelta.toFixed(0)} points). ${plural(org.improving.length, "unit")} improving, ${org.deteriorating.length} deteriorating, ${org.stagnant.length} flat.`, basis: "CALCULATED" });
  const sys = patterns.filter((p) => p.scope === "Organisation-wide");
  if (sys.length) findings.push({ text: `${sys.length === 1 ? "One problem recurs" : `${sys.length} problems recur`} across many units: ${sys.map((p) => `${p.title.toLowerCase()} (${p.units.length} units)`).join("; ")}. This points to how goals are set and tracked, not to single units.`, basis: "INTERPRETATION" });
  if (topRisks.length) findings.push({ text: `Highest residual risk: ${topRisks[0].title} (${topRisks[0].band}, ${topRisks[0].residual}). ${plural(topRisks.filter((r) => r.band === "Critical" || r.band === "Very High").length, "risk")} ${topRisks.filter((r) => r.band === "Critical" || r.band === "Very High").length === 1 ? "is" : "are"} Very High or Critical.`, basis: "INTERPRETATION" });
  if (repeated.length) findings.push({ text: `${plural(repeated.length, "goal")} were set in two or more weeks without being finished; ${repeated.filter((r) => r.weeksUnfinished >= 3).length} for three weeks or more.${themes.length ? ` The recurring theme "${themes[0].theme}" appears in ${themes[0].units.length} units.` : ""}`, basis: "FACT" });
  if (decisions.length) findings.push({ text: `${plural(decisions.length, "decision")} for management are set out in section 14.`, basis: "RECOMMENDATION" });
  const headline = org.withForecast === 0 ? "There is not yet enough settled data to say whether the organisation is on track."
    : org.counts.OFF_TRACK >= 3 || org.projectedUnweighted !== null && org.projectedUnweighted < 55 ? "The organisation is not on course for its quarter target and several units need executive intervention."
    : org.masking ? "The average looks safe, but it is held up by strong units while others fall short."
    : org.counts.AT_RISK + org.counts.OFF_TRACK > 0 ? "The organisation is close to target overall, with units that need attention."
    : "The organisation is on track.";
  return { quarterLabel: input.quarterLabel, latestWeek: brief.latestWeek, generatedFor: input.now, units, org, repeated, themes, patterns, risks, topRisks, collective, indicators, cross, positives, actions, decisions,
    summary: { headline, findings }, quality: { limitations, checks, assumptions } };
}

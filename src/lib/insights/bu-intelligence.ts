// Intelligence on whether a Business Unit's quarterly goals will be met, built only from what the application already captures:
// the unit's goals for the quarter, the weekly goals aligned to them, those goals' tasks and how well they are written.
// Everything is a fixed, explainable rule (no model, no guessing): the same data always gives the same answer, and every figure says how it was reached.
// A forecast is an estimate. It is labelled with a confidence that grows with the number of weeks of evidence.

export interface GoalFact {
  goalId: string; businessUnitId: string; weekId: string; weekNumber: number; weekStart: string; submitted: boolean;
  buGoalId: string | null; subKrCode: string | null; krCode: string | null; title: string; done: boolean;
  tasksTotal: number; tasksDone: number; tasksUndefined: number; smart: number | null;
}
export interface BuGoalInput { id: string; code?: string; businessUnitId: string; title: string; status: "ACTIVE" | "RETIRED" }
export interface QuarterFrame { startsOn: string; endsOn: string; weeks: { id: string; number: number; start: string; holiday: boolean }[] }

export type Outlook = "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "NO_DATA";
export type Severity = "high" | "medium" | "low";
export interface GoalOutlook {
  id: string; code?: string; title: string; outlook: Outlook; weeklyGoals: number; doneGoals: number; weeksActive: number;
  completion: number | null; recent: number | null; trend: number | null; projected: number | null;
  confidence: "low" | "medium" | "high"; lastActiveWeek: number | null; series: (number | null)[]; note: string;
}
export interface Risk { id: string; severity: Severity; title: string; detail: string; action: string }
export interface Alignment {
  weeklyGoals: number; aligned: number; unaligned: number; alignedPct: number | null;
  orphaned: string[]; concentration: { title: string; pct: number } | null;
  weakWording: { goal: string; buGoal: string }[]; krCoverage: { kr: string; goals: number }[];
}
export interface Prediction {
  target: number; weeksElapsed: number; weeksRemaining: number; scoreToDate: number | null; projectedQuarterScore: number | null; range: [number, number] | null;
  neededWeeklyAverage: number | null; reachable: boolean | null; direction: "improving" | "steady" | "declining" | null; expectedGoalsDone: number | null;
}
export interface BuIntelligence {
  businessUnitId: string; unitName: string; outlook: Outlook; headline: string; progressPct: number;
  goals: GoalOutlook[]; alignment: Alignment; risks: Risk[]; prediction: Prediction; evidenceWeeks: number;
}

export const TARGET_QUARTER_SCORE = 70;
const ON_TRACK_AT = 70, AT_RISK_AT = 50;

const STOP = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "with", "from", "into", "as", "is", "are", "be", "this", "that", "its", "our", "their", "all", "each", "every", "any", "new", "this", "quarter", "week", "friday", "thursday", "wednesday", "monday", "tuesday"]);
function stem(raw: string): string {
  let w = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}
export const keys = (s: string) => new Set(s.split(/\s+/).map(stem).filter((w) => w.length > 2 && !STOP.has(w)));

export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
/** Recent weeks count more: weights 1, 2, 3 … in time order. */
export function recencyWeighted(values: number[]): number | null {
  if (!values.length) return null;
  let num = 0, den = 0;
  values.forEach((v, i) => { num += v * (i + 1); den += i + 1; });
  return num / den;
}
/** Least-squares slope in points per week over the values in order; null with fewer than three points. */
export function slope(values: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const xs = values.map((_, i) => i), mx = (n - 1) / 2, my = values.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den === 0 ? 0 : xs.reduce((a, x, i) => a + (x - mx) * (values[i] - my), 0) / den;
}
export const stdev = (a: number[]) => { const m = mean(a); return m === null || a.length < 2 ? 0 : Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

export function buildBuIntelligence(input: { unit: { id: string; name: string }; frame: QuarterFrame; now: string; buGoals: BuGoalInput[]; facts: GoalFact[] }): BuIntelligence {
  const { unit, frame } = input;
  const now = new Date(input.now).getTime();
  const goalsOfUnit = input.buGoals.filter((g) => g.businessUnitId === unit.id);
  const active = goalsOfUnit.filter((g) => g.status === "ACTIVE");
  const facts = input.facts.filter((f) => f.businessUnitId === unit.id);

  const reportable = frame.weeks.filter((w) => !w.holiday);
  // A week still being worked (it has not ended and some of its tasks are not yet marked) is not evidence yet: counting its half-finished goals as failures
  // would drag every forecast down. It stays among the weeks still to come until it ends or its tasks are all decided.
  const inProgress = (w: { id: string; start: string }) => new Date(w.start).getTime() + 7 * 864e5 > now && (!facts.some((f) => f.weekId === w.id) || facts.some((f) => f.weekId === w.id && f.tasksUndefined > 0));   // a running week with no report is not missed until it is over
  const elapsed = reportable.filter((w) => new Date(w.start).getTime() <= now && !inProgress(w));
  const remaining = Math.max(0, reportable.length - elapsed.length);
  const progressPct = reportable.length ? round1((elapsed.length / reportable.length) * 100) : 0;
  const factsByWeek = new Map<string, GoalFact[]>();
  for (const f of facts) factsByWeek.set(f.weekId, [...(factsByWeek.get(f.weekId) ?? []), f]);
  const weeksWithGoals = elapsed.filter((w) => (factsByWeek.get(w.id) ?? []).length > 0);

  // ---------------------------------------------------------------- each unit goal
  const goals: GoalOutlook[] = active.map((bg) => {
    const mine = facts.filter((f) => f.buGoalId === bg.id);
    const series = elapsed.map((w) => { const g = mine.filter((f) => f.weekId === w.id); return g.length ? round1(pct(g.filter((f) => f.done).length, g.length) ?? 0) : null; });
    const rates = series.filter((v): v is number => v !== null);
    const weeksActive = rates.length;
    const done = mine.filter((f) => f.done).length;
    const completion = pct(done, mine.length);
    const recent = recencyWeighted(rates);
    const tr = slope(rates);
    const coverage = elapsed.length ? weeksActive / elapsed.length : 0;
    let projected: number | null = null;
    if (recent !== null) {
      const drift = tr === null ? 0 : tr * Math.min(remaining, 4) * 0.5;               // a damped continuation of the trend, never more than four weeks' worth
      projected = clamp((recent + drift) * (0.5 + 0.5 * Math.min(1, coverage / 0.75)));   // thin coverage of the weeks pulls the projection down
    }
    const confidence = weeksActive >= 5 ? "high" : weeksActive >= 3 ? "medium" : "low";
    const lastActive = [...elapsed].reverse().find((w) => mine.some((f) => f.weekId === w.id));
    const outlook: Outlook = mine.length === 0 ? "NO_DATA" : (projected ?? 0) >= ON_TRACK_AT ? "ON_TRACK" : (projected ?? 0) >= AT_RISK_AT ? "AT_RISK" : "OFF_TRACK";
    const note = outlook === "NO_DATA" ? "No weekly goal supports this yet."
      : `${done} of ${mine.length} weekly goals done over ${weeksActive} ${weeksActive === 1 ? "week" : "weeks"}${tr !== null ? `, ${tr >= 1 ? "improving" : tr <= -1 ? "declining" : "steady"}` : ""}.`;
    return { id: bg.id, code: bg.code, title: bg.title, outlook, weeklyGoals: mine.length, doneGoals: done, weeksActive, completion: completion === null ? null : round1(completion),
      recent: recent === null ? null : round1(recent), trend: tr === null ? null : round1(tr), projected: projected === null ? null : round1(projected), confidence,
      lastActiveWeek: lastActive?.number ?? null, series, note };
  });

  // ---------------------------------------------------------------- alignment
  const aligned = facts.filter((f) => f.buGoalId !== null);
  const buTitle = new Map(goalsOfUnit.map((g) => [g.id, g.title]));
  const perBu = new Map<string, number>();
  for (const f of aligned) perBu.set(f.buGoalId!, (perBu.get(f.buGoalId!) ?? 0) + 1);
  const top = [...perBu.entries()].sort((a, b) => b[1] - a[1])[0];
  const weak: Alignment["weakWording"] = [];
  for (const f of aligned) {
    const t = buTitle.get(f.buGoalId!);
    if (!t) continue;
    const bk = keys(t), wk = keys(f.title);
    const shared = [...bk].filter((k) => wk.has(k)).length;
    if (bk.size >= 3 && shared === 0 && weak.length < 5 && !weak.some((w) => w.goal === f.title)) weak.push({ goal: f.title, buGoal: t });
  }
  const krCount = new Map<string, number>();
  for (const f of facts) if (f.krCode) krCount.set(f.krCode, (krCount.get(f.krCode) ?? 0) + 1);
  const alignment: Alignment = {
    weeklyGoals: facts.length, aligned: aligned.length, unaligned: facts.length - aligned.length, alignedPct: facts.length ? round1(pct(aligned.length, facts.length) ?? 0) : null,
    orphaned: active.filter((g) => !perBu.has(g.id)).map((g) => g.title),
    concentration: top && active.length >= 3 && aligned.length >= 6 && top[1] / aligned.length > 0.6 ? { title: buTitle.get(top[0]) ?? "", pct: round1((top[1] / aligned.length) * 100) } : null,
    weakWording: weak, krCoverage: [...krCount.entries()].sort().map(([kr, goals]) => ({ kr, goals })),
  };

  // ---------------------------------------------------------------- the unit's weekly result (the weekly score is the share of goals done)
  const weekScores = weeksWithGoals.map((w) => { const g = factsByWeek.get(w.id)!; return pct(g.filter((f) => f.done).length, g.length) ?? 0; });
  const sum = weekScores.reduce((a, b) => a + b, 0);
  const recentScore = recencyWeighted(weekScores);
  const scoreSlope = slope(weekScores);
  const futureWeekly = recentScore === null ? null : clamp(recentScore + (scoreSlope ?? 0) * Math.min(remaining, 4) * 0.5);
  const missed = elapsed.length - weeksWithGoals.length;                                      // an elapsed week with no report scores zero
  let projectedQuarter: number | null = null, range: [number, number] | null = null;
  if (futureWeekly !== null && reportable.length) {
    projectedQuarter = round1(clamp((sum + futureWeekly * remaining) / reportable.length));
    const spread = Math.max(5, stdev(weekScores)) * (remaining / Math.max(1, reportable.length)) * 1.5 + (weekScores.length < 3 ? 10 : 0);
    range = [round1(clamp(projectedQuarter - spread)), round1(clamp(projectedQuarter + spread))];
  }
  const needed = remaining > 0 && reportable.length ? round1(((TARGET_QUARTER_SCORE * reportable.length) - sum) / remaining) : null;
  const avgGoalsPerWeek = weeksWithGoals.length ? facts.length / weeksWithGoals.length : null;
  const prediction: Prediction = {
    target: TARGET_QUARTER_SCORE, weeksElapsed: elapsed.length, weeksRemaining: remaining, scoreToDate: weekScores.length ? round1(sum / elapsed.length) : null,
    projectedQuarterScore: projectedQuarter, range, neededWeeklyAverage: needed === null ? null : needed <= 0 ? 0 : needed, reachable: needed === null ? null : needed <= 100,
    direction: scoreSlope === null ? null : scoreSlope >= 1.5 ? "improving" : scoreSlope <= -1.5 ? "declining" : "steady",
    expectedGoalsDone: avgGoalsPerWeek !== null && futureWeekly !== null ? Math.round(facts.filter((f) => f.done).length + avgGoalsPerWeek * remaining * (futureWeekly / 100)) : null,
  };

  // ---------------------------------------------------------------- risks
  const risks: Risk[] = [];
  const add = (r: Risk) => risks.push(r);
  if (active.length === 0) add({ id: "no-bu-goals", severity: elapsed.length >= 2 ? "high" : "medium", title: "The unit has no goals for this quarter",
    detail: "Without unit goals there is nothing to measure the weekly goals against, so no forecast can be made.", action: "Add the unit's goals under Business Unit goals." });
  for (const g of goals) {
    if (g.outlook === "OFF_TRACK") add({ id: `off-${g.id}`, severity: "high", title: `“${g.title}” is unlikely to be met`, detail: `Projected ${g.projected?.toFixed(0)}% at quarter end from ${g.weeklyGoals} weekly goals (${g.doneGoals} done).`, action: "Break it into smaller weekly goals and put the unfinished work first." });
    else if (g.outlook === "AT_RISK") add({ id: `risk-${g.id}`, severity: "medium", title: `“${g.title}” is at risk`, detail: `Projected ${g.projected?.toFixed(0)}% at quarter end, below the ${ON_TRACK_AT}% line.`, action: "Add or finish weekly goals that move it forward this week." });
    if (g.outlook === "NO_DATA" && elapsed.length >= 2) add({ id: `none-${g.id}`, severity: elapsed.length >= 4 ? "high" : "medium", title: `Nothing supports “${g.title}”`, detail: `No weekly goal has been aligned to it in ${elapsed.length} weeks.`, action: "Align a weekly goal to it, or retire it if it no longer applies." });
    else if (g.lastActiveWeek !== null && elapsed.length >= 3 && elapsed[elapsed.length - 1].number - g.lastActiveWeek >= 2) add({ id: `stale-${g.id}`, severity: "medium", title: `“${g.title}” has gone quiet`, detail: `Its last weekly goal was in week ${g.lastActiveWeek}.`, action: "Schedule a weekly goal for it." });
    if (g.trend !== null && g.trend <= -5 && g.outlook !== "OFF_TRACK") add({ id: `slide-${g.id}`, severity: "medium", title: `“${g.title}” is slipping`, detail: `Its completion is falling by about ${Math.abs(g.trend).toFixed(0)} points a week.`, action: "Find what is blocking the unfinished goals." });
  }
  if (alignment.alignedPct !== null && alignment.unaligned > 0 && active.length > 0 && (alignment.alignedPct < 80)) add({ id: "unaligned", severity: alignment.alignedPct < 50 ? "high" : "medium",
    title: `${alignment.unaligned} weekly ${alignment.unaligned === 1 ? "goal does" : "goals do"} not support a unit goal`, detail: `Only ${alignment.alignedPct.toFixed(0)}% of this quarter's weekly goals are aligned.`, action: "Align each weekly goal to a unit goal when you write it." });
  if (alignment.weakWording.length) add({ id: "weak-wording", severity: "low", title: "Some weekly goals read as unrelated to the unit goal they support", detail: `For example “${alignment.weakWording[0].goal.slice(0, 70)}” under “${alignment.weakWording[0].buGoal.slice(0, 60)}”.`, action: "Re-word the weekly goal, or align it to the goal it really serves." });
  if (alignment.concentration) add({ id: "concentration", severity: "low", title: "Most weekly effort goes to one unit goal", detail: `${alignment.concentration.pct.toFixed(0)}% of aligned weekly goals support “${alignment.concentration.title.slice(0, 60)}”.`, action: "Check the other unit goals are not being starved." });
  const tasksPct = pct(facts.reduce((n, f) => n + f.tasksDone, 0), facts.reduce((n, f) => n + f.tasksTotal, 0));
  const goalsPct = pct(facts.filter((f) => f.done).length, facts.length);
  if (tasksPct !== null && goalsPct !== null && tasksPct - goalsPct >= 25 && facts.length >= 6) add({ id: "tasks-vs-goals", severity: "medium", title: "Tasks are getting done but goals are not closing",
    detail: `${tasksPct.toFixed(0)}% of tasks are done against ${goalsPct.toFixed(0)}% of goals: the last task of many goals is being left undone.`, action: "Start each goal with its hardest task, or split goals that stall on one task." });
  if (missed > 0 && elapsed.length >= 2) add({ id: "missed-weeks", severity: missed >= 2 ? "high" : "medium", title: `${missed} ${missed === 1 ? "week" : "weeks"} without weekly goals`, detail: "A week with no report scores zero and drags the quarter score down.", action: "File the missing weeks, or ask an Admin to suspend the locks so they can be filled in." });
  const undecided = facts.filter((f) => new Date(f.weekStart).getTime() + 7 * 864e5 < now).reduce((n, f) => n + f.tasksUndefined, 0);
  if (undecided > 0) add({ id: "undecided", severity: "low", title: `${undecided} task${undecided === 1 ? "" : "s"} from past weeks still not marked`, detail: "They become Not done at the final lock.", action: "Mark them Done or Not done while the week is open." });
  const smartScores = facts.map((f) => f.smart).filter((v): v is number => v !== null);
  const smartAvg = mean(smartScores);
  if (smartAvg !== null && smartScores.length >= 6 && smartAvg < 60) add({ id: "smart", severity: "low", title: "Weekly goals are loosely written", detail: `Their average SMART rating is ${smartAvg.toFixed(0)} out of 100.`, action: "Add a number and a deadline to each goal." });
  if (prediction.projectedQuarterScore !== null && prediction.projectedQuarterScore < TARGET_QUARTER_SCORE && remaining > 0) add({ id: "quarter-score", severity: prediction.reachable === false ? "high" : prediction.projectedQuarterScore < 50 ? "high" : "medium",
    title: `The quarter score is heading for ${prediction.projectedQuarterScore.toFixed(0)}%`, detail: prediction.reachable === false ? `Even a perfect remaining ${remaining} weeks would not reach ${TARGET_QUARTER_SCORE}%.` : `To reach ${TARGET_QUARTER_SCORE}% the unit now needs about ${(prediction.neededWeeklyAverage ?? 0).toFixed(0)}% each remaining week.`, action: "Aim for fewer, finishable goals each week." });
  const order = { high: 0, medium: 1, low: 2 } as const;
  risks.sort((a, b) => order[a.severity] - order[b.severity]);

  // ---------------------------------------------------------------- the unit's overall outlook
  const scored = goals.filter((g) => g.projected !== null);
  const weight = scored.reduce((n, g) => n + g.weeklyGoals, 0);
  const blended = weight ? scored.reduce((n, g) => n + (g.projected as number) * g.weeklyGoals, 0) / weight : null;
  const outlook: Outlook = active.length === 0 || facts.length === 0 || blended === null ? "NO_DATA" : blended >= ON_TRACK_AT && !goals.some((g) => g.outlook === "OFF_TRACK") ? "ON_TRACK" : blended >= AT_RISK_AT ? "AT_RISK" : "OFF_TRACK";
  const headline = outlook === "NO_DATA" ? (active.length === 0 ? "Set the unit's goals to get a forecast." : "Not enough weekly goals yet to forecast.")
    : outlook === "ON_TRACK" ? `On track: the unit's goals are projected at ${blended!.toFixed(0)}% by quarter end.`
    : outlook === "AT_RISK" ? `At risk: the unit's goals are projected at ${blended!.toFixed(0)}% by quarter end.`
    : `Off track: the unit's goals are projected at only ${blended!.toFixed(0)}% by quarter end.`;
  return { businessUnitId: unit.id, unitName: unit.name, outlook, headline, progressPct, goals, alignment, risks, prediction, evidenceWeeks: weeksWithGoals.length };
}

// ---------------------------------------------------------------- the organisation
export interface OrgIntelligence {
  units: BuIntelligence[]; counts: Record<Outlook, number>; alignedPct: number | null; withoutGoals: string[];
  topRisks: (Risk & { unitName: string; businessUnitId: string })[]; averageProjectedQuarter: number | null; atRiskUnits: string[];
}
export function buildOrgIntelligence(input: { units: { id: string; name: string }[]; frame: QuarterFrame; now: string; buGoals: BuGoalInput[]; facts: GoalFact[] }): OrgIntelligence {
  const units = input.units.map((u) => buildBuIntelligence({ unit: u, frame: input.frame, now: input.now, buGoals: input.buGoals, facts: input.facts }));
  const counts: Record<Outlook, number> = { ON_TRACK: 0, AT_RISK: 0, OFF_TRACK: 0, NO_DATA: 0 };
  for (const u of units) counts[u.outlook] += 1;
  const w = units.reduce((n, u) => n + u.alignment.weeklyGoals, 0), a = units.reduce((n, u) => n + u.alignment.aligned, 0);
  const sev = { high: 0, medium: 1, low: 2 } as const;
  const topRisks = units.flatMap((u) => u.risks.map((r) => ({ ...r, unitName: u.unitName, businessUnitId: u.businessUnitId }))).sort((x, y) => sev[x.severity] - sev[y.severity]).slice(0, 8);
  const proj = units.map((u) => u.prediction.projectedQuarterScore).filter((v): v is number => v !== null);
  const worst = units.filter((u) => u.outlook === "OFF_TRACK" || u.outlook === "AT_RISK").sort((x, y) => (x.prediction.projectedQuarterScore ?? 0) - (y.prediction.projectedQuarterScore ?? 0)).map((u) => u.unitName);
  return { units, counts, alignedPct: w ? round1((a / w) * 100) : null, withoutGoals: units.filter((u) => u.goals.length === 0).map((u) => u.unitName), topRisks,
    averageProjectedQuarter: proj.length ? round1(mean(proj) as number) : null, atRiskUnits: worst };
}

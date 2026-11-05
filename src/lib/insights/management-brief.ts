// What management needs to decide, beyond whether one unit's goals will be met: who needs help and why, whether the scores can be trusted,
// whether units are over-committed, whether the strategy is covered, how a unit compares with its peers, what would change the outcome,
// and what is waiting for a decision. Every figure is a fixed rule over data the application already holds, and says how it was reached.

import {
  buildBuIntelligence, buildOrgIntelligence, clamp, keys, mean, pct, recencyWeighted, round1, slope, stdev, TARGET_QUARTER_SCORE,
  type BuGoalInput, type BuIntelligence, type GoalFact, type OrgIntelligence, type QuarterFrame, type Severity,
} from "./bu-intelligence";

export interface BriefUnitFacts {
  businessUnitId: string; decidedTasks: number; lateDecidedTasks: number; corrections: number; submissions: number; lateSubmissions: number;
  attendancePresent: number; attendanceTotal: number; openViolations: number; openFines: number;
}
export interface Queue { waiting: number; oldestDays: number }
export interface BriefQueues { attendanceAmendments: Queue; disbursements: Queue; configChanges: Queue; lateReportExceptions: Queue }
export interface SubKrInfo { krCode: string; code: string; title: string }
export interface ActionInput { id: string; businessUnitId: string; note: string; scoreBefore: number | null; createdAt: string; createdBy: string }

export type CauseCode = "NO_GOALS" | "NOT_FILING" | "OVERCOMMITTED" | "GOALS_NOT_CLOSING" | "MISALIGNED" | "DECLINING" | "LOOSE_GOALS" | "OTHER";
export interface Cause { code: CauseCode; label: string; detail: string }
export interface SettledWeek { number: number; start: string; score: number | null; goals: number; tasksPlanned: number; tasksDone: number }
export interface Capacity { plannedPerWeek: number | null; donePerWeek: number | null; ratio: number | null; overcommitted: boolean; heaviest: { week: number; tasks: number } | null; carryOver: { title: string; weeks: number }[] }
export interface Difficulty { avgSmart: number | null; tasksPerGoal: number | null; measurablePct: number | null; deadlinePct: number | null; level: "light" | "normal" | "demanding" | null; sandbagging: boolean }
export interface Integrity { lateDecidedPct: number | null; corrections: number; latePct: number | null; flags: string[]; level: "ok" | "watch" | "review" }
export interface WhatIf { base: number | null; finishLatest: { projected: number; delta: number } | null; lift10: { projected: number; delta: number } | null }
export interface UnitAnalysis {
  businessUnitId: string; unitName: string; intel: BuIntelligence; weeks: SettledWeek[]; capacity: Capacity; difficulty: Difficulty; integrity: Integrity;
  cause: Cause | null; whatIf: WhatIf; change: { last: number | null; previous: number | null; delta: number | null };
  governance: { attendanceRate: number | null; openViolations: number; openFines: number }; goalKrSpread: { title: string; krs: string[] }[];
  peer: { group: "small" | "medium" | "large" | null; percentile: number | null; rank: number | null; groupSize: number };
}
export interface CoverageRow { krCode: string; code: string; title: string; goals: number; units: number; doneRate: number | null; sharePct: number; status: "uncovered" | "concentrated" | "covered" }
export interface BriefItem { kind: "attention" | "integrity" | "capacity" | "coverage" | "carry-over" | "decision" | "win" | "summary"; severity: Severity | "good"; text: string; businessUnitId?: string }
export interface ActionResult extends ActionInput { unitName: string; scoreAfter: number | null; weeksAfter: number; change: number | null }
export interface ManagementBrief {
  units: UnitAnalysis[]; org: OrgIntelligence; coverage: CoverageRow[]; items: BriefItem[]; queues: BriefQueues | null;
  recognition: { mostImproved: { unitName: string; delta: number }[]; mostConsistent: { unitName: string; spread: number; average: number }[] };
  actions: ActionResult[]; latestWeek: number | null;
}

const NUMBER = /\d/;
const DEADLINE = /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b|\bby\b|\bbefore\b|\buntil\b|\bend of\b|\b\d{1,2}[/:.]\d{1,2}\b|\b\d{1,2}(st|nd|rd|th)\b/i;
const DAY = 864e5;

export function analyseUnit(input: { unit: { id: string; name: string }; frame: QuarterFrame; now: string; buGoals: BuGoalInput[]; facts: GoalFact[]; brief?: BriefUnitFacts }): UnitAnalysis {
  const { unit, frame } = input;
  const now = new Date(input.now).getTime();
  const intel = buildBuIntelligence({ unit, frame, now: input.now, buGoals: input.buGoals, facts: input.facts });
  const facts = input.facts.filter((f) => f.businessUnitId === unit.id);
  const reportable = frame.weeks.filter((w) => !w.holiday);
  const inProgress = (w: { id: string; start: string }) => new Date(w.start).getTime() + 7 * DAY > now && (!facts.some((f) => f.weekId === w.id) || facts.some((f) => f.weekId === w.id && f.tasksUndefined > 0));   // a running week with no report is not missed until it is over
  const elapsed = reportable.filter((w) => new Date(w.start).getTime() <= now && !inProgress(w));
  const weeks: SettledWeek[] = elapsed.map((w) => {
    const g = facts.filter((f) => f.weekId === w.id);
    return { number: w.number, start: w.start, score: g.length ? round1(pct(g.filter((f) => f.done).length, g.length) ?? 0) : null, goals: g.length, tasksPlanned: g.reduce((n, f) => n + f.tasksTotal, 0), tasksDone: g.reduce((n, f) => n + f.tasksDone, 0) };
  });
  const filed = weeks.filter((w) => w.goals > 0);
  const scores = filed.map((w) => w.score as number);
  const remaining = Math.max(0, reportable.length - elapsed.length);

  // ------------------------------------------------ capacity and carry-over
  const planned = mean(filed.map((w) => w.tasksPlanned)), doneT = mean(filed.map((w) => w.tasksDone));
  const ratio = planned && doneT !== null ? round1((doneT / planned) * 100) : null;
  const heaviest = filed.length ? filed.reduce((m, w) => (w.tasksPlanned > m.tasksPlanned ? w : m)) : null;
  const notDone = facts.filter((f) => !f.done && elapsed.some((w) => w.id === f.weekId)).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const clusters: { key: Set<string>; title: string; weeks: Set<number> }[] = [];
  for (const f of notDone) {
    const k = keys(f.title);
    if (k.size < 3) continue;
    const hit = clusters.find((c) => { const shared = [...k].filter((x) => c.key.has(x)).length; return shared / Math.min(k.size, c.key.size) >= 0.6; });
    if (hit) hit.weeks.add(f.weekNumber); else clusters.push({ key: k, title: f.title, weeks: new Set([f.weekNumber]) });
  }
  const capacity: Capacity = {
    plannedPerWeek: planned === null ? null : round1(planned), donePerWeek: doneT === null ? null : round1(doneT), ratio,
    overcommitted: ratio !== null && planned !== null && ratio < 55 && planned >= 8 && filed.length >= 2,
    heaviest: heaviest ? { week: heaviest.number, tasks: heaviest.tasksPlanned } : null,
    carryOver: clusters.filter((c) => c.weeks.size >= 2).map((c) => ({ title: c.title, weeks: c.weeks.size })).sort((a, b) => b.weeks - a.weeks).slice(0, 5),
  };

  // ------------------------------------------------ how demanding the goals are, and whether a high score can be trusted
  const smart = facts.map((f) => f.smart).filter((v): v is number => v !== null);
  const avgSmart = mean(smart);
  const tasksPerGoal = facts.length ? round1(facts.reduce((n, f) => n + f.tasksTotal, 0) / facts.length) : null;
  const measurablePct = facts.length ? round1((facts.filter((f) => NUMBER.test(f.title)).length / facts.length) * 100) : null;
  const deadlinePct = facts.length ? round1((facts.filter((f) => DEADLINE.test(f.title)).length / facts.length) * 100) : null;
  const level: Difficulty["level"] = facts.length < 3 ? null : tasksPerGoal! >= 3.5 && measurablePct! >= 60 ? "demanding" : tasksPerGoal! <= 2 || measurablePct! < 30 ? "light" : "normal";
  const recentScores = scores.slice(-3);
  const difficulty: Difficulty = { avgSmart: avgSmart === null ? null : round1(avgSmart), tasksPerGoal, measurablePct, deadlinePct, level,
    sandbagging: level === "light" && recentScores.length >= 3 && (mean(recentScores) ?? 0) >= 90 };

  // ------------------------------------------------ integrity of the score
  const b = input.brief;
  const lateDecidedPct = b && b.decidedTasks >= 10 ? round1(pct(b.lateDecidedTasks, b.decidedTasks) ?? 0) : null;
  const latePct = b && b.submissions >= 3 ? round1(pct(b.lateSubmissions, b.submissions) ?? 0) : null;
  const flags: string[] = [];
  if (lateDecidedPct !== null && lateDecidedPct >= 40) flags.push(`${lateDecidedPct.toFixed(0)}% of tasks were marked in the last two hours before the final lock`);
  if (b && b.corrections >= 2) flags.push(`${b.corrections} tasks were corrected after the lock`);
  if (latePct !== null && latePct >= 50) flags.push(`${latePct.toFixed(0)}% of reports were submitted after the content lock`);
  if (difficulty.sandbagging) flags.push("a near-perfect score from light, loosely measured goals");
  const integrity: Integrity = { lateDecidedPct, corrections: b?.corrections ?? 0, latePct, flags, level: (b?.corrections ?? 0) >= 3 || flags.length >= 2 ? "review" : flags.length ? "watch" : "ok" };

  // ------------------------------------------------ what changed, and what would change it
  const last = filed.length ? filed[filed.length - 1].score : null, prev = filed.length > 1 ? filed[filed.length - 2].score : null;
  const change = { last, previous: prev, delta: last !== null && prev !== null ? round1(last - prev) : null };
  // What-ifs are direct arithmetic on the quarter score, so they can be checked by hand: they do not re-weight the trend.
  const base = intel.prediction.projectedQuarterScore;
  const total = reportable.length;
  const direct = (points: number) => (base === null || total === 0 ? null : { projected: round1(Math.min(100, base + points)), delta: round1(Math.min(100 - base, points)) });
  const lastScore = filed.length ? (filed[filed.length - 1].score as number) : null;
  const whatIf: WhatIf = { base, finishLatest: lastScore !== null && lastScore < 100 ? direct((100 - lastScore) / total) : lastScore !== null ? direct(0) : null, lift10: remaining > 0 ? direct((10 * remaining) / total) : null };

  // ------------------------------------------------ the main reason, in plain words
  const risk = (id: string) => intel.risks.some((r) => r.id === id || r.id.startsWith(`${id}-`));
  let cause: Cause | null = null;
  if (intel.outlook !== "ON_TRACK") {
    cause = input.buGoals.filter((g) => g.businessUnitId === unit.id && g.status === "ACTIVE").length === 0 ? { code: "NO_GOALS", label: "No unit goals set", detail: "There is nothing to measure the weekly goals against." }
      : risk("missed-weeks") ? { code: "NOT_FILING", label: "Weeks without a report", detail: "Missed weeks score zero and pull the quarter down." }
      : capacity.overcommitted ? { code: "OVERCOMMITTED", label: "Taking on more than it finishes", detail: `About ${capacity.plannedPerWeek?.toFixed(0)} tasks planned a week, ${capacity.donePerWeek?.toFixed(0)} finished.` }
      : risk("tasks-vs-goals") ? { code: "GOALS_NOT_CLOSING", label: "Tasks done, goals not closing", detail: "The last task of many goals is left undone." }
      : risk("unaligned") ? { code: "MISALIGNED", label: "Weekly goals not tied to unit goals", detail: `${intel.alignment.alignedPct?.toFixed(0)}% of weekly goals are aligned.` }
      : (intel.prediction.direction === "declining" || risk("slide")) && (change.delta ?? 0) <= 0 ? { code: "DECLINING", label: "Results falling", detail: "Completion has been lower in recent weeks than before." }
      : risk("smart") ? { code: "LOOSE_GOALS", label: "Loosely written goals", detail: "Goals lack numbers or deadlines, so they are hard to finish or judge." }
      : { code: "OTHER", label: "Low completion without one clear cause", detail: "Fewer goals are being finished than needed." };
  }

  const krs = new Map<string, Set<string>>();
  for (const f of facts) if (f.buGoalId && f.krCode) krs.set(f.buGoalId, (krs.get(f.buGoalId) ?? new Set()).add(f.krCode));
  const goalKrSpread = intel.goals.map((g) => ({ title: g.title, krs: [...(krs.get(g.id) ?? [])].sort() }));

  return {
    businessUnitId: unit.id, unitName: unit.name, intel, weeks, capacity, difficulty, integrity, cause, whatIf, change,
    governance: { attendanceRate: b && b.attendanceTotal > 0 ? round1(pct(b.attendancePresent, b.attendanceTotal) ?? 0) : null, openViolations: b?.openViolations ?? 0, openFines: b?.openFines ?? 0 },
    goalKrSpread, peer: { group: null, percentile: null, rank: null, groupSize: 0 },
  };
}

export function buildManagementBrief(input: {
  units: { id: string; name: string }[]; frame: QuarterFrame; now: string; buGoals: BuGoalInput[]; facts: GoalFact[]; subKrs: SubKrInfo[];
  brief: BriefUnitFacts[]; queues: BriefQueues | null; actions: ActionInput[];
}): ManagementBrief {
  const org = buildOrgIntelligence({ units: input.units, frame: input.frame, now: input.now, buGoals: input.buGoals, facts: input.facts });
  const byBrief = new Map(input.brief.map((b) => [b.businessUnitId, b]));
  const units = input.units.map((u) => analyseUnit({ unit: u, frame: input.frame, now: input.now, buGoals: input.buGoals, facts: input.facts, brief: byBrief.get(u.id) }));

  // peers: units of a similar volume of planned work are compared with each other
  const sized = units.filter((u) => u.capacity.plannedPerWeek !== null).sort((a, b) => (a.capacity.plannedPerWeek as number) - (b.capacity.plannedPerWeek as number));
  const groupOf = (i: number): "small" | "medium" | "large" => (i < sized.length / 3 ? "small" : i < (2 * sized.length) / 3 ? "medium" : "large");
  const groups = new Map<string, UnitAnalysis[]>();
  sized.forEach((u, i) => { const g = groupOf(i); groups.set(g, [...(groups.get(g) ?? []), u]); });
  for (const [g, members] of groups) {
    const ranked = members.filter((m) => m.intel.prediction.projectedQuarterScore !== null).sort((a, b) => (b.intel.prediction.projectedQuarterScore as number) - (a.intel.prediction.projectedQuarterScore as number));
    ranked.forEach((m, i) => { m.peer = { group: g as "small", rank: i + 1, groupSize: ranked.length, percentile: ranked.length > 1 ? round1(((ranked.length - 1 - i) / (ranked.length - 1)) * 100) : 100 }; });
  }

  // strategy coverage: which Sub-KRs the weekly work actually touches
  const totalGoals = input.facts.length;
  const coverage: CoverageRow[] = input.subKrs.map((s) => {
    const g = input.facts.filter((f) => f.subKrCode === s.code);
    const share = totalGoals ? (g.length / totalGoals) * 100 : 0;
    return { krCode: s.krCode, code: s.code, title: s.title, goals: g.length, units: new Set(g.map((f) => f.businessUnitId)).size,
      doneRate: g.length ? round1(pct(g.filter((f) => f.done).length, g.length) ?? 0) : null, sharePct: round1(share),
      status: g.length === 0 ? "uncovered" : share > 35 && input.subKrs.length >= 4 ? "concentrated" : "covered" };
  });

  // recognition
  const withWeeks = units.filter((u) => u.weeks.filter((w) => w.score !== null).length >= 3);
  const mostImproved = withWeeks.filter((u) => (u.change.delta ?? 0) >= 10).sort((a, b) => (b.change.delta as number) - (a.change.delta as number)).slice(0, 3).map((u) => ({ unitName: u.unitName, delta: u.change.delta as number }));
  const mostConsistent = withWeeks.map((u) => { const s = u.weeks.map((w) => w.score).filter((v): v is number => v !== null); return { unitName: u.unitName, spread: round1(stdev(s)), average: round1(mean(s) ?? 0) }; })
    .filter((u) => u.average >= 60).sort((a, b) => a.spread - b.spread).slice(0, 3);

  // actions taken: how the unit's settled weeks after the action compare with its score when it was logged
  const actions: ActionResult[] = input.actions.map((a) => {
    const u = units.find((x) => x.businessUnitId === a.businessUnitId);
    const after = (u?.weeks ?? []).filter((w) => w.score !== null && new Date(w.start).getTime() >= new Date(a.createdAt).getTime()).map((w) => w.score as number);
    const scoreAfter = mean(after);
    return { ...a, unitName: u?.unitName ?? "Unit", scoreAfter: scoreAfter === null ? null : round1(scoreAfter), weeksAfter: after.length, change: scoreAfter !== null && a.scoreBefore !== null ? round1(scoreAfter - a.scoreBefore) : null };
  });

  // ---------------------------------------------------------------- the brief
  const items: BriefItem[] = [];
  const c = org.counts;
  items.push({ kind: "summary", severity: c.OFF_TRACK > 0 ? "high" : c.AT_RISK > 0 ? "medium" : "good",
    text: `${c.ON_TRACK} of ${units.length} units are on track, ${c.AT_RISK} at risk and ${c.OFF_TRACK} off track${c.NO_DATA ? `; ${c.NO_DATA} cannot be forecast yet` : ""}. The projected average quarter score is ${org.averageProjectedQuarter === null ? "not yet known" : `${org.averageProjectedQuarter.toFixed(0)}%`} against a target of ${TARGET_QUARTER_SCORE}%.` });
  for (const u of units.filter((x) => x.cause).sort((a, b) => (a.intel.prediction.projectedQuarterScore ?? 0) - (b.intel.prediction.projectedQuarterScore ?? 0)).slice(0, 5)) {
    const d = u.change.delta;
    items.push({ kind: "attention", severity: u.intel.outlook === "OFF_TRACK" ? "high" : "medium", businessUnitId: u.businessUnitId,
      text: `${u.unitName}: ${u.cause!.label}. Projected ${u.intel.prediction.projectedQuarterScore?.toFixed(0) ?? "—"}% for the quarter${d === null ? "" : d === 0 ? ", unchanged on last week" : `, ${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(0)} points on last week`}.` });
  }
  for (const u of units.filter((x) => x.integrity.level !== "ok")) items.push({ kind: "integrity", severity: u.integrity.level === "review" ? "high" : "medium", businessUnitId: u.businessUnitId, text: `${u.unitName}: check the score. ${u.integrity.flags.join("; ")}.` });
  for (const u of units.filter((x) => x.capacity.overcommitted)) items.push({ kind: "capacity", severity: "medium", businessUnitId: u.businessUnitId, text: `${u.unitName} plans about ${u.capacity.plannedPerWeek?.toFixed(0)} tasks a week and finishes ${u.capacity.donePerWeek?.toFixed(0)}: it is taking on more than it can do.` });
  for (const u of units) for (const co of u.capacity.carryOver.slice(0, 1)) items.push({ kind: "carry-over", severity: "medium", businessUnitId: u.businessUnitId, text: `${u.unitName} has set a goal like “${co.title.slice(0, 70)}” in ${co.weeks} weeks without finishing it.` });
  const gaps = coverage.filter((r) => r.status === "uncovered"), heavy = coverage.filter((r) => r.status === "concentrated");
  if (gaps.length && org.units.some((u) => u.evidenceWeeks >= 2)) items.push({ kind: "coverage", severity: "medium", text: `No weekly goal supports ${gaps.length === 1 ? "this Sub-KR" : `these ${gaps.length} Sub-KRs`}: ${gaps.slice(0, 4).map((g) => g.code).join(", ")}${gaps.length > 4 ? "…" : ""}.` });
  for (const h of heavy) items.push({ kind: "coverage", severity: "low", text: `${h.code} takes ${h.sharePct.toFixed(0)}% of all weekly goals: effort is concentrated there.` });
  const q = input.queues;
  if (q) {
    for (const [label, x] of [["attendance amendments", q.attendanceAmendments], ["fund requests", q.disbursements], ["configuration changes", q.configChanges], ["late-report exceptions", q.lateReportExceptions]] as const)
      if (x.waiting > 0) items.push({ kind: "decision", severity: x.oldestDays >= 7 ? "high" : "medium", text: `${x.waiting} ${label} waiting for a decision; the oldest has waited ${x.oldestDays} day${x.oldestDays === 1 ? "" : "s"}.` });
  }
  for (const m of mostImproved) items.push({ kind: "win", severity: "good", text: `${m.unitName} improved by ${m.delta.toFixed(0)} points last week.` });
  for (const m of mostConsistent.slice(0, 1)) items.push({ kind: "win", severity: "good", text: `${m.unitName} is the steadiest unit: it averages ${m.average.toFixed(0)}% with little swing.` });

  const latest = units.flatMap((u) => u.weeks.map((w) => w.number)).sort((a, b) => b - a)[0] ?? null;
  return { units, org, coverage, items, queues: q, recognition: { mostImproved, mostConsistent }, actions, latestWeek: latest };
}

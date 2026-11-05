import { describe, expect, it } from "vitest";
import type { BuGoalInput, GoalFact, QuarterFrame } from "../bu-intelligence";
import { buildExecutiveReport } from "../executive-report";
import { buildManagementBrief } from "../management-brief";

const day = 864e5;
const start = new Date("2026-10-05T00:00:00Z").getTime();
const frame: QuarterFrame = { startsOn: "2026-10-05", endsOn: "2027-01-03", weeks: Array.from({ length: 13 }, (_, i) => ({ id: `w${i + 1}`, number: 41 + i, start: new Date(start + i * 7 * day).toISOString(), holiday: false })) };
const now = new Date(start + 6 * 7 * day + 2 * day).toISOString();          // six weeks have settled
let n = 0;
const fact = (unit: string, week: number, done: boolean, o: Partial<GoalFact> = {}): GoalFact => ({
  goalId: `g${String(++n).padStart(8, "0")}`, businessUnitId: unit, weekId: `w${week}`, weekNumber: 40 + week, weekStart: new Date(start + (week - 1) * 7 * day).toISOString(), submitted: true,
  buGoalId: `bg-${unit}`, subKrCode: "KR1.1", krCode: "KR1", title: "Close 4 partner follow-ups by Friday", done, tasksTotal: 3, tasksDone: done ? 3 : 1, tasksUndefined: 0, smart: 75, ...o,
});
const weeks = (unit: string, scores: (number | null)[], per = 4, o: Partial<GoalFact> = {}) =>
  scores.flatMap((s, i) => (s === null ? [] : Array.from({ length: per }, (_, k) => fact(unit, i + 1, k < Math.round((s / 100) * per), o))));
const goals = (ids: string[]): BuGoalInput[] => ids.map((u) => ({ id: `bg-${u}`, businessUnitId: u, title: "Grow partner revenue", status: "ACTIVE" }));
const U = (id: string) => ({ id, name: id.toUpperCase() });

function report(facts: GoalFact[], ids: string[]) {
  const brief = buildManagementBrief({ units: ids.map(U), frame, now, buGoals: goals(ids), facts, subKrs: [{ krCode: "KR1", code: "KR1.1", title: "Close partner follow-ups" }, { krCode: "KR2", code: "KR2.1", title: "Nothing supports this" }], brief: [], queues: null, actions: [] });
  return buildExecutiveReport({ brief, facts, frame, quarterLabel: "Q4 2026", now });
}

describe("executive report", () => {
  const strong = weeks("strong", [100, 100, 75, 100, 100, 100]);
  const weak = weeks("weak", [25, 25, 25, 0, 25, 0]);
  const slide = weeks("slide", [100, 100, 100, 50, 25, 0]);
  const missing = weeks("missing", [75, null, null, 75, null, 75]);
  const stuck = [1, 2, 3, 4].map((w) => fact("weak", w, false, { title: "Establish clear accountability and ownership across the team", tasksDone: 0 }));
  const x = report([...strong, ...weak, ...slide, ...missing, ...stuck], ["strong", "weak", "slide", "missing"]);

  it("classifies units and says where the average is hiding weakness", () => {
    expect(x.units.find((u) => u.id === "strong")?.forecast).toMatch(/exceed|achieve/);
    expect(x.units.find((u) => u.id === "weak")?.forecast).toBe("unlikely");
    expect(x.units.find((u) => u.id === "slide")?.direction).toBe("deteriorating");
    expect(x.org.counts.ON_TRACK + x.org.counts.AT_RISK + x.org.counts.OFF_TRACK + x.org.counts.NO_DATA).toBe(4);
    expect(x.org.belowTarget).toBeGreaterThanOrEqual(2);
  });
  it("tells actual, reported and forecast apart, and counts a missed week as zero in the actual only", () => {
    const m = x.units.find((u) => u.id === "missing")!;
    expect(m.missed).toBeGreaterThanOrEqual(3);
    expect(m.scoreToDate).toBeLessThan(m.series.reduce((a, b) => a + b, 0) / m.series.length);
    expect(x.org.actualToDate).not.toBe(x.org.reported);
    expect(x.quality.checks.find((c) => c.check.startsWith("Weeks scored"))?.result).toBe("Differs");
  });
  it("finds a goal set again and again, classifies it, and traces it to its records", () => {
    const r = x.repeated.find((g) => g.unit === "WEAK" && g.title.includes("accountability"));
    expect(r?.weeksUnfinished).toBe(4);
    expect(["Stagnant goal", "Potentially abandoned"]).toContain(r?.classification);
    expect(r?.refs.length).toBeGreaterThan(0);
  });
  it("labels root causes: confirmed only when the data shows the cause itself", () => {
    const missed = x.patterns.find((p) => p.id === "P10")!;
    expect(missed.rootCause.status).toBe("Confirmed from the data");
    expect(x.patterns.find((p) => p.id === "P6")?.rootCause.status).toBe("Plausible, needs validation");
  });
  it("scores every risk on a 5 by 5 scale with bands, and ranks the top five by residual score", () => {
    expect(x.risks.length).toBeGreaterThan(0);
    for (const r of x.risks) {
      expect(r.likelihood).toBeGreaterThanOrEqual(1); expect(r.likelihood).toBeLessThanOrEqual(5);
      expect(r.impact).toBeGreaterThanOrEqual(1); expect(r.impact).toBeLessThanOrEqual(5);
      expect(r.inherent).toBe(r.likelihood * r.impact);
      expect(r.residual).toBe(r.residualLikelihood * r.impact);
      expect(r.band).toBe(r.residual >= 20 ? "Critical" : r.residual >= 15 ? "Very High" : r.residual >= 10 ? "High" : r.residual >= 5 ? "Moderate" : "Low");
      expect(r.owner).toMatch(/Not recorded|Executive sponsor/);
    }
    expect(x.topRisks.length).toBeLessThanOrEqual(5);
    const scores = x.topRisks.map((r) => r.residual);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  it("raises early warnings past their lines and proposes thresholds", () => {
    const decline = x.indicators.find((i) => i.id === "E3")!;
    expect(decline.affected.some((a) => a.unit === "SLIDE")).toBe(true);
    expect(x.indicators.every((i) => i.warning && i.escalation && i.response)).toBe(true);
  });
  it("never invents an owner or a deadline and gives every action the full set of fields", () => {
    expect(x.actions.length).toBeGreaterThan(0);
    for (const a of x.actions) for (const k of ["finding", "evidence", "action", "outcome", "owner", "deadline", "measure", "escalation"] as const) expect(a[k].length).toBeGreaterThan(0);
    expect(x.actions.some((a) => a.tier === "Immediate")).toBe(true);
  });
  it("separates a one-week jump from sustained improvement", () => {
    const up = weeks("up", [25, 25, 25, 50, 75, 100]), jump = weeks("jump", [50, 50, 50, 50, 50, 100]);
    const y = report([...up, ...jump], ["up", "jump"]);
    expect(y.positives.find((p) => p.unit === "UP")?.kind).toMatch(/Sustained|Recovering/);
    expect(y.positives.find((p) => p.unit === "JUMP")?.kind).toBe("One-week movement");
  });
  it("is deterministic and states its limits", () => {
    expect(report([...strong, ...weak], ["strong", "weak"])).toEqual(report([...strong, ...weak], ["strong", "weak"]));
    expect(x.quality.limitations.join(" ")).toMatch(/Goal owner/);
    expect(x.summary.findings.every((f) => f.basis && f.text)).toBe(true);
  });
  it("copes with no data at all", () => {
    const e = report([], ["a", "b"]);
    expect(e.org.projectedUnweighted).toBeNull();
    expect(e.summary.findings.length).toBeGreaterThan(0);
  });
});

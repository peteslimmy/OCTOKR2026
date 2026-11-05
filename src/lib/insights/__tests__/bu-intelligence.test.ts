import { describe, expect, it } from "vitest";
import { buildBuIntelligence, buildOrgIntelligence, type BuGoalInput, type GoalFact, type QuarterFrame } from "../bu-intelligence";

const UNIT = { id: "u1", name: "Finance" };
const day = 864e5;
const start = new Date("2026-10-05T00:00:00Z").getTime();
// 13 weeks; week 4 is a holiday
const frame: QuarterFrame = { startsOn: "2026-10-05", endsOn: "2027-01-03", weeks: Array.from({ length: 13 }, (_, i) => ({ id: `w${i + 1}`, number: 41 + i, start: new Date(start + i * 7 * day).toISOString(), holiday: i === 3 })) };
const nowAt = (weekIndex: number) => new Date(start + weekIndex * 7 * day + 2 * day).toISOString();   // a Wednesday inside that week (0-based)
const bg = (id: string, title: string, status: "ACTIVE" | "RETIRED" = "ACTIVE"): BuGoalInput => ({ id, businessUnitId: "u1", title, status });
let n = 0;
const fact = (week: number, buGoalId: string | null, done: boolean, o: Partial<GoalFact> = {}): GoalFact => ({
  goalId: `g${++n}`, businessUnitId: "u1", weekId: `w${week}`, weekNumber: 40 + week, weekStart: new Date(start + (week - 1) * 7 * day).toISOString(), submitted: true,
  buGoalId, subKrCode: "KR1.1", krCode: "KR1", title: "Close invoices with partners", done, tasksTotal: 3, tasksDone: done ? 3 : 1, tasksUndefined: 0, smart: 75, ...o,
});
const weeks = (from: number, to: number, buGoalId: string, doneOf: (w: number, i: number) => boolean, perWeek = 3) =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k).flatMap((w) => Array.from({ length: perWeek }, (_, i) => fact(w, buGoalId, doneOf(w, i))));

describe("BU intelligence: the forecast", () => {
  it("calls a steadily completing goal on track and a mostly failing one off track", () => {
    const facts = [...weeks(1, 6, "a", () => true), ...weeks(1, 6, "b", (_w, i) => i === 0)];
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(5), buGoals: [bg("a", "Grow partner revenue"), bg("b", "Close every milestone")], facts });
    const a = out.goals.find((g) => g.id === "a")!, b = out.goals.find((g) => g.id === "b")!;
    expect(a.outlook).toBe("ON_TRACK");
    expect(a.projected).toBeGreaterThanOrEqual(90);
    expect(b.outlook).toBe("OFF_TRACK");
    expect(b.projected!).toBeLessThan(50);
    expect(b.completion).toBeCloseTo(33.3, 1);
    expect(out.risks.some((r) => r.id === "off-b" && r.severity === "high")).toBe(true);
    expect(out.outlook).not.toBe("ON_TRACK");   // one failing goal stops the unit being called on track
  });

  it("projects forward from a rising trend and warns about a falling one", () => {
    const rising = weeks(1, 6, "a", (w, i) => i < Math.min(3, w - 1));      // 0, 1/3, 2/3, then all done
    const falling = weeks(1, 6, "a", (w, i) => i < Math.max(0, 4 - w));
    const up = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(5), buGoals: [bg("a", "Goal")], facts: rising });
    const down = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(5), buGoals: [bg("a", "Goal")], facts: falling });
    expect(up.goals[0].trend!).toBeGreaterThan(0);
    expect(down.goals[0].trend!).toBeLessThan(0);
    expect(up.goals[0].projected!).toBeGreaterThan(down.goals[0].projected!);
    expect(up.prediction.direction).toBe("improving");
    expect(down.prediction.direction).toBe("declining");
  });

  it("lowers confidence and the projection when there are few weeks, or gaps", () => {
    const few = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(1), buGoals: [bg("a", "Goal")], facts: weeks(1, 2, "a", () => true) });
    const many = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(6), buGoals: [bg("a", "Goal")], facts: weeks(1, 7, "a", () => true) });
    expect(few.goals[0].confidence).toBe("low");
    expect(many.goals[0].confidence).toBe("high");
    const gappy = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(6), buGoals: [bg("a", "Goal")], facts: [...weeks(1, 1, "a", () => true), ...weeks(7, 7, "a", () => true)] });
    expect(gappy.goals[0].projected!).toBeLessThan(many.goals[0].projected!);
  });

  it("has nothing to forecast without unit goals or without aligned weekly goals", () => {
    const none = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(3), buGoals: [], facts: weeks(1, 3, "x", () => true).map((f) => ({ ...f, buGoalId: null })) });
    expect(none.outlook).toBe("NO_DATA");
    expect(none.risks[0].id).toBe("no-bu-goals");
    const orphan = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(3), buGoals: [bg("a", "Lonely goal")], facts: [] });
    expect(orphan.goals[0].outlook).toBe("NO_DATA");
    expect(orphan.risks.some((r) => r.id === "none-a")).toBe(true);
  });
});

describe("BU intelligence: a week still in progress", () => {
  it("is left out of the evidence until its tasks are decided or the week ends", () => {
    const settled = weeks(1, 4, "a", () => true);
    const open = weeks(5, 5, "a", () => false).map((f) => ({ ...f, tasksUndefined: 3, tasksDone: 0 }));          // week 5, in progress: nothing decided yet
    const withOpen = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(4), buGoals: [bg("a", "Goal")], facts: [...settled, ...open] });
    const without = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(4), buGoals: [bg("a", "Goal")], facts: settled });
    expect(withOpen.goals[0].projected).toBe(without.goals[0].projected);
    expect(withOpen.goals[0].outlook).toBe("ON_TRACK");
    expect(withOpen.prediction.weeksRemaining).toBe(without.prediction.weeksRemaining);       // the week in progress is still to come, not yet missed, with or without a report
    // once that week has ended, the same goals count as not done
    const later = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(6), buGoals: [bg("a", "Goal")], facts: [...settled, ...open] });
    expect(later.goals[0].projected!).toBeLessThan(without.goals[0].projected!);
  });
  it("does not count a running week with no report as missed, but does once it is over", () => {
    const settled = weeks(1, 4, "a", () => true);
    const during = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(4), buGoals: [bg("a", "Goal")], facts: settled });          // week 5 is running, nothing filed
    expect(during.prediction.weeksElapsed).toBe(3);     // week 4 is a holiday
    expect(during.risks.some((r) => r.id === "missed-weeks")).toBe(false);
    const over = buildBuIntelligence({ unit: UNIT, frame, now: new Date(new Date(nowAt(4)).getTime() + 6 * day).toISOString(), buGoals: [bg("a", "Goal")], facts: settled });  // week 5 is over, nothing filed
    expect(over.prediction.weeksElapsed).toBe(4);
    expect(over.risks.some((r) => r.id === "missed-weeks")).toBe(true);
  });
});

describe("BU intelligence: alignment", () => {
  it("measures how many weekly goals support a unit goal and finds orphans", () => {
    const facts = [...weeks(1, 4, "a", () => true, 2), ...weeks(1, 4, "a", () => true, 0), ...Array.from({ length: 4 }, (_, i) => fact(i + 1, null, true))];
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(3), buGoals: [bg("a", "Grow revenue"), bg("b", "Never touched")], facts });
    expect(out.alignment.weeklyGoals).toBe(12);
    expect(out.alignment.aligned).toBe(8);
    expect(out.alignment.alignedPct).toBeCloseTo(66.7, 1);
    expect(out.alignment.orphaned).toEqual(["Never touched"]);
    expect(out.risks.some((r) => r.id === "unaligned")).toBe(true);
  });
  it("spots a weekly goal whose wording shares nothing with its unit goal", () => {
    const facts = [fact(1, "a", true, { title: "Repaint the office walls" })];
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(0), buGoals: [bg("a", "Grow partner revenue quarterly")], facts });
    expect(out.alignment.weakWording).toHaveLength(1);
    const same = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(0), buGoals: [bg("a", "Grow partner revenue quarterly")], facts: [fact(1, "a", true, { title: "Grow partner revenue with two new accounts" })] });
    expect(same.alignment.weakWording).toHaveLength(0);
  });
  it("flags effort concentrated on one unit goal", () => {
    const facts = [...weeks(1, 4, "a", () => true, 3), ...weeks(1, 1, "b", () => true, 1), ...weeks(1, 1, "c", () => true, 1)];
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(3), buGoals: [bg("a", "A goal"), bg("b", "B goal"), bg("c", "C goal")], facts });
    expect(out.alignment.concentration?.title).toBe("A goal");
  });
});

describe("BU intelligence: predictions and risks", () => {
  it("projects the quarter score from the weeks so far and says what is still needed", () => {
    const facts = weeks(1, 6, "a", (_w, i) => i < 2);                     // two thirds of goals done each week
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(5), buGoals: [bg("a", "Goal")], facts });
    const p = out.prediction;
    expect(p.weeksElapsed).toBe(5);                                       // six calendar weeks, the holiday is left out
    expect(p.weeksRemaining).toBe(7);                                      // of 12 reportable weeks
    expect(p.projectedQuarterScore!).toBeGreaterThan(60);
    expect(p.projectedQuarterScore!).toBeLessThan(72);
    expect(p.range![0]).toBeLessThanOrEqual(p.projectedQuarterScore!);
    expect(p.range![1]).toBeGreaterThanOrEqual(p.projectedQuarterScore!);
    expect(p.neededWeeklyAverage!).toBeGreaterThan(70);                    // a shortfall to make up
    expect(p.reachable).toBe(true);
  });
  it("says when the target can no longer be reached", () => {
    const facts = weeks(1, 9, "a", () => false);
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(10), buGoals: [bg("a", "Goal")], facts });
    expect(out.prediction.reachable).toBe(false);
    expect(out.risks.some((r) => r.id === "quarter-score" && r.severity === "high")).toBe(true);
  });
  it("counts a week with no goals as a missed week and flags tasks done but goals not closing", () => {
    const facts = [...weeks(1, 2, "a", () => false, 3), ...weeks(4, 5, "a", () => false, 3)].map((f) => ({ ...f, tasksDone: 2 }));   // week 3 is empty
    const out = buildBuIntelligence({ unit: UNIT, frame, now: nowAt(5), buGoals: [bg("a", "Goal")], facts });
    expect(out.risks.some((r) => r.id === "missed-weeks")).toBe(true);
    expect(out.risks.some((r) => r.id === "tasks-vs-goals")).toBe(true);
  });
  it("orders risks most severe first and is deterministic", () => {
    const facts = weeks(1, 5, "a", () => false);
    const i = { unit: UNIT, frame, now: nowAt(4), buGoals: [bg("a", "Goal")], facts };
    const one = buildBuIntelligence(i), two = buildBuIntelligence(i);
    expect(one).toEqual(two);
    const order = { high: 0, medium: 1, low: 2 };
    expect(one.risks.map((r) => order[r.severity])).toEqual([...one.risks.map((r) => order[r.severity])].sort((x, y) => x - y));
  });
  it("rolls up units for the organisation", () => {
    const facts = [...weeks(1, 5, "a", () => true), ...weeks(1, 5, "b", () => false).map((f) => ({ ...f, businessUnitId: "u2" }))];
    const goals = [bg("a", "Goal A"), { ...bg("b", "Goal B"), businessUnitId: "u2" }];
    const org = buildOrgIntelligence({ units: [UNIT, { id: "u2", name: "Sales" }, { id: "u3", name: "HR" }], frame, now: nowAt(4), buGoals: goals, facts });
    expect(org.counts.ON_TRACK).toBe(1);
    expect(org.counts.OFF_TRACK).toBe(1);
    expect(org.counts.NO_DATA).toBe(1);
    expect(org.withoutGoals).toEqual(["HR"]);
    expect(org.atRiskUnits).toEqual(["Sales"]);
    expect(org.topRisks.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import type { BuGoalInput, GoalFact, QuarterFrame } from "../bu-intelligence";
import { analyseUnit, buildManagementBrief, type BriefUnitFacts } from "../management-brief";

const day = 864e5;
const start = new Date("2026-10-05T00:00:00Z").getTime();
const frame: QuarterFrame = { startsOn: "2026-10-05", endsOn: "2027-01-03", weeks: Array.from({ length: 13 }, (_, i) => ({ id: `w${i + 1}`, number: 41 + i, start: new Date(start + i * 7 * day).toISOString(), holiday: false })) };
const nowAt = (weekIndex: number) => new Date(start + weekIndex * 7 * day + 2 * day).toISOString();
let n = 0;
const fact = (unit: string, week: number, buGoalId: string | null, done: boolean, o: Partial<GoalFact> = {}): GoalFact => ({
  goalId: `g${++n}`, businessUnitId: unit, weekId: `w${week}`, weekNumber: 40 + week, weekStart: new Date(start + (week - 1) * 7 * day).toISOString(), submitted: true,
  buGoalId, subKrCode: "KR1.1", krCode: "KR1", title: "Close 4 partner follow-ups by Friday", done, tasksTotal: 3, tasksDone: done ? 3 : 1, tasksUndefined: 0, smart: 75, ...o,
});
const rows = (unit: string, from: number, to: number, bu: string, doneOf: (w: number, i: number) => boolean, per = 3, o: Partial<GoalFact> = {}) =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k).flatMap((w) => Array.from({ length: per }, (_, i) => fact(unit, w, bu, doneOf(w, i), o)));
const goal = (id: string, unit: string, title = "Grow partner revenue"): BuGoalInput => ({ id, businessUnitId: unit, title, status: "ACTIVE" });
const U = (id: string, name = id) => ({ id, name });
const base = (facts: GoalFact[], goals: BuGoalInput[], brief?: BriefUnitFacts, unit = "u1", now = nowAt(5)) => analyseUnit({ unit: U(unit), frame, now, buGoals: goals, facts, brief });
const bf = (o: Partial<BriefUnitFacts>): BriefUnitFacts => ({ businessUnitId: "u1", decidedTasks: 30, lateDecidedTasks: 0, corrections: 0, submissions: 6, lateSubmissions: 0, attendancePresent: 9, attendanceTotal: 10, openViolations: 0, openFines: 0, ...o });

describe("capacity and carry-over", () => {
  it("calls a unit over-committed when it plans far more than it finishes", () => {
    const facts = rows("u1", 1, 5, "a", () => false, 4).map((f) => ({ ...f, tasksTotal: 3, tasksDone: 1 }));
    const a = base(facts, [goal("a", "u1")], undefined, "u1", nowAt(4));
    expect(a.capacity.plannedPerWeek).toBe(12);
    expect(a.capacity.donePerWeek).toBe(4);
    expect(a.capacity.overcommitted).toBe(true);
    expect(a.cause?.code).toBe("OVERCOMMITTED");
    const fine = base(rows("u1", 1, 5, "a", () => true, 2), [goal("a", "u1")], undefined, "u1", nowAt(4));
    expect(fine.capacity.overcommitted).toBe(false);
  });
  it("finds a goal set again and again without being finished", () => {
    const facts = [
      ...[1, 2, 3].map((w) => fact("u1", w, "a", false, { title: "Reconcile the partner grant expenditure ledger" })),
      ...[1, 2, 3].map((w) => fact("u1", w, "a", true, { title: "Send the weekly status note" })),
    ];
    const a = base(facts, [goal("a", "u1")], undefined, "u1", nowAt(3));
    expect(a.capacity.carryOver).toEqual([{ title: "Reconcile the partner grant expenditure ledger", weeks: 3 }]);
  });
});

describe("goal difficulty and score integrity", () => {
  it("rates light, loosely measured goals as light, and flags a near-perfect score from them", () => {
    const light = rows("u1", 1, 5, "a", () => true, 3, { title: "Tidy the shared folders", tasksTotal: 1, tasksDone: 1 });
    const a = base(light, [goal("a", "u1")]);
    expect(a.difficulty.level).toBe("light");
    expect(a.difficulty.sandbagging).toBe(true);
    expect(a.integrity.flags.join(" ")).toContain("near-perfect score");
    const hard = rows("u1", 1, 5, "a", () => true, 3, { title: "Close 5 invoices by Friday 17:00", tasksTotal: 4, tasksDone: 4 });
    expect(base(hard, [goal("a", "u1")]).difficulty.level).toBe("demanding");
    expect(base(hard, [goal("a", "u1")]).difficulty.sandbagging).toBe(false);
  });
  it("flags tasks all marked just before the lock, corrections and late submissions", () => {
    const facts = rows("u1", 1, 4, "a", () => true, 3, { title: "Close 5 invoices by Friday" });
    const clean = base(facts, [goal("a", "u1")], bf({}));
    expect(clean.integrity.level).toBe("ok");
    const watch = base(facts, [goal("a", "u1")], bf({ lateDecidedTasks: 20 }));
    expect(watch.integrity.level).toBe("watch");
    expect(watch.integrity.flags[0]).toContain("last two hours");
    const review = base(facts, [goal("a", "u1")], bf({ lateDecidedTasks: 20, corrections: 3, lateSubmissions: 5 }));
    expect(review.integrity.level).toBe("review");
  });
  it("does not read a flag into too little data", () => {
    expect(base(rows("u1", 1, 2, "a", () => true), [goal("a", "u1")], bf({ decidedTasks: 4, lateDecidedTasks: 4, submissions: 2, lateSubmissions: 2 })).integrity.level).toBe("ok");
  });
});

describe("what changed and what would change it", () => {
  it("reports last week against the one before", () => {
    const facts = [...rows("u1", 1, 4, "a", () => true, 3), ...rows("u1", 5, 5, "a", (_w, i) => i === 0, 3)];
    const a = base(facts, [goal("a", "u1")], undefined, "u1", nowAt(5));
    expect(a.change.last).toBeCloseTo(33.3, 1);
    expect(a.change.previous).toBe(100);
    expect(a.change.delta).toBeCloseTo(-66.7, 1);
  });
  it("shows what finishing the latest week's goals, or lifting every week by ten points, would do", () => {
    const facts = [...rows("u1", 1, 4, "a", () => true, 3), ...rows("u1", 5, 5, "a", (_w, i) => i === 0, 3)];
    const a = base(facts, [goal("a", "u1")], undefined, "u1", nowAt(5));
    expect(a.whatIf.finishLatest!.delta).toBeGreaterThan(0);
    expect(a.whatIf.lift10!.delta).toBeGreaterThanOrEqual(0);
    const perfect = base(rows("u1", 1, 5, "a", () => true, 3), [goal("a", "u1")]);
    expect(perfect.whatIf.finishLatest!.delta).toBe(0);
  });
});

describe("cause", () => {
  it("names one main reason, in order of how fixable it is", () => {
    expect(base([], [], undefined, "u1", nowAt(3)).cause?.code).toBe("NO_GOALS");
    const notFiling = base([...rows("u1", 1, 1, "a", () => false, 3), ...rows("u1", 4, 4, "a", () => false, 3)], [goal("a", "u1")], undefined, "u1", nowAt(4));
    expect(notFiling.cause?.code).toBe("NOT_FILING");
    const closing = base(rows("u1", 1, 6, "a", () => false, 3).map((f) => ({ ...f, tasksTotal: 3, tasksDone: 2 })), [goal("a", "u1")]);
    expect(closing.cause?.code).toBe("GOALS_NOT_CLOSING");
  });
  it("gives no cause to a unit that is on track", () => {
    expect(base(rows("u1", 1, 6, "a", () => true, 3), [goal("a", "u1")]).cause).toBeNull();
  });
});

describe("the management brief", () => {
  const mk = () => {
    const facts = [
      ...rows("u1", 1, 5, "a", () => true, 3), ...rows("u2", 1, 5, "b", () => false, 3), ...rows("u3", 1, 5, "c", (w) => w >= 4, 3),
    ];
    const goals = [goal("a", "u1"), goal("b", "u2"), goal("c", "u3")];
    const subKrs = [{ krCode: "KR1", code: "KR1.1", title: "Upsell" }, { krCode: "KR1", code: "KR1.2", title: "Retention" }, { krCode: "KR2", code: "KR2.1", title: "Capacity" }, { krCode: "KR2", code: "KR2.2", title: "Quality" }];
    return buildManagementBrief({ units: [U("u1", "Finance"), U("u2", "Sales"), U("u3", "HR")], frame, now: nowAt(5), buGoals: goals, facts, subKrs,
      brief: [bf({ businessUnitId: "u1" }), bf({ businessUnitId: "u2", corrections: 3 }), bf({ businessUnitId: "u3" })],
      queues: { attendanceAmendments: { waiting: 2, oldestDays: 9 }, disbursements: { waiting: 0, oldestDays: 0 }, configChanges: { waiting: 1, oldestDays: 1 }, lateReportExceptions: { waiting: 0, oldestDays: 0 } },
      actions: [{ id: "x", businessUnitId: "u3", note: "Coaching call with the lead", scoreBefore: 0, createdAt: new Date(start + 3 * 7 * day).toISOString(), createdBy: "admin" }] });
  };
  it("opens with the position and names the units that need attention, with their cause", () => {
    const b = mk();
    expect(b.items[0].kind).toBe("summary");
    expect(b.items[0].text).toContain("of 3 units");
    const attention = b.items.filter((i) => i.kind === "attention");
    expect(attention[0].text).toContain("Sales");
    expect(attention[0].severity).toBe("high");
  });
  it("lists integrity concerns, coverage gaps and what is waiting for a decision", () => {
    const b = mk();
    expect(b.items.some((i) => i.kind === "integrity" && i.text.startsWith("Sales"))).toBe(true);
    const gap = b.items.find((i) => i.kind === "coverage");
    expect(gap?.text).toContain("KR1.2");
    expect(b.coverage.find((r) => r.code === "KR1.1")!.status).not.toBe("uncovered");
    expect(b.coverage.find((r) => r.code === "KR2.1")!.status).toBe("uncovered");
    const decision = b.items.filter((i) => i.kind === "decision");
    expect(decision.some((d) => d.text.includes("attendance amendments") && d.severity === "high")).toBe(true);   // the oldest has waited 9 days
  });
  it("places each unit among its peers and recognises improvement", () => {
    const b = mk();
    expect(b.units.every((u) => u.peer.percentile !== null)).toBe(true);
    const best = b.units.find((u) => u.unitName === "Finance")!, worst = b.units.find((u) => u.unitName === "Sales")!;
    expect(best.intel.prediction.projectedQuarterScore!).toBeGreaterThan(worst.intel.prediction.projectedQuarterScore!);
  });
  it("shows how a unit did after an action was logged", () => {
    const a = mk().actions[0];
    expect(a.unitName).toBe("HR");
    expect(a.weeksAfter).toBeGreaterThan(0);
    expect(a.scoreAfter).toBe(100);
    expect(a.change).toBe(100);
  });
  it("is deterministic", () => { expect(mk()).toEqual(mk()); });
});

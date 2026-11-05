import { describe, expect, it } from "vitest";
import { byUnit, byWeek, elapsed, heatState, normaliseCells, totals, trendSeries } from "@/lib/analytics";

const row = (o: Record<string, unknown>) => ({
  business_unit_id: "u1", bu_code: "ENG", business_unit: "Engineering", reports_weekly: true, reporting_week_id: "w1", week_number: 1, week_year: 2026, week_start_at: "2026-10-05T00:00:00Z",
  reporting_state: "NORMAL", weekly_report_id: "r1", submission_status: "SUBMITTED", submitted_on_time: true, tasks_total: 10, tasks_done: 7, tasks_not_done: 2, tasks_undefined: 1,
  goals_total: 4, goals_done: 3, final_score: "70.00", score_state: "SCORED", compliance_status: "COMPLIANT", ...o,
});

describe("dashboard analytics", () => {
  const cells = normaliseCells([
    row({}),
    row({ reporting_week_id: "w2", week_number: 2, week_start_at: "2026-10-12T00:00:00Z", tasks_total: 10, tasks_done: 3, tasks_not_done: 7, tasks_undefined: 0, final_score: "30.00" }),
    row({ business_unit_id: "u2", bu_code: "HR", business_unit: "Human Resources", reports_weekly: false, weekly_report_id: null, submission_status: "NOT_SUBMITTED", submitted_on_time: false, tasks_total: 0, tasks_done: 0, tasks_not_done: 0, tasks_undefined: 0, final_score: null, score_state: null, compliance_status: null }),
    row({ business_unit_id: "u3", bu_code: "SAL", business_unit: "Sales", reporting_week_id: "w1", weekly_report_id: null, submission_status: "NOT_SUBMITTED", submitted_on_time: false, tasks_total: 0, tasks_done: 0, tasks_not_done: 0, tasks_undefined: 0, final_score: "0.00", score_state: "NOT_SUBMITTED", compliance_status: "NON_COMPLIANT" }),
  ]);

  it("sums tasks and computes completion from the stored rows", () => {
    const t = totals(cells.filter((c) => c.businessUnitId === "u1"));
    expect(t).toMatchObject({ tasksTotal: 20, tasksDone: 10, tasksNotDone: 9, tasksUndefined: 1, completion: 50, avgScore: 50, onTimeRate: 100 });
  });

  it("does not count a Department (no weekly report) as a missing or reportable week", () => {
    const t = totals(cells.filter((c) => c.businessUnitId === "u2"));
    expect(t).toMatchObject({ reportableWeeks: 0, missingWeeks: 0, avgScore: null, completion: null });
    expect(heatState(cells[2])).toBe("NOT_REQUIRED");
  });

  it("counts a non-compliant week as missing and scores it as the engine stored it", () => {
    const t = totals(cells.filter((c) => c.businessUnitId === "u3"));
    expect(t).toMatchObject({ missingWeeks: 1, avgScore: 0 });
    expect(heatState(cells[3])).toBe("MISSING");
  });

  it("ranks units by average score, and groups weeks in date order", () => {
    expect(byUnit(cells).map((u) => u.code)).toEqual(["ENG", "SAL", "HR"]);
    expect(byWeek(cells).map((w) => w.label)).toEqual(["W1", "W2"]);
  });

  it("leaves out weeks that have not started and treats holidays separately", () => {
    expect(elapsed(cells, "2026-10-10T00:00:00Z")).toHaveLength(3);
    expect(heatState(normaliseCells([row({ reporting_state: "ORGANIZATION_HOLIDAY" })])[0])).toBe("HOLIDAY");
    expect(totals(normaliseCells([row({ reporting_state: "ORGANIZATION_HOLIDAY" })])).reportableWeeks).toBe(0);
  });
});

describe("trend and export", () => {
  it("compares the last two weeks that have a value", async () => {
    const { trendOf } = await import("@/lib/analytics");
    expect(trendOf([10, 20, 25], "relative")).toEqual({ value: 25, direction: "up" });
    expect(trendOf([80, null, 70], "points")).toEqual({ value: -10, direction: "down" });
    expect(trendOf([5], "relative")).toBeNull();
    expect(trendOf([0, 4], "relative")).toBeNull();                       // no percentage change from nothing
    expect(trendOf([0, 0], "relative")).toEqual({ value: 0, direction: "flat" });
  });

  it("writes a CSV a spreadsheet cannot run as a formula", async () => {
    const { unitsCsv } = await import("@/lib/analytics");
    const { csvEscape } = await import("@/lib/reports/sanitize");
    const rows = byUnit(normaliseCells([row({ bu_code: "ENG", business_unit: "=HYPERLINK(\"x\")" })]));
    const csv = unitsCsv(rows, csvEscape);
    expect(csv.split("\r\n")[0]).toContain("Task completion %");
    expect(csv.split("\r\n")[0]).toContain("Goal completion %");
    expect(csv.split("\r\n")[0]).not.toMatch(/On time|Missing/);
    expect(csv).toContain("'=HYPERLINK");                                  // neutralised
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

describe("performance over time: task completion against goals completion", () => {
  const cell = (unit: string, weekStart: string, weekNumber: number, quarter: number, year: number, td: number, tt: number, gd: number, gt: number) =>
    ({ businessUnitId: unit, name: unit, weekId: `${unit}-${weekNumber}`, weekNumber, weekStart, year, quarter, tasksTotal: tt, tasksDone: td, goalsTotal: gt, goalsDone: gd });
  const cells = [
    cell("a", "2026-09-27T23:00:00Z", 40, 3, 2026, 5, 10, 1, 2), cell("b", "2026-09-27T23:00:00Z", 40, 3, 2026, 3, 3, 1, 1),     // Q3, week 40, starting Mon 28 Sep
    cell("a", "2026-10-04T23:00:00Z", 41, 4, 2026, 2, 4, 0, 1), cell("a", "2026-10-11T23:00:00Z", 42, 4, 2026, 4, 4, 1, 1),         // Q4, weeks 41 and 42
    cell("a", "2027-01-03T23:00:00Z", 1, 1, 2027, 9, 9, 3, 3),                                                                      // a week that has not started
  ];
  const now = "2026-10-20T00:00:00Z";
  it("averages each unit's rate, so a big unit counts once like a small one", () => {
    const w = trendSeries(cells, "week", now, "all", null).find((p) => p.label === "W40")!;
    expect(w.tasks).toBeCloseTo((50 + 100) / 2, 5);      // a 5 of 10, b 3 of 3: the mean of 50% and 100%, not 8 of 13
    expect(w.goals).toBeCloseTo((50 + 100) / 2, 5);
    expect(w.units).toBe(2);
  });
  it("groups by week, month, quarter and year, and leaves out weeks that have not started", () => {
    expect(trendSeries(cells, "week", now, "all", null).map((p) => p.label)).toEqual(["W40", "W41", "W42"]);
    expect(trendSeries(cells, "week", now, "all", "2026-4").map((p) => p.label)).toEqual(["W41", "W42"]);
    expect(trendSeries(cells, "month", now, "all", null).map((p) => p.label)).toEqual(["Sep 2026", "Oct 2026"]);
    const q = trendSeries(cells, "quarter", now, "all", null);
    expect(q.map((p) => p.label)).toEqual(["Q3 2026", "Q4 2026"]);
    expect(q[1].tasks).toBeCloseTo(75, 5);                // unit a in Q4: (2 + 4) of (4 + 4) tasks
    expect(q[1].goals).toBeCloseTo(50, 5);                // 1 of 2 goals
    expect(trendSeries(cells, "year", now, "all", null).map((p) => p.label)).toEqual(["2026"]);
  });
  it("narrows to one unit", () => {
    const b = trendSeries(cells, "week", now, "b", null);
    expect(b).toHaveLength(1);
    expect(b[0].tasks).toBe(100);
  });
  it("counts a goal as not done only when one of its tasks is not done", () => {
    const [c] = normaliseCells([{ business_unit_id: "u", bu_code: "U", business_unit: "U", reports_weekly: true, reporting_week_id: "w", week_number: 41, week_year: 2026, week_start_at: "2026-10-04T23:00:00Z",
      reporting_state: "NORMAL", submission_status: "SUBMITTED", tasks_total: 6, tasks_done: 1, tasks_not_done: 1, tasks_undefined: 4, goals_total: 2, goals_done: 0, goals_not_done: 1 }]);
    const t = totals([c]);
    expect(t.goalsNotDone).toBe(1);
    expect(t.goalsTotal - t.goalsDone - t.goalsNotDone).toBe(1);   // one goal is still open
  });
});

describe("the units table's average score", () => {
  it("counts a week not yet final at the share of its goals done, so the figure is not blank while the week is open", () => {
    const [open] = normaliseCells([row({ final_score: null, score_state: null, submission_status: "SUBMITTED", goals_total: 4, goals_done: 3 })]);
    const t = totals([open]);
    expect(t.avgScore).toBeNull();            // nothing is final yet
    expect(t.avgScoreToDate).toBeCloseTo(75, 5);
    const [final] = normaliseCells([row({ final_score: 60, score_state: "SCORED", submission_status: "SUBMITTED", goals_total: 4, goals_done: 3 })]);
    expect(totals([final]).avgScoreToDate).toBe(60);                // a final score always wins over the preview
  });
});

import { describe, expect, it } from "vitest";
import { byUnit, byWeek, elapsed, heatState, normaliseCells, totals } from "@/lib/analytics";

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
    expect(csv.split("\r\n")[0]).toContain("Completion %");
    expect(csv).toContain("'=HYPERLINK");                                  // neutralised
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

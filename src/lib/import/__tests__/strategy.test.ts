import { describe, expect, it } from "vitest";
import { detectStrategyLayout, parseStrategyRows } from "../strategy";

const headers = ["Year", "Quarter", "Objective", "KR", "KR title", "Sub-KR", "Sub-KR title"];

describe("strategy sheet parser", () => {
  it("reads one row per Sub-KR and repeats blank cells from the row above", () => {
    const r = parseStrategyRows(headers, [
      ["2026", "Q4", "Grow", "KR-1", "REVENUE", "1", "Revenue"],
      ["", "", "", "KR-2", "TEAM", "1.1", "Hire"],
      ["", "", "", "", "", "1.2", "Train"],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => [x.row_no, x.year, x.quarter, x.kr_no, x.kr_title, x.sub_no])).toEqual([[2, 2026, 4, 1, "REVENUE", 1], [3, 2026, 4, 2, "TEAM", 1], [4, 2026, 4, 2, "TEAM", 2]]);
  });
  it("explains each bad row and refuses formulas", () => {
    const r = parseStrategyRows(headers, [
      ["2026", "5", "Grow", "1", "T", "1", "S"],
      ["2026", "1", "Grow", "9", "T", "1", "S"],
      ["2026", "1", "Grow", "1", "T", "x", "S"],
      ["2026", "1", "Grow", "1", "T", "1", ""],
      ["2026", "1", "=1+1", "1", "T", "1", "S"],
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 6]);
    expect(r.rows).toEqual([]);
  });
  it("names the missing columns", () => {
    expect(detectStrategyLayout(["Year", "Quarter", "Objective"])).toEqual({ error: expect.stringContaining("KR title") });
  });
});

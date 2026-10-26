import { describe, expect, it } from "vitest";
import { detectLayout, normaliseSubKr, parseHistoryRows, parseStatus } from "../history";

const units = [{ id: "u1", code: "HNB", name: "HnB" }, { id: "u2", code: "NIG", name: "NIGER" }];
const headers = ["Year", "Week", "BU/Depart", "SubKR Category", "Goal", "Task 1", "Status 1", "Task 2", "Status 2", "Task 3", "Status 3"];

describe("historical sheet parser", () => {
  it("reads the sample layout, repeats blank year/week/unit cells, and skips empty tasks", () => {
    const r = parseHistoryRows(headers, [
      ["2026", "30", "HnB", "1.1", "Goal A", "T1", "Done", "T2", "Not Done", "", ""],
      ["", "", "", "1.3", "Goal B", "T1", "done", "", "", "", ""],
      ["2026", "31", "niger", "", "Stretch", "T", "Not done", "", "", "", ""],
    ], units);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => [x.row_no, x.year, x.week, x.bu_id, x.sub_kr, x.tasks.length])).toEqual([[2, 2026, 30, "u1", "1.1", 2], [3, 2026, 30, "u1", "1.3", 1], [4, 2026, 31, "u2", null, 1]]);
  });
  it("reports each bad row with its spreadsheet row number", () => {
    const r = parseHistoryRows(headers, [
      ["2026", "30", "Nowhere", "1.1", "G", "T", "Done", "", "", "", ""],
      ["2026", "99", "HnB", "1.1", "G", "T", "Done", "", "", "", ""],
      ["2026", "30", "HnB", "1.1", "G", "T", "Maybe", "", "", "", ""],
      ["2026", "30", "HnB", "1.1", "G", "", "Done", "", "", "", ""],
      ["2026", "30", "HnB", "1.1", "=1+1", "T", "Done", "", "", "", ""],
      ["2026", "30", "HnB", "1.1", "G", "", "", "", "", "", ""],
    ], units);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.unknownUnits).toEqual(["Nowhere"]);
    expect(r.rows).toEqual([]);
  });
  it("explains a missing column", () => {
    expect(detectLayout(["Year", "Week", "Goal", "Task 1", "Status 1"])).toEqual({ error: expect.stringContaining("BU/Depart") });
    expect(detectLayout(["Year", "Week", "BU", "Goal", "Task 1"])).toEqual({ error: expect.stringContaining("Task 1 and Status 1") });
  });
  it("normalises statuses and Sub-KR codes", () => {
    expect(parseStatus("Not  Done")).toBe("NOT_DONE");
    expect(parseStatus("DONE")).toBe("DONE");
    expect(parseStatus("")).toBeNull();
    expect([normaliseSubKr("KR 2.3"), normaliseSubKr(" 1.1 "), normaliseSubKr("-"), normaliseSubKr("Stretch"), normaliseSubKr("x")]).toEqual(["2.3", "1.1", null, null, "x"]);
  });
});

describe("goal column names (a real sheet used the heading Goal Title)", () => {
  it("accepts Goal Title, Goal Name and similar headings, in any case or punctuation", () => {
    for (const heading of ["Goal Title", "goal title", "GOAL_TITLE", "Goal Name", "SMART Goal", "Goal description", "Title"]) {
      const r = detectLayout(["Year", "Week", "BU/Depart", "SubKR", heading, "Task 1", "Status 1"]);
      expect("layout" in r, heading).toBe(true);
      if ("layout" in r) expect(r.layout.goal, heading).toBe(4);
    }
  });

  it("still asks for a goal column when there is none, and says what the accepted names are", () => {
    const r = detectLayout(["Year", "Week", "BU/Depart", "SubKR", "Task 1", "Status 1"]);
    expect(r).toEqual({ error: expect.stringContaining("Goal") });
  });

  it("reads the exact header row of the owner's sheet (a trailing '...' column is ignored)", () => {
    const r = detectLayout(["Year", "Week", "BU/Depart", "SubKR", "Goal Title", "Task 1", "Status 1", "Task 2", "Status 2", "..."]);
    expect("layout" in r).toBe(true);
    if ("layout" in r) expect(r.layout.tasks).toHaveLength(2);
  });
});

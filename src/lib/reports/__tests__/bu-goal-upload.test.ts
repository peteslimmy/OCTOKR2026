import { describe, expect, it } from "vitest";
import { buGoalTemplateCsv, parseBuGoalUpload } from "../bu-goal-upload";

describe("Business Unit goal upload", () => {
  it("reads one goal per row under Goal, ignores blank rows, and trims", () => {
    const r = parseBuGoalUpload(["Goal"], [["  Grow partner revenue  "], [""], ["Open a second office"]]);
    expect(r).toEqual({ titles: ["Grow partner revenue", "Open a second office"], errors: [] });
  });
  it("accepts the heading written as BU goal or Business Unit goal", () => {
    expect(parseBuGoalUpload(["BU goal"], [["A"]]).titles).toEqual(["A"]);
    expect(parseBuGoalUpload(["Business Unit goal"], [["A"]]).titles).toEqual(["A"]);
  });
  it("names the row of every problem: formulas, length, repeats and goals the unit already has", () => {
    const long = "x".repeat(501);
    const r = parseBuGoalUpload(["Goal"], [["=SUM(1,2)"], [long], ["Keep it"], ["keep it"], ["Already there"]], new Set(["Already there"]));
    expect(r.titles).toEqual(["Keep it"]);
    expect(r.errors).toEqual([
      'Row 2: the cell starts with "=" (formulas are not accepted).',
      "Row 3: the goal is longer than 500 characters.",
      "Row 5: the same goal is already on row 4.",
      'Row 6: your unit already has this goal this quarter ("Already there").',
    ]);
  });
  it("says what is wrong with a file that has no Goal heading or no goals", () => {
    expect(parseBuGoalUpload(["Name"], [["x"]]).errors[0]).toMatch(/column heading called Goal/);
    expect(parseBuGoalUpload(["Goal"], [[""]]).errors[0]).toMatch(/no goals/);
  });
  it("refuses more than 100 goals and has a header-only template", () => {
    const rows = Array.from({ length: 101 }, (_, i) => [`Goal ${i}`]);
    expect(parseBuGoalUpload(["Goal"], rows).errors[0]).toMatch(/at most 100/);
    expect(buGoalTemplateCsv()).toBe("Goal\r\n");
  });
});

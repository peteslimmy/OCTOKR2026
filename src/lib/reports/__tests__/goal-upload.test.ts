import { describe, expect, it } from "vitest";
import { goalTemplateCsv, parseGoalUpload } from "../goal-upload";

const subs = new Map([["KR1.1", "sub-1"], ["KR2.1", "sub-2"]]);
const H = ["Goal", "Sub-KR", "Description", "Task"];

describe("parseGoalUpload", () => {
  it("groups rows into goals: a Goal starts one, a blank Goal continues it", () => {
    const { goals, errors } = parseGoalUpload(H, [
      ["Close 5 calls by Friday", "KR2.1", "five partners", "Schedule calls"],
      ["", "", "", "Hold calls"],
      ["Publish the pricing sheet", "", "", "Draft it"],
    ], subs);
    expect(errors).toEqual([]);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({ goalType: "KR_ALIGNED", subKeyResultId: "sub-2", description: "five partners" });
    expect(goals[0].tasks.map((t) => t.description)).toEqual(["Schedule calls", "Hold calls"]);
    expect(goals[1]).toMatchObject({ goalType: "STRETCH", subKeyResultId: null });
  });

  it("accepts a Sub-KR written with its title and in any case", () => {
    expect(parseGoalUpload(H, [["G", "kr1.1 Upsell and Cross-Sell", "", "T"]], subs).goals[0].subKeyResultId).toBe("sub-1");
  });

  it("lists every problem with its sheet row, and adds nothing when there is one", () => {
    const { errors } = parseGoalUpload(H, [
      ["Has no task", "KR1.1", "", ""],
      ["Unknown sub-kr", "KR9.9", "", "T"],
      ["Formula", "", "", "=HYPERLINK(\"x\")"],
    ], subs);
    expect(errors.join("\n")).toContain('Row 3: Sub-KR "KR9.9" does not exist');
    expect(errors.join("\n")).toContain('Row 4: a cell starts with "="');
    expect(errors.join("\n")).toContain('Goal "Has no task" has no task');
  });

  it("needs the Goal and Task headings and a goal above a task", () => {
    expect(parseGoalUpload(["Name", "Thing"], [["a", "b"]], subs).errors[0]).toContain("Goal and Task");
    expect(parseGoalUpload(H, [["", "", "", "orphan task"]], subs).errors[0]).toContain("needs a goal above it");
  });

  it("ignores blank rows and refuses an empty file", () => {
    expect(parseGoalUpload(H, [["", "", "", ""]], subs).errors).toEqual(["The file holds no goals."]);
  });

  it("offers a template that parses cleanly", () => {
    const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, 4);
    const lines = goalTemplateCsv().trim().split(/\r?\n/).map(split);
    const out = parseGoalUpload(lines[0], lines.slice(1), subs, new Map([["grow partner revenue by 20%", "bu-1"]]));
    expect(out.errors).toEqual([]);
    expect(out.goals).toHaveLength(2);
    expect(out.goals.map((g) => g.tasks.length)).toEqual([2, 2]);
    expect(out.goals[0].buGoalId).toBe("bu-1");
  });

  describe("BU goals", () => {
    const HB = ["Goal", "Sub-KR", "BU goal", "Task"];
    const bu = new Map([["grow partner revenue", "bu-1"]]);
    it("links a goal to the unit goal named by its title, in any case", () => {
      expect(parseGoalUpload(HB, [["G", "KR1.1", "Grow Partner Revenue", "T"]], subs, bu).goals[0].buGoalId).toBe("bu-1");
    });
    it("asks for one once the unit has goals, but not for a stretch goal", () => {
      expect(parseGoalUpload(HB, [["G", "KR1.1", "", "T"]], subs, bu).errors.join(" ")).toContain("choose which BU goal");
      expect(parseGoalUpload(HB, [["Stretch", "", "", "T"]], subs, bu).errors).toEqual([]);
    });
    it("refuses a unit goal the unit does not have, and asks for nothing when the unit has none", () => {
      expect(parseGoalUpload(HB, [["G", "KR1.1", "Someone else's goal", "T"]], subs, bu).errors.join(" ")).toContain("is not one of your unit's active goals");
      expect(parseGoalUpload(HB, [["G", "KR1.1", "", "T"]], subs, new Map()).errors).toEqual([]);
    });
  });
});

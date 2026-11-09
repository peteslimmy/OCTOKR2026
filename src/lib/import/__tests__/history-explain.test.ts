import { describe, expect, it } from "vitest";
import { closestUnit, columnLetter, isoWeeksInYear, parseHistoryRows, type UnitRef } from "../history";
import { explainFileError, explainIssue, groupProblems, interpretTechnicalError } from "../history-explain";

const units: UnitRef[] = [{ id: "u1", code: "ENG", name: "Engineering" }, { id: "u2", code: "OPS", name: "Operations" }];
const H = ["Year", "Week", "BU/Depart", "SubKR", "Goal", "Task 1", "Status 1", "Task 2", "Status 2"];
const parse = (rows: string[][]) => parseHistoryRows(H, rows, units) as Exclude<ReturnType<typeof parseHistoryRows>, { error: string }>;

describe("history import: every problem says where, what was found and what to do", () => {
  it("reports the exact cell, the found value and a fix for each problem, all of a row at once", () => {
    const r = parse([["2025", "60", "Engg", "1.1", "", "Do it", "Maybe", "", ""]]);
    const codes = r.problems.map((p) => p.code).sort();
    expect(codes).toEqual(["GOAL_EMPTY", "STATUS_INVALID", "UNIT_UNKNOWN", "WEEK_INVALID"]);
    const unit = r.problems.find((p) => p.code === "UNIT_UNKNOWN")!;
    expect(unit).toMatchObject({ row: 2, cell: "C2", column: "BU/Depart", found: "Engg" });
    expect(unit.fix).toMatch(/Did you mean "ENG" \(Engineering\)/);
    const status = r.problems.find((p) => p.code === "STATUS_INVALID")!;
    expect(status).toMatchObject({ cell: "G2", found: "Maybe" });
    expect(status.fix).toMatch(/Done or Not Done/);
    for (const p of r.problems) { expect(p.fix, p.code).toBeTruthy(); expect(p.cell, p.code).toMatch(/^[A-Z]+\d+$/); }
  });

  it("refuses a week that does not exist in that year (week 53 of a 52-week year) before the database does", () => {
    expect(isoWeeksInYear(2025)).toBe(52);
    expect(isoWeeksInYear(2026)).toBe(53);
    const r = parse([["2025", "53", "ENG", "1.1", "G", "T", "Done", "", ""], ["2026", "53", "ENG", "1.1", "G", "T", "Done", "", ""]]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ row: 2, code: "WEEK_NOT_IN_YEAR" });
    expect(r.problems[0].message).toMatch(/only 52 weeks/);
    expect(r.rows).toHaveLength(1);
  });

  it("explains formulas and a goal without a task", () => {
    const r = parse([["2025", "3", "ENG", "", "=A1", "", "", "", ""]]);
    expect(r.problems.map((p) => p.code).sort()).toEqual(["FORMULA", "NO_TASK"]);
    expect(r.problems.find((p) => p.code === "FORMULA")!.fix).toMatch(/values only/);
  });

  it("keeps the short messages the database tests and the API rely on", () => {
    const r = parse([["2025", "3", "Nowhere", "", "G", "T", "Done", "", ""]]);
    expect(r.problems[0].message).toBe('"Nowhere" is not a Business Unit in the application. Use its code or its name.');
    expect(r.unknownUnits).toEqual(["Nowhere"]);
  });

  it("names columns by letter and finds the nearest unit", () => {
    expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(27)]).toEqual(["A", "Z", "AA", "AB"]);
    expect(closestUnit("operatons", units)?.code).toBe("OPS");
    expect(closestUnit("zzzzzz", units)).toBeNull();
  });

  it("lists the columns found when the layout is wrong", () => {
    const r = parseHistoryRows(["Yr", "Wk", "Dept", "Notes"], [["2025", "1", "ENG", "x"]], units);
    expect("error" in r && r.error).toMatch(/columns found in row 1 are: "Yr", "Wk", "Dept", "Notes"/);
  });
});

describe("history import: what the database says, explained", () => {
  const parsedRow = new Map([[7, { row_no: 7, year: 2025, week: 14, bu_id: "u1", sub_kr: "1.1", goal: "Improve API latency", tasks: [] }]]);
  it("gives each rule a code, a plain fix and the row's own context", () => {
    const e = explainIssue({ row: 7, message: "This unit already has a report for this week." }, parsedRow, units);
    expect(e.code).toBe("REPORT_EXISTS");
    expect(e.fix).toMatch(/never overwrite/);
    expect(e.context).toBe('Engineering (ENG) · 2025 week 14 · goal "Improve API latency"');
    expect(explainIssue({ row: 7, message: "This week belongs to a quarter that has not ended and is not the active quarter. Only closed quarters, or weeks of the active quarter, can be loaded here." }, parsedRow, units).code).toBe("QUARTER_OPEN");
    expect(explainIssue({ row: 7, message: "Something new" }, parsedRow, units).code).toBe("OTHER");
  });

  it("groups a long list into a short to-do list, biggest first", () => {
    const issues = [1, 2, 3].map((n) => explainIssue({ row: n, message: "This week has not closed yet." }, parsedRow, units)).concat(explainIssue({ row: 9, message: "The goal has no task." }, parsedRow, units));
    const g = groupProblems(issues);
    expect(g[0]).toMatchObject({ code: "WEEK_OPEN", count: 3, rows: [1, 2, 3] });
    expect(g[1].code).toBe("NO_TASK");
  });

  it("explains file and database failures with what to do", () => {
    expect(explainFileError("The file is larger than 10 MB.").fix).toMatch(/Split/);
    expect(explainFileError("The workbook could not be read. Save it again as .xlsx or export it as .csv.").fix).toMatch(/Save as/);
    expect(interpretTechnicalError("canceling statement due to statement timeout").fix).toMatch(/smaller files/);
    expect(interpretTechnicalError('duplicate key value violates unique constraint "x"').problem).toMatch(/already exists/);
    expect(interpretTechnicalError("something odd").fix).toMatch(/technical detail/);
  });
});

import { describe, expect, it } from "vitest";
import {
  IMPORT_LIMITS, applyMapping, errorReportCsv, mappingProblems, parseCsv, sniffFile, suggestMapping, validateRows,
  type ImportRow, type Reference,
} from "../employees";

const ref: Reference = {
  businessUnits: [
    { id: "bu-eng", code: "ENG", name: "Engineering", status: "ACTIVE" },
    { id: "bu-sal", code: "SAL", name: "Sales", status: "ACTIVE" },
    { id: "bu-old", code: "OLD", name: "Legacy", status: "INACTIVE" },
    { id: "dep-qa", code: "ENG-QA", name: "Quality Assurance", status: "ACTIVE", unitType: "DEPARTMENT", parentUnitId: "bu-eng" },
    { id: "dep-ops", code: "OPS", name: "Operations Desk", status: "ACTIVE", unitType: "DEPARTMENT", parentUnitId: null },
  ],
  employees: [{ email: "ada@x.com", firstName: "Ada", lastName: "Lovelace", businessUnitId: "bu-eng", status: "ACTIVE" }],
};
const row = (o: Partial<ImportRow> = {}): ImportRow => ({ email: "new@x.com", firstName: "New", lastName: "Person", businessUnit: "ENG", department: "", status: "", ...o });
const one = (o: Partial<ImportRow>, policy: Parameters<typeof validateRows>[1] = "SKIP_EXISTING") => validateRows([row(o)], policy, ref).results[0];
const codes = (o: Partial<ImportRow>, policy?: Parameters<typeof validateRows>[1]) => one(o, policy).issues.map((i) => i.code);

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, embedded line breaks, CRLF and a byte-order mark", () => {
    expect(parseCsv("﻿a,b\r\n\"x, y\",\"he said \"\"hi\"\"\"\r\n\"line1\nline2\",z\r\n")).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["line1\nline2", "z"]]);
  });
  it("detects semicolon and tab separators and ignores blank lines", () => {
    expect(parseCsv("a;b\n1;2\n\n3;4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("sniffFile", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it("accepts a real csv and an xlsx container, and nothing else", () => {
    expect(sniffFile("a.csv", new TextEncoder().encode("a,b"))).toEqual({ kind: "csv" });
    expect(sniffFile("a.XLSX", bytes(0x50, 0x4b, 3, 4))).toEqual({ kind: "xlsx" });
    expect(sniffFile("a.xls", bytes(1, 2))).toHaveProperty("error");
    expect(sniffFile("a.exe", bytes(0x4d, 0x5a))).toHaveProperty("error");
    expect(sniffFile("a.xlsm", bytes(0x50, 0x4b))).toHaveProperty("error");      // macro workbooks are refused
  });
  it("refuses disguised files, empty files and oversized files", () => {
    expect(sniffFile("a.csv", bytes(0x50, 0x4b, 3, 4))).toHaveProperty("error");   // a zip renamed .csv
    expect(sniffFile("a.csv", bytes(97, 0, 98))).toHaveProperty("error");          // binary content
    expect(sniffFile("a.xlsx", new TextEncoder().encode("hello"))).toHaveProperty("error");
    expect(sniffFile("a.csv", new Uint8Array(0))).toHaveProperty("error");
    expect(sniffFile("a.csv", new Uint8Array(IMPORT_LIMITS.maxBytes + 1).fill(97))).toHaveProperty("error");
  });
});

describe("column mapping", () => {
  it("suggests columns from common header spellings, each column once", () => {
    const m = suggestMapping(["Work Email", "Given Name", "Surname", "BU Code", "Employment Status", "Notes"]);
    expect(m).toEqual({ email: 0, firstName: 1, lastName: 2, businessUnit: 3, department: null, status: 4 });
    expect(mappingProblems(m)).toEqual([]);
  });
  it("reports missing required columns and reused columns", () => {
    expect(mappingProblems(suggestMapping(["foo", "bar"])).length).toBe(4);
    expect(mappingProblems({ email: 0, firstName: 0, lastName: 1, businessUnit: 2, department: null, status: null })).toContain("Each column can be used for only one field.");
  });
  it("applies the mapping and tolerates short rows", () => {
    const m = suggestMapping(["email", "first", "last", "bu"]);
    expect(applyMapping([["a@b.co", "A", "B"]], m)[0]).toEqual({ email: "a@b.co", firstName: "A", lastName: "B", businessUnit: "", department: "", status: "" });
  });
});

describe("row validation classes", () => {
  it("accepts a clean new row, resolving the Business Unit by code or by name, any case", () => {
    expect(one({}).action).toBe("CREATE");
    expect(one({ businessUnit: "eng" }).action).toBe("CREATE");
    expect(one({ businessUnit: "sales" }).action).toBe("CREATE");
  });
  it("blocks missing fields, bad emails, bad status, unknown and inactive Business Units", () => {
    expect(codes({ email: "" })).toContain("REQUIRED");
    expect(codes({ email: "not-an-email" })).toContain("INVALID_EMAIL");
    expect(codes({ email: "a b@x.com" })).toContain("INVALID_EMAIL");
    expect(codes({ firstName: " " })).toContain("REQUIRED");
    expect(codes({ lastName: "" })).toContain("REQUIRED");
    expect(codes({ status: "maybe" })).toContain("INVALID_STATUS");
    expect(codes({ businessUnit: "NOPE" })).toContain("UNKNOWN_BU");
    expect(one({ businessUnit: "OLD" }).issues[0].message).toMatch(/inactive/);
    expect(one({ businessUnit: "" }).action).toBe("BLOCKED");
  });
  it("blocks formula-injection text in every text field, and text that is too long", () => {
    for (const bad of ["=cmd|' /C calc'!A0", "+1+1", "@SUM(A1)", "-2+3"]) {
      expect(codes({ firstName: bad }), bad).toContain("INVALID_TEXT");
      expect(codes({ lastName: bad }), bad).toContain("INVALID_TEXT");
    }
    expect(codes({ email: "=a@b.co" })).toContain("INVALID_EMAIL");
    expect(codes({ firstName: "x".repeat(501) })).toContain("TOO_LONG");
    expect(codes({ firstName: "O'Brien-Smith" })).toEqual([]);   // a dash or quote inside a name is fine
  });
  it("flags repeated emails inside the file (case-insensitive) and points at the first row", () => {
    const { results } = validateRows([row({ email: "dup@x.com" }), row({ email: "DUP@x.com" })], "SKIP_EXISTING", ref);
    expect(results[0].action).toBe("CREATE");
    expect(results[1].action).toBe("BLOCKED");
    expect(results[1].issues[0]).toMatchObject({ code: "DUPLICATE_IN_FILE", severity: "ERROR" });
    expect(results[1].issues[0].message).toMatch(/row 1/);
  });
  it("notes trimmed spaces without blocking", () => {
    const r = one({ firstName: " New ", email: " new@x.com " });
    expect(r.action).toBe("CREATE");
    expect(r.issues.map((i) => i.code)).toEqual(["TRIMMED"]);
  });
});

describe("conflict policies", () => {
  const existing = { email: "Ada@X.com", firstName: "Ada", lastName: "Lovelace", businessUnit: "ENG" };
  it("ABORT_ON_CONFLICT blocks the file when a person exists", () => {
    const r = validateRows([row(existing)], "ABORT_ON_CONFLICT", ref);
    expect(r.results[0].action).toBe("BLOCKED");
    expect(r.summary.canCommit).toBe(false);
  });
  it("SKIP_EXISTING reports a conflict and leaves the person alone", () => {
    const r = one({ ...existing, firstName: "Changed" }, "SKIP_EXISTING");
    expect(r.action).toBe("SKIP");
    expect(r.issues[0]).toMatchObject({ code: "EMAIL_EXISTS", severity: "CONFLICT" });
  });
  it("UPDATE_EXISTING updates only when something differs, and warns about moves and status changes", () => {
    expect(one(existing, "UPDATE_EXISTING").action).toBe("UNCHANGED");
    const moved = one({ ...existing, businessUnit: "SAL", status: "inactive" }, "UPDATE_EXISTING");
    expect(moved.action).toBe("UPDATE");
    expect(moved.issues.map((i) => i.code).sort()).toEqual(["BU_CHANGE", "EMAIL_EXISTS", "STATUS_CHANGE"]);
    expect(moved.issues.find((i) => i.code === "BU_CHANGE")?.message).toMatch(/Engineering to Sales/);
  });
  it("summarises counts and only allows a commit when nothing is blocked", () => {
    const good = validateRows([row(), row({ email: "b@x.com" }), row(existing)], "UPDATE_EXISTING", ref).summary;
    expect(good).toMatchObject({ total: 3, create: 2, unchanged: 1, blocked: 0, canCommit: true });
    const bad = validateRows([row(), row({ email: "bad" })], "SKIP_EXISTING", ref).summary;
    expect(bad).toMatchObject({ blocked: 1, errors: 1, canCommit: false });
    expect(validateRows([], "SKIP_EXISTING", ref).summary.canCommit).toBe(false);
  });
  it("gives the same answer for the same input", () => {
    const rows = [row(), row({ email: "bad" }), row(existing)];
    expect(validateRows(rows, "UPDATE_EXISTING", ref)).toEqual(validateRows(rows, "UPDATE_EXISTING", ref));
  });
});

describe("error report", () => {
  it("lists errors and conflicts, skips notices, and neutralises formulas in the echoed values", () => {
    const { results } = validateRows([row({ email: "=evil@x.com" }), row(), { ...row({ email: "ada@x.com" }) }], "SKIP_EXISTING", ref);
    const csv = errorReportCsv(results);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Row,Email,Field,Class,Problem");
    expect(lines).toHaveLength(3);                                  // one error, one conflict
    expect(lines[1]).toContain("'=evil@x.com");                       // never starts with =
    expect(lines[2]).toContain("Conflict");
    expect(csv).not.toMatch(/(^|,)=/m);
  });
});

describe("Business Unit and Department", () => {
  it("suggests a Department column from its common spellings, and accepts a file with only a Department column", () => {
    const m = suggestMapping(["Email", "First name", "Last name", "Business Unit", "Dept", "Status"]);
    expect(m).toEqual({ email: 0, firstName: 1, lastName: 2, businessUnit: 3, department: 4, status: 5 });
    const onlyDept = suggestMapping(["Email", "First name", "Last name", "Department"]);
    expect(mappingProblems(onlyDept)).toEqual([]);
    expect(mappingProblems(suggestMapping(["Email", "First name", "Last name"]))).toEqual(["Choose the column that holds the Business Unit or the Department."]);
  });
  it("accepts a Department alone, by code or by name, and places the person there", () => {
    expect(codes({ businessUnit: "", department: "ENG-QA" })).toEqual([]);
    expect(codes({ businessUnit: "", department: "quality assurance" })).toEqual([]);
    expect(one({ businessUnit: "", department: "ENG-QA" }).action).toBe("CREATE");
  });
  it("accepts a Business Unit that is a Department's name, and a Department in the Business Unit column", () => {
    expect(codes({ businessUnit: "ENG-QA", department: "" })).toEqual([]);
  });
  it("accepts a Department under the Business Unit given with it", () => {
    expect(codes({ businessUnit: "ENG", department: "ENG-QA" })).toEqual([]);
  });
  it("refuses a Department that belongs under another Business Unit", () => {
    const r = one({ businessUnit: "SAL", department: "ENG-QA" });
    expect(r.issues.map((i) => i.code)).toEqual(["DEPARTMENT_NOT_UNDER_BU"]);
    expect(r.issues[0].message).toContain("belongs under Engineering");
    expect(r.action).toBe("BLOCKED");
  });
  it("warns, but accepts, a Department that is not placed under any unit", () => {
    const r = one({ businessUnit: "SAL", department: "OPS" });
    expect(r.issues.map((i) => i.code)).toEqual(["DEPARTMENT_NOT_PLACED"]);
    expect(r.action).toBe("CREATE");
  });
  it("asks for one of them, and says which column a wrong name is in", () => {
    expect(codes({ businessUnit: "", department: "" })).toEqual(["REQUIRED"]);
    const r = one({ businessUnit: "ENG", department: "Nowhere" });
    expect(r.issues.map((i) => [i.field, i.code])).toEqual([["department", "UNKNOWN_BU"]]);
    expect(r.issues[0].message).toBe("No active Department has this code or name.");
    expect(one({ businessUnit: "OLD" }).issues[0].message).toBe("This Business Unit is inactive, so no one can be added to it.");
  });
  it("tells an update that moves someone into a Department", () => {
    const r = one({ email: "ada@x.com", businessUnit: "ENG", department: "OPS" }, "UPDATE_EXISTING");
    expect(r.issues.map((i) => i.code)).toContain("BU_CHANGE");
    expect(r.issues.find((i) => i.code === "BU_CHANGE")?.message).toContain("Operations Desk");
  });
});

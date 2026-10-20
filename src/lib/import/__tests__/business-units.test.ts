import { describe, expect, it } from "vitest";
import { validateBusinessUnitRows, parseFlag, type BuReference } from "../business-units";
import { ENTITIES, applyMappingFor, mappingProblemsFor, suggestMappingFor } from "../entities";
import { errorReportCsv, type Policy } from "../employees";

const ref: BuReference = { businessUnits: [
  { code: "ENG", name: "Engineering", status: "ACTIVE", reportsWeekly: true },
  { code: "HQ", name: "Headquarters", status: "ACTIVE", reportsWeekly: false },
] };
const row = (o: Record<string, string> = {}) => ({ code: "OPS", name: "Operations", reportsWeekly: "", status: "", ...o });
const one = (o: Record<string, string>, policy: Policy = "SKIP_EXISTING") => validateBusinessUnitRows([row(o)], policy, ref).results[0];
const codes = (o: Record<string, string>, policy?: Policy) => one(o, policy).issues.map((i) => i.code);

describe("Business Unit rows", () => {
  it("accepts a clean new unit and defaults the reporting flag and status", () => {
    const r = one({});
    expect(r.action).toBe("CREATE");
    expect(r.issues).toEqual([]);
  });
  it("reads the weekly-reporting flag in plain words", () => {
    expect([parseFlag(""), parseFlag("Yes"), parseFlag("y"), parseFlag("TRUE"), parseFlag("1")]).toEqual([true, true, true, true, true]);
    expect([parseFlag("no"), parseFlag("N"), parseFlag("false"), parseFlag("0")]).toEqual([false, false, false, false]);
    expect(parseFlag("maybe")).toBeUndefined();
    expect(codes({ reportsWeekly: "maybe" })).toContain("INVALID_FLAG");
  });
  it("blocks bad codes, missing names, bad status and formula text", () => {
    expect(codes({ code: "" })).toContain("REQUIRED");
    for (const bad of ["A", "has space", "-lead", "x".repeat(21), "<b>"]) expect(codes({ code: bad }), bad).toContain("INVALID_CODE");
    expect(codes({ name: " " })).toContain("REQUIRED");
    expect(codes({ name: "=SUM(A1)" })).toContain("INVALID_TEXT");
    expect(codes({ name: "@cmd" })).toContain("INVALID_TEXT");
    expect(codes({ status: "paused" })).toContain("INVALID_STATUS");
  });
  it("treats codes as case-insensitive and says what will be stored", () => {
    const r = one({ code: "ops" });
    expect(r.action).toBe("CREATE");
    expect(r.issues.map((i) => i.code)).toEqual(["UPPERCASED"]);
    expect(validateBusinessUnitRows([row({ code: "ops" }), row({ code: "OPS" })], "SKIP_EXISTING", ref).results[1].issues[0].code).toBe("DUPLICATE_IN_FILE");
  });
  it("applies the three conflict policies to an existing code", () => {
    const same = { code: "eng", name: "Engineering", reportsWeekly: "yes", status: "active" };
    expect(one(same, "ABORT_ON_CONFLICT").action).toBe("BLOCKED");
    expect(one({ ...same, name: "Changed" }, "SKIP_EXISTING")).toMatchObject({ action: "SKIP" });
    expect(one(same, "UPDATE_EXISTING").action).toBe("UNCHANGED");
    const changed = one({ ...same, name: "Eng 2", status: "inactive", reportsWeekly: "no" }, "UPDATE_EXISTING");
    expect(changed.action).toBe("UPDATE");
    expect(changed.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["CODE_EXISTS", "STATUS_CHANGE", "REPORTING_CHANGE"]));
  });
  it("only allows a commit when no row is blocked", () => {
    expect(validateBusinessUnitRows([row(), row({ code: "FIN", name: "Finance" })], "SKIP_EXISTING", ref).summary).toMatchObject({ create: 2, canCommit: true });
    expect(validateBusinessUnitRows([row(), row({ code: "" })], "SKIP_EXISTING", ref).summary).toMatchObject({ blocked: 1, canCommit: false });
  });
});

describe("generic mapping and entity settings", () => {
  const specs = ENTITIES["business-units"].fields;
  it("matches business-unit headers, each column once", () => {
    expect(suggestMappingFor(specs, ["Unit Code", "Unit Name", "Type", "Files Weekly Reports", "Status"])).toEqual({ code: 0, name: 1, unitType: 2, reportsWeekly: 3, status: 4 });
    expect(mappingProblemsFor(specs, suggestMappingFor(specs, ["x", "y"])).length).toBe(2);
  });
  it("applies a mapping to rows", () => {
    const m = suggestMappingFor(specs, ["code", "name"]);
    expect(applyMappingFor(specs, [["OPS", "Operations"]], m)[0]).toEqual({ code: "OPS", name: "Operations", unitType: "", reportsWeekly: "", status: "" });
  });
  it("accepts Business Unit / Department and refuses anything else", () => {
    const ok = validateBusinessUnitRows([row({ code: "FIN", unitType: "Department" }), row({ code: "OPS", unitType: "BU" }), row({ code: "ZZZ", unitType: "" })], "SKIP_EXISTING", ref);
    expect(ok.summary.blocked).toBe(0);
    expect(validateBusinessUnitRows([row({ code: "BAD", unitType: "Division" })], "SKIP_EXISTING", ref).results[0].issues.some((i) => i.code === "INVALID_TYPE")).toBe(true);
  });
  it("labels the error report with the entity's own words", () => {
    const { results } = validateBusinessUnitRows([row({ code: "=BAD" })], "SKIP_EXISTING", ref);
    const csv = errorReportCsv(results, ENTITIES["business-units"].labels, "code");
    expect(csv).toContain("Row,Code,Field,Class,Problem");
    expect(csv).toContain("'=BAD");
  });
});

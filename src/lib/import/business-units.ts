import {
  FORMULA_START, IMPORT_LIMITS, type Action, type Issue, type Policy, type RowResult, type ValidationSummary,
} from "./employees";

/** Business Unit import rules (ADR-056). Same shape and guarantees as the employee import; the database function re-checks everything. */

export const BU_FIELDS = ["code", "name", "unitType", "reportsWeekly", "status"] as const;
export type BuField = (typeof BU_FIELDS)[number];
export const BU_LABEL: Record<string, string> = { code: "Code", name: "Name", unitType: "Type", reportsWeekly: "Files weekly reports", status: "Status" };
export const BU_REQUIRED: BuField[] = ["code", "name"];
export const BU_SYNONYMS: Record<BuField, string[]> = {
  code: ["code", "bucode", "businessunitcode", "unitcode", "shortcode"],
  name: ["name", "buname", "businessunitname", "unitname", "businessunit"],
  unitType: ["type", "unittype", "kind", "businessunitordepartment"],
  reportsWeekly: ["filesweeklyreports", "reportsweekly", "weeklyreports", "reporting", "filesreports"],
  status: ["status"],
};

export interface ReferenceBusinessUnit { code: string; name: string; status: string; reportsWeekly: boolean }
export interface BuReference { businessUnits: ReferenceBusinessUnit[] }

const CODE = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
const err = (field: string, code: string, message: string): Issue => ({ field, code, severity: "ERROR", message });

/** "Business Unit" / "BU" → BUSINESS_UNIT; "Department" → DEPARTMENT; empty → "" (chosen by the reporting flag); anything else → undefined. */
export function parseUnitType(v: string): "BUSINESS_UNIT" | "DEPARTMENT" | "" | undefined {
  const t = v.trim().toLowerCase();
  if (t === "" || t === "auto") return "";
  if (["bu", "business unit", "businessunit", "business_unit"].includes(t)) return "BUSINESS_UNIT";
  if (["department", "dept"].includes(t)) return "DEPARTMENT";
  return undefined;
}

/** "yes", "true", "1" → true; "no", "false", "0" → false; empty → true (units report weekly unless said otherwise); anything else → undefined. */
export function parseFlag(v: string): boolean | undefined {
  const t = v.trim().toLowerCase();
  if (t === "") return true;
  if (["yes", "y", "true", "1"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return undefined;
}

export function validateBusinessUnitRows(rows: Record<string, string>[], policy: Policy, ref: BuReference): { results: RowResult[]; summary: ValidationSummary } {
  const existing = new Map(ref.businessUnits.map((b) => [b.code.toUpperCase(), b]));
  const firstSeen = new Map<string, number>();
  const results: RowResult[] = rows.map((values, idx) => {
    const row = idx + 1;
    const issues: Issue[] = [];
    const code = (values.code ?? "").trim().toUpperCase();
    const name = (values.name ?? "").trim();
    const status = (values.status ?? "").trim().toUpperCase() || "ACTIVE";
    const flag = parseFlag(values.reportsWeekly ?? "");

    for (const f of BU_FIELDS) if ((values[f] ?? "").length > IMPORT_LIMITS.maxCellChars) issues.push(err(f, "TOO_LONG", `${BU_LABEL[f]} is longer than ${IMPORT_LIMITS.maxCellChars} characters.`));
    if (!code) issues.push(err("code", "REQUIRED", "Code is required."));
    else if (!CODE.test(code)) issues.push(err("code", "INVALID_CODE", "A code is 2 to 20 letters, digits, dashes or underscores, starting with a letter or digit."));
    else if (firstSeen.has(code)) issues.push(err("code", "DUPLICATE_IN_FILE", `This code already appears on row ${firstSeen.get(code)}.`));
    else firstSeen.set(code, row);
    if (!name) issues.push(err("name", "REQUIRED", "Name is required."));
    else if (name.length > 500) issues.push(err("name", "TOO_LONG", "Name is longer than 500 characters."));
    else if (FORMULA_START.test(name)) issues.push(err("name", "INVALID_TEXT", "Name starts with a formula character (= + - @). Remove it."));
    if (status !== "ACTIVE" && status !== "INACTIVE") issues.push(err("status", "INVALID_STATUS", "Status must be Active or Inactive (or left empty for Active)."));
    if (parseUnitType(values.unitType ?? "") === undefined) issues.push(err("unitType", "INVALID_TYPE", "Use Business Unit or Department (or leave empty)."));
    if (flag === undefined) issues.push(err("reportsWeekly", "INVALID_FLAG", "Use Yes or No (or leave empty for Yes)."));

    const have = code ? existing.get(code) : undefined;
    if (have && !issues.some((i) => i.field === "code" && i.severity === "ERROR")) {
      if (policy === "ABORT_ON_CONFLICT") issues.push(err("code", "CODE_EXISTS", "A Business Unit with this code already exists, and the chosen policy stops the import."));
      else issues.push({ field: "code", code: "CODE_EXISTS", severity: "CONFLICT", message: policy === "SKIP_EXISTING" ? "This unit already exists and will be left as it is." : "This unit already exists and will be updated." });
    }
    if (have && policy === "UPDATE_EXISTING" && (status === "ACTIVE" || status === "INACTIVE") && have.status !== status) {
      issues.push({ field: "status", code: "STATUS_CHANGE", severity: "WARNING", message: status === "INACTIVE" ? "Marks this unit inactive. People already in it stay assigned." : "Reactivates this unit." });
    }
    if (have && policy === "UPDATE_EXISTING" && flag !== undefined && have.reportsWeekly !== flag) {
      issues.push({ field: "reportsWeekly", code: "REPORTING_CHANGE", severity: "WARNING", message: flag ? "The unit will be expected to file weekly reports." : "The unit will no longer be expected to file weekly reports." });
    }
    if ((values.code ?? "") !== (values.code ?? "").trim() || (values.name ?? "") !== name) issues.push({ field: "row", code: "TRIMMED", severity: "WARNING", message: "Leading or trailing spaces will be removed." });
    if (values.code && values.code.trim() !== code && CODE.test(code)) issues.push({ field: "code", code: "UPPERCASED", severity: "WARNING", message: `The code will be stored as ${code}.` });

    const blocked = issues.some((i) => i.severity === "ERROR");
    let action: Action, explanation: string;
    if (blocked) { action = "BLOCKED"; explanation = "Cannot be imported until the errors are fixed."; }
    else if (!have) { action = "CREATE"; explanation = "A new Business Unit will be added."; }
    else if (policy === "SKIP_EXISTING") { action = "SKIP"; explanation = "Already exists; skipped."; }
    else {
      const same = have.name === name && have.status === status && have.reportsWeekly === flag;
      action = same ? "UNCHANGED" : "UPDATE";
      explanation = same ? "Already exists with the same details; nothing to change." : "The existing unit will be updated.";
    }
    return { row, values, issues, action, explanation };
  });
  const count = (a: Action) => results.filter((r) => r.action === a).length;
  const all = results.flatMap((r) => r.issues);
  return {
    results,
    summary: {
      total: results.length, create: count("CREATE"), update: count("UPDATE"), unchanged: count("UNCHANGED"), skip: count("SKIP"), blocked: count("BLOCKED"),
      errors: all.filter((i) => i.severity === "ERROR").length, conflicts: all.filter((i) => i.severity === "CONFLICT").length, warnings: all.filter((i) => i.severity === "WARNING").length,
      canCommit: results.length > 0 && results.length <= IMPORT_LIMITS.maxRows && count("BLOCKED") === 0,
    },
  };
}

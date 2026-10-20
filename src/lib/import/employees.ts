/**
 * Employee bulk import: the pure rules (ADR-056). Nothing here touches the network or the database, so the same code runs in the
 * browser for instant feedback and on the server as the first authoritative check. The database function `commit_employee_import`
 * re-checks everything again at commit time; the browser is never trusted.
 */

export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 2000, maxColumns: 30, maxCellChars: 1000 } as const;

export const FIELDS = ["email", "firstName", "lastName", "businessUnit", "status"] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = { email: "Email", firstName: "First name", lastName: "Last name", businessUnit: "Business Unit", status: "Status" };
export const REQUIRED_FIELDS: Field[] = ["email", "firstName", "lastName", "businessUnit"];

export type ImportRow = Record<Field, string>;
export type Policy = "ABORT_ON_CONFLICT" | "SKIP_EXISTING" | "UPDATE_EXISTING";
export const POLICY_LABEL: Record<Policy, { title: string; text: string }> = {
  ABORT_ON_CONFLICT: { title: "Stop if any email already exists", text: "Nothing is imported unless every row is a new employee." },
  SKIP_EXISTING: { title: "Skip people who already exist", text: "New people are added. Existing employees are left exactly as they are." },
  UPDATE_EXISTING: { title: "Update people who already exist", text: "New people are added. Existing employees get the name, Business Unit and status in the file." },
};

export type Severity = "ERROR" | "CONFLICT" | "WARNING";
export interface Issue { field: string; code: string; severity: Severity; message: string }
export type Action = "CREATE" | "UPDATE" | "UNCHANGED" | "SKIP" | "BLOCKED";
export interface RowResult { row: number; values: Record<string, string>; issues: Issue[]; action: Action; explanation: string }
export interface ValidationSummary { total: number; create: number; update: number; unchanged: number; skip: number; blocked: number; errors: number; conflicts: number; warnings: number; canCommit: boolean }

export interface ReferenceBu { id: string; code: string; name: string; status: string }
export interface ReferenceEmployee { email: string; firstName: string; lastName: string; businessUnitId: string; status: string }
export interface Reference { businessUnits: ReferenceBu[]; employees: ReferenceEmployee[] }

// Same rule as the database and the report exports: text that begins with one of these can be run as a formula by a spreadsheet.
export const FORMULA_START = /^[=+\-@\t\r]/;
const EMAIL = /^[^@\s,;<>"()]+@[^@\s,;<>"()]+\.[^@\s,;<>"()]+$/;

// ---------------------------------------------------------------- reading a file
/** RFC 4180 CSV: quoted fields, doubled quotes, embedded line breaks, a byte-order mark, and a comma, semicolon or tab separator. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0].c;
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type FileKind = "csv" | "xlsx";
/** Decides what a file is from its name AND its first bytes. A renamed or disguised file is refused, not guessed at. */
export function sniffFile(fileName: string, bytes: Uint8Array, maxBytes: number = IMPORT_LIMITS.maxBytes): { kind: FileKind } | { error: string } {
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > maxBytes) return { error: `The file is larger than ${maxBytes / 1024 / 1024} MB.` };
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;   // "PK": xlsx is a zip container
  if (ext === "xlsx") return zip ? { kind: "xlsx" } : { error: "This does not look like a real .xlsx workbook." };
  if (ext === "csv") {
    if (zip || bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) return { error: "This does not look like a text CSV file." };
    return { kind: "csv" };
  }
  return { error: "Only .csv and .xlsx files can be imported." };
}

// ---------------------------------------------------------------- column mapping
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const SYNONYMS: Record<Field, string[]> = {
  email: ["email", "emailaddress", "workemail", "mail"],
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  businessUnit: ["businessunit", "bu", "bucode", "unit", "businessunitcode"],
  status: ["status", "employmentstatus"],
};
export type Mapping = Record<Field, number | null>;

/** Suggests which column holds which field, by header name only. The person confirms or changes it. Each column is used at most once. */
export function suggestMapping(headers: string[]): Mapping {
  const m: Mapping = { email: null, firstName: null, lastName: null, businessUnit: null, status: null };
  const used = new Set<number>();
  for (const f of FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && SYNONYMS[f].includes(norm(h)));
    if (i >= 0) { m[f] = i; used.add(i); }
  }
  return m;
}

export function mappingProblems(m: Mapping): string[] {
  const out: string[] = [];
  for (const f of REQUIRED_FIELDS) if (m[f] === null) out.push(`Choose the column that holds ${FIELD_LABEL[f].toLowerCase()}.`);
  const cols = FIELDS.map((f) => m[f]).filter((v): v is number => v !== null);
  if (new Set(cols).size !== cols.length) out.push("Each column can be used for only one field.");
  return out;
}

export function applyMapping(rows: string[][], m: Mapping): ImportRow[] {
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? ""));
  return rows.map((r) => ({
    email: cell(r, m.email), firstName: cell(r, m.firstName), lastName: cell(r, m.lastName), businessUnit: cell(r, m.businessUnit), status: cell(r, m.status),
  }));
}

// ---------------------------------------------------------------- validating rows
const err = (field: string, code: string, message: string): Issue => ({ field, code, severity: "ERROR", message });

function resolveBu(text: string, bus: ReferenceBu[]): { bu?: ReferenceBu; issue?: Issue } {
  const t = text.trim();
  if (!t) return { issue: err("businessUnit", "REQUIRED", "Business Unit is required.") };
  const hits = bus.filter((b) => b.status === "ACTIVE" && (b.code.toUpperCase() === t.toUpperCase() || b.name.toLowerCase() === t.toLowerCase()));
  if (hits.length === 1) return { bu: hits[0] };
  if (hits.length > 1) return { issue: err("businessUnit", "AMBIGUOUS_BU", "More than one Business Unit matches. Use its code.") };
  const inactive = bus.some((b) => b.status !== "ACTIVE" && (b.code.toUpperCase() === t.toUpperCase() || b.name.toLowerCase() === t.toLowerCase()));
  return { issue: err("businessUnit", "UNKNOWN_BU", inactive ? "This Business Unit is inactive, so no one can be added to it." : "No active Business Unit has this code or name.") };
}

/**
 * Classifies every row: ERROR blocks the import, CONFLICT means the person already exists (or repeats in the file), WARNING is a
 * change worth noticing. Each row says what will happen to it under the chosen policy and why.
 */
export function validateRows(rows: ImportRow[], policy: Policy, ref: Reference): { results: RowResult[]; summary: ValidationSummary } {
  const existing = new Map(ref.employees.map((e) => [e.email.toLowerCase(), e]));
  const firstSeen = new Map<string, number>();
  const results: RowResult[] = rows.map((values, idx) => {
    const row = idx + 1;
    const issues: Issue[] = [];
    const email = values.email.trim().toLowerCase();
    const first = values.firstName.trim(), last = values.lastName.trim();
    const statusText = values.status.trim().toUpperCase() || "ACTIVE";

    for (const f of FIELDS) if (values[f].length > IMPORT_LIMITS.maxCellChars) issues.push(err(f, "TOO_LONG", `${FIELD_LABEL[f]} is longer than ${IMPORT_LIMITS.maxCellChars} characters.`));
    if (!email) issues.push(err("email", "REQUIRED", "Email is required."));
    else if (email.length > 200 || !EMAIL.test(email) || FORMULA_START.test(email)) issues.push(err("email", "INVALID_EMAIL", "This is not a valid email address."));
    else if (firstSeen.has(email)) issues.push(err("email", "DUPLICATE_IN_FILE", `This email already appears on row ${firstSeen.get(email)}.`));
    else firstSeen.set(email, row);

    for (const [f, v] of [["firstName", first], ["lastName", last]] as const) {
      if (!v) issues.push(err(f, "REQUIRED", `${FIELD_LABEL[f]} is required.`));
      else if (v.length > 500) issues.push(err(f, "TOO_LONG", `${FIELD_LABEL[f]} is longer than 500 characters.`));
      else if (FORMULA_START.test(v)) issues.push(err(f, "INVALID_TEXT", `${FIELD_LABEL[f]} starts with a formula character (= + - @). Remove it.`));
    }
    if (statusText !== "ACTIVE" && statusText !== "INACTIVE") issues.push(err("status", "INVALID_STATUS", "Status must be Active or Inactive (or left empty for Active)."));

    const { bu, issue } = resolveBu(values.businessUnit, ref.businessUnits);
    if (issue) issues.push(issue);

    const have = email ? existing.get(email) : undefined;
    if (have && !issues.some((i) => i.field === "email" && i.severity === "ERROR")) {
      if (policy === "ABORT_ON_CONFLICT") issues.push(err("email", "EMAIL_EXISTS", "An employee with this email already exists, and the chosen policy stops the import."));
      else issues.push({ field: "email", code: "EMAIL_EXISTS", severity: "CONFLICT", message: policy === "SKIP_EXISTING" ? "This person already exists and will be left as they are." : "This person already exists and will be updated." });
    }
    if (have && policy === "UPDATE_EXISTING" && bu && have.businessUnitId !== bu.id) {
      const from = ref.businessUnits.find((b) => b.id === have.businessUnitId);
      issues.push({ field: "businessUnit", code: "BU_CHANGE", severity: "WARNING", message: `Moves this person from ${from?.name ?? "another unit"} to ${bu.name}.` });
    }
    if (have && policy === "UPDATE_EXISTING" && (statusText === "ACTIVE" || statusText === "INACTIVE") && have.status !== statusText) {
      issues.push({ field: "status", code: "STATUS_CHANGE", severity: "WARNING", message: statusText === "INACTIVE" ? "Marks this person inactive." : "Reactivates this person." });
    }
    if (values.email !== values.email.trim() || values.firstName !== first || values.lastName !== last) {
      issues.push({ field: "row", code: "TRIMMED", severity: "WARNING", message: "Leading or trailing spaces will be removed." });
    }

    const blocked = issues.some((i) => i.severity === "ERROR");
    let action: Action, explanation: string;
    if (blocked) { action = "BLOCKED"; explanation = "Cannot be imported until the errors are fixed."; }
    else if (!have) { action = "CREATE"; explanation = "A new employee will be added."; }
    else if (policy === "SKIP_EXISTING") { action = "SKIP"; explanation = "Already exists; skipped."; }
    else {
      const same = have.firstName === first && have.lastName === last && have.businessUnitId === bu?.id && have.status === statusText;
      action = same ? "UNCHANGED" : "UPDATE";
      explanation = same ? "Already exists with the same details; nothing to change." : "The existing employee will be updated.";
    }
    return { row, values, issues, action, explanation };
  });

  const count = (a: Action) => results.filter((r) => r.action === a).length;
  const all = results.flatMap((r) => r.issues);
  const summary: ValidationSummary = {
    total: results.length, create: count("CREATE"), update: count("UPDATE"), unchanged: count("UNCHANGED"), skip: count("SKIP"), blocked: count("BLOCKED"),
    errors: all.filter((i) => i.severity === "ERROR").length, conflicts: all.filter((i) => i.severity === "CONFLICT").length, warnings: all.filter((i) => i.severity === "WARNING").length,
    canCommit: results.length > 0 && results.length <= IMPORT_LIMITS.maxRows && count("BLOCKED") === 0,
  };
  return { results, summary };
}

/** The error report offered for download: one line per problem, formula-safe. */
export function errorReportCsv(results: RowResult[], labels: Record<string, string> = FIELD_LABEL, idField = "email"): string {
  const esc = (v: string) => {
    const safe = FORMULA_START.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const lines = [["Row", labels[idField] ?? "Item", "Field", "Class", "Problem"].join(",")];
  for (const r of results) for (const i of r.issues) {
    if (i.severity === "WARNING") continue;
    lines.push([String(r.row), r.values[idField] ?? "", i.field === "row" ? "" : (labels[i.field] ?? i.field), i.severity === "ERROR" ? "Error" : "Conflict", i.message].map(esc).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

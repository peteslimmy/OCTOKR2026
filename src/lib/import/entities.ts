import { BU_FIELDS, BU_LABEL, BU_REQUIRED, BU_SYNONYMS } from "./business-units";
import { FIELD_LABEL, FIELDS, POLICY_LABEL, REQUIRED_FIELDS, type Policy } from "./employees";

/**
 * What differs between imports, in one place the wizard reads from. Everything else (reading files, the five steps, row classes,
 * policies, idempotent commit, history) is shared. Adding an entity means: its rules module, its commit function, an entry here and
 * an entry in the server registry.
 */
export type EntityId = "employees" | "business-units";
export const ENTITY_IDS: EntityId[] = ["employees", "business-units"];
export const isEntityId = (v: string): v is EntityId => (ENTITY_IDS as string[]).includes(v);

export interface FieldSpec { key: string; label: string; required: boolean; synonyms: string[] }
export type Mapping = Record<string, number | null>;

export interface EntityUi {
  id: EntityId;
  title: string;
  /** "person" / "people": used in "Import 4 people". */
  noun: { one: string; many: string };
  intro: string;
  fields: FieldSpec[];
  labels: Record<string, string>;
  idField: string;
  policies: Record<Policy, { title: string; text: string }>;
  template: string;
  columnsHint: string;
  confirmNote: string;
  describe: (v: Record<string, string>) => { title: string; subtitle: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function suggestMappingFor(specs: FieldSpec[], headers: string[]): Mapping {
  const m: Mapping = Object.fromEntries(specs.map((f) => [f.key, null]));
  const used = new Set<number>();
  for (const f of specs) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && f.synonyms.includes(norm(h)));
    if (i >= 0) { m[f.key] = i; used.add(i); }
  }
  return m;
}

export function mappingProblemsFor(specs: FieldSpec[], m: Mapping): string[] {
  const out: string[] = [];
  for (const f of specs) if (f.required && m[f.key] === null) out.push(`Choose the column that holds ${f.label.toLowerCase()}.`);
  const cols = specs.map((f) => m[f.key]).filter((v): v is number => v !== null && v !== undefined);
  if (new Set(cols).size !== cols.length) out.push("Each column can be used for only one field.");
  return out;
}

export function applyMappingFor(specs: FieldSpec[], rows: string[][], m: Mapping): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(specs.map((f) => [f.key, m[f.key] === null || m[f.key] === undefined ? "" : (r[m[f.key] as number] ?? "")])));
}

const EMPLOYEE_SYNONYMS: Record<string, string[]> = {
  email: ["email", "emailaddress", "workemail", "mail"],
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  businessUnit: ["businessunit", "bu", "bucode", "unit", "businessunitcode"],
  department: ["department", "dept", "departmentcode", "departmentname"],
  status: ["status", "employmentstatus"],
};

export const ENTITIES: Record<EntityId, EntityUi> = {
  employees: {
    id: "employees", title: "Import employees", noun: { one: "person", many: "people" },
    intro: "Add or update many employee records from a spreadsheet. You see exactly what will happen before anything is saved.",
    fields: FIELDS.map((k) => ({ key: k, label: FIELD_LABEL[k], required: REQUIRED_FIELDS.includes(k), synonyms: EMPLOYEE_SYNONYMS[k] })),
    labels: FIELD_LABEL, idField: "email", policies: POLICY_LABEL,
    template: "email,first_name,last_name,business_unit,department,status\r\nada@example.com,Ada,Lovelace,ENG,,Active\r\nbayo@example.com,Bayo,Adeyemi,ENG,ENG-QA,Active\r\n",
    columnsHint: "Columns: email, first name, last name, Business Unit (its code or name), Department (its code or name), status (Active or Inactive; empty means Active). Fill the Business Unit, the Department, or both: a person is placed in the Department when one is given, otherwise in the Business Unit.",
    confirmNote: "This changes employee records only. Login accounts, roles and reports are not touched. The import is recorded in the audit log, and you may be asked for a fresh authenticator code.",
    describe: (v) => ({ title: v.email || "(no email)", subtitle: [[v.firstName, v.lastName].filter(Boolean).join(" ") || "(no name)", v.businessUnit, v.department].filter(Boolean).join(" · ") }),
  },
  "business-units": {
    id: "business-units", title: "Import Business Units", noun: { one: "unit", many: "units" },
    intro: "Add or update many Business Units from a spreadsheet. You see exactly what will happen before anything is saved.",
    fields: BU_FIELDS.map((k) => ({ key: k, label: BU_LABEL[k], required: BU_REQUIRED.includes(k), synonyms: BU_SYNONYMS[k] })),
    labels: BU_LABEL, idField: "code",
    policies: {
      ABORT_ON_CONFLICT: { title: "Stop if any code already exists", text: "Nothing is imported unless every row is a new unit." },
      SKIP_EXISTING: { title: "Skip units that already exist", text: "New units are added. Existing units are left exactly as they are." },
      UPDATE_EXISTING: { title: "Update units that already exist", text: "New units are added. Existing units get the name, reporting setting and status in the file." },
    },
    template: "code,name,files_weekly_reports,status\r\nOPS,Operations,Yes,Active\r\n",
    columnsHint: "Columns: code (2 to 20 letters or digits), name, type (Business Unit or Department; empty means by the reporting flag; applied when a unit is created), files weekly reports (Yes or No; empty means Yes), status (Active or Inactive; empty means Active).",
    confirmNote: "This changes Business Units only. Employees, reports and scores are not touched; making a unit inactive does not move its people. The import is recorded in the audit log, and you may be asked for a fresh authenticator code.",
    describe: (v) => ({ title: v.code || "(no code)", subtitle: v.name || "(no name)" }),
  },
};

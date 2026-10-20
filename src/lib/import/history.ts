/**
 * Reads the historical weekly-report sheet (ADR-077): one row per goal, with up to ten tasks and their statuses laid out across the row.
 *
 *   Year | Week | BU/Depart | SubKR | Goal | Task 1 | Status 1 | Task 2 | Status 2 | ...
 *
 * Pure functions, no I/O: the file has already been read as data. Blank Year, Week or BU cells repeat the cell above (people merge or skip them).
 * Everything the database can only know (the unit exists, the week is closed, a report is not there already) is checked there, not here.
 */
export const HISTORY_LIMITS = { maxBytes: 10 * 1024 * 1024, maxRows: 20000, maxColumns: 40 } as const;

export interface HistoryRow { row_no: number; year: number; week: number; bu_id: string; sub_kr: string | null; goal: string; tasks: { d: string; s: "DONE" | "NOT_DONE" }[] }
export interface HistoryProblem { row: number; message: string }
export interface UnitRef { id: string; code: string; name: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const YEAR = ["year"], WEEK = ["week", "weekno", "weeknumber", "wk"];
const UNIT = ["budepart", "budepartment", "businessunit", "bu", "department", "depart", "unit", "bucode", "businessunitcode"];
const GOAL = ["goal", "smartgoal", "goals"];

export interface HistoryLayout { year: number; week: number; unit: number; subKr: number | null; goal: number; tasks: { task: number; status: number }[] }

export function detectLayout(headers: string[]): { layout: HistoryLayout } | { error: string } {
  const h = headers.map(norm);
  const find = (names: string[]) => h.findIndex((x) => names.includes(x));
  const year = find(YEAR), week = find(WEEK), unit = find(UNIT), goal = find(GOAL);
  const subKr = h.findIndex((x) => x.startsWith("subkr") || x === "kr" || x === "sk");
  const missing = [year < 0 && "Year", week < 0 && "Week", unit < 0 && "BU/Depart", goal < 0 && "Goal"].filter(Boolean);
  if (missing.length) return { error: `The sheet needs a ${missing.join(", ")} column. The first row must hold the column names.` };
  const tasks: { task: number; status: number }[] = [];
  for (let n = 1; n <= 10; n++) {
    const t = h.findIndex((x) => x === `task${n}`), s = h.findIndex((x) => x === `status${n}`);
    if (t >= 0 && s >= 0) tasks.push({ task: t, status: s });
    else if (t >= 0 || s >= 0) return { error: `Task ${n} and Status ${n} must both be columns.` };
  }
  if (!tasks.length) return { error: "The sheet needs at least Task 1 and Status 1 columns." };
  return { layout: { year, week, unit, subKr: subKr >= 0 ? subKr : null, goal, tasks } };
}

export function parseStatus(v: string): "DONE" | "NOT_DONE" | null {
  const x = norm(v);
  if (["done", "completed", "complete", "yes"].includes(x)) return "DONE";
  if (["notdone", "notcompleted", "incomplete", "notyet", "no", "undone"].includes(x)) return "NOT_DONE";
  return null;
}

/** "1.1", "KR1.1", "SubKR 2.3" -> "1.1"; empty, "-", "stretch", "none" -> null (a stretch goal). Anything else is left alone for the database to refuse. */
export function normaliseSubKr(v: string): string | null {
  const t = v.trim();
  if (!t || /^(-|n\/?a|none|stretch|nil)$/i.test(t)) return null;
  const m = t.match(/(\d+)\s*[.\-]\s*(\d+)/);
  return m ? `${Number(m[1])}.${Number(m[2])}` : t;
}

export function matchUnit(value: string, units: UnitRef[]): UnitRef | null {
  const n = norm(value);
  if (!n) return null;
  return units.find((u) => norm(u.code) === n) ?? units.find((u) => norm(u.name) === n) ?? null;
}

export function parseHistoryRows(headers: string[], rows: string[][], units: UnitRef[]): { rows: HistoryRow[]; problems: HistoryProblem[]; unknownUnits: string[] } | { error: string } {
  const d = detectLayout(headers);
  if ("error" in d) return d;
  const L = d.layout;
  const out: HistoryRow[] = [], problems: HistoryProblem[] = [], unknown = new Set<string>();
  let year = "", week = "", unit = "";
  rows.forEach((r, i) => {
    const row = i + 2;                                                      // the spreadsheet row number
    const cell = (c: number) => (r[c] ?? "").trim();
    if (r.every((x) => !x || !x.trim())) return;
    if (cell(L.year)) year = cell(L.year);
    if (cell(L.week)) week = cell(L.week);
    if (cell(L.unit)) unit = cell(L.unit);
    const y = Number(year.replace(/\.0+$/, "")), w = Number(week.replace(/^w(eek)?\s*/i, "").replace(/\.0+$/, ""));
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return void problems.push({ row, message: `Year "${year}" is not a year.` });
    if (!Number.isInteger(w) || w < 1 || w > 53) return void problems.push({ row, message: `Week "${week}" must be a number from 1 to 53.` });
    const u = matchUnit(unit, units);
    if (!u) { unknown.add(unit || "(blank)"); return void problems.push({ row, message: `"${unit || "(blank)"}" is not a Business Unit in the application. Use its code or its name.` }); }
    const goal = cell(L.goal);
    if (!goal) return void problems.push({ row, message: "The goal is empty." });
    if (goal.startsWith("=")) return void problems.push({ row, message: "The goal starts with \"=\" (a formula). Formulas are not accepted." });
    const tasks: HistoryRow["tasks"] = [];
    for (const [n, t] of L.tasks.entries()) {
      const desc = cell(t.task), st = cell(t.status);
      if (!desc && !st) continue;
      if (desc.startsWith("=")) return void problems.push({ row, message: `Task ${n + 1} starts with "=" (a formula). Formulas are not accepted.` });
      if (!desc) return void problems.push({ row, message: `Status ${n + 1} has a value but Task ${n + 1} is empty.` });
      const s = parseStatus(st);
      if (!s) return void problems.push({ row, message: `Status ${n + 1} must be Done or Not Done (found "${st}").` });
      tasks.push({ d: desc, s });
    }
    if (!tasks.length) return void problems.push({ row, message: "The goal has no task." });
    out.push({ row_no: row, year: y, week: w, bu_id: u.id, sub_kr: L.subKr === null ? null : normaliseSubKr(cell(L.subKr)), goal, tasks });
  });
  if (!out.length && !problems.length) return { error: "The sheet has no data rows." };
  return { rows: out, problems, unknownUnits: [...unknown] };
}

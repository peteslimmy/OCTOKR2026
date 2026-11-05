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
/** One thing wrong in the sheet. `message` is the short statement; the rest says exactly where, what was found and what to do about it. */
export interface HistoryProblem { row: number; message: string; code?: string; column?: string; cell?: string; found?: string; fix?: string }
export interface UnitRef { id: string; code: string; name: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const YEAR = ["year"], WEEK = ["week", "weekno", "weeknumber", "wk"];
const UNIT = ["budepart", "budepartment", "businessunit", "bu", "department", "depart", "unit", "bucode", "businessunitcode"];
const GOAL = ["goal", "smartgoal", "goals", "goaltitle", "goalname", "goaldescription", "smartgoaltitle", "title"];

export interface HistoryLayout { year: number; week: number; unit: number; subKr: number | null; goal: number; tasks: { task: number; status: number }[] }

export function detectLayout(headers: string[]): { layout: HistoryLayout } | { error: string } {
  const h = headers.map(norm);
  const find = (names: string[]) => h.findIndex((x) => names.includes(x));
  const year = find(YEAR), week = find(WEEK), unit = find(UNIT), goal = find(GOAL);
  const subKr = h.findIndex((x) => x.startsWith("subkr") || x === "kr" || x === "sk");
  const missing = [year < 0 && "Year", week < 0 && "Week", unit < 0 && "BU/Depart", goal < 0 && "Goal"].filter(Boolean);
  if (missing.length) return { error: `The sheet needs a ${missing.join(", ")} column${missing.includes("Goal") ? " (named Goal, Goal Title or Goal Name)" : ""}. The first row must hold the column names. The columns found in row 1 are: ${headers.filter((x) => x.trim()).map((x) => `"${x.trim()}"`).join(", ") || "(none, the first row is empty)"}. Expected: Year, Week, BU/Depart, SubKR, Goal, Task 1, Status 1, Task 2, Status 2… Check that the column names are in the first row of the first worksheet, then download the template to compare.` };
  const tasks: { task: number; status: number }[] = [];
  for (let n = 1; n <= 10; n++) {
    const t = h.findIndex((x) => x === `task${n}`), s = h.findIndex((x) => x === `status${n}`);
    if (t >= 0 && s >= 0) tasks.push({ task: t, status: s });
    else if (t >= 0 || s >= 0) return { error: `Task ${n} and Status ${n} must both be columns, but only ${t >= 0 ? "Task " + n : "Status " + n} was found. Add the missing column next to it, named exactly ${t >= 0 ? "Status " + n : "Task " + n}.` };
  }
  if (!tasks.length) return { error: "The sheet needs at least Task 1 and Status 1 columns (named exactly like that, with the space optional). Add them to the first row, then upload again." };
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

/** A1-style column letters for a zero-based column index (0 -> A, 26 -> AA). */
export const columnLetter = (i: number): string => { let n = i, s = ""; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

/** ISO week numbering: a year has 53 weeks when 1 January is a Thursday, or it is a leap year and 1 January is a Wednesday. */
export function isoWeeksInYear(y: number): number {
  const dow = new Date(Date.UTC(y, 0, 1)).getUTCDay();
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return dow === 4 || (leap && dow === 3) ? 53 : 52;
}

const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/** The unit whose code or name is closest to what was typed (a typo), or null when nothing is close. */
export function closestUnit(value: string, units: UnitRef[]): UnitRef | null {
  const n = norm(value);
  if (!n) return null;
  let best: { u: UnitRef; d: number } | null = null;
  for (const u of units) for (const cand of [norm(u.code), norm(u.name)]) {
    const d = lev(n, cand);
    if (!best || d < best.d) best = { u, d };
  }
  return best && best.d <= Math.max(2, Math.floor(n.length / 3)) ? best.u : null;
}

export function parseHistoryRows(headers: string[], rows: string[][], units: UnitRef[]): { rows: HistoryRow[]; problems: HistoryProblem[]; unknownUnits: string[] } | { error: string } {
  const d = detectLayout(headers);
  if ("error" in d) return d;
  const L = d.layout;
  const out: HistoryRow[] = [], problems: HistoryProblem[] = [], unknown = new Set<string>();
  const col = (c: number) => (headers[c] || columnLetter(c)).trim() || columnLetter(c);
  let year = "", week = "", unit = "";
  rows.forEach((r, i) => {
    const row = i + 2;                                                      // the spreadsheet row number
    const cell = (c: number) => (r[c] ?? "").trim();
    if (r.every((x) => !x || !x.trim())) return;
    if (cell(L.year)) year = cell(L.year);
    if (cell(L.week)) week = cell(L.week);
    if (cell(L.unit)) unit = cell(L.unit);
    // every problem of the row is collected, so one pass through the sheet shows everything that needs fixing
    const here: HistoryProblem[] = [];
    const bad = (code: string, c: number, found: string, message: string, fix: string) => here.push({ row, message, code, column: col(c), cell: `${columnLetter(c)}${row}`, found, fix });
    const y = Number(year.replace(/\.0+$/, "")), w = Number(week.replace(/^w(eek)?\s*/i, "").replace(/\.0+$/, ""));
    const yearOk = Number.isInteger(y) && y >= 2000 && y <= 2100;
    if (!yearOk) bad("YEAR_INVALID", L.year, year, `Year "${year}" is not a year.`, `Type a four-digit year such as 2025 in the "${col(L.year)}" column. A blank cell repeats the year of the row above, so the first row of the sheet must have one.`);
    const weekOk = Number.isInteger(w) && w >= 1 && w <= 53;
    if (!weekOk) bad("WEEK_INVALID", L.week, week, `Week "${week}" must be a number from 1 to 53.`, `Type the reporting week number (1 to 53), for example 14 or Week 14, in the "${col(L.week)}" column. Dates such as 2025-04-07 are not accepted here.`);
    else if (yearOk && w > isoWeeksInYear(y)) bad("WEEK_NOT_IN_YEAR", L.week, week, `Week ${w} does not exist in ${y}: that year has only ${isoWeeksInYear(y)} weeks.`, `Use week ${isoWeeksInYear(y)} or lower for ${y}. Week 53 exists only in some years (for example 2020 and 2026).`);
    const u = matchUnit(unit, units);
    if (!u) {
      unknown.add(unit || "(blank)");
      const near = closestUnit(unit, units);
      bad("UNIT_UNKNOWN", L.unit, unit, `"${unit || "(blank)"}" is not a Business Unit in the application. Use its code or its name.`,
        unit ? `${near ? `Did you mean "${near.code}" (${near.name})? ` : ""}Type the unit exactly as its code or its name appears under Business Units${units.length ? `, for example ${units.slice(0, 5).map((x) => x.code).join(", ")}` : ""}. If the unit really is missing, add it under Business Units first.`
          : `The "${col(L.unit)}" cell is empty and there is no cell above to repeat. Type the unit's code or name.`);
    }
    const goal = cell(L.goal);
    if (!goal) bad("GOAL_EMPTY", L.goal, "", "The goal is empty.", `Each row is one goal. Type its title in the "${col(L.goal)}" column, or delete the row if it is only a spare line.`);
    else if (goal.startsWith("=")) bad("FORMULA", L.goal, goal, "The goal starts with \"=\" (a formula). Formulas are not accepted.", "Select the column, copy it, and paste it back as values only (Paste special, then Values). Save the file and upload it again.");
    const tasks: HistoryRow["tasks"] = [];
    const before = here.length;                                              // problems found before the task cells: only task-cell problems excuse "no task"
    for (const [n, t] of L.tasks.entries()) {
      const desc = cell(t.task), st = cell(t.status);
      if (!desc && !st) continue;
      if (desc.startsWith("=")) { bad("FORMULA", t.task, desc, `Task ${n + 1} starts with "=" (a formula). Formulas are not accepted.`, "Copy the cell and paste it back as values only (Paste special, then Values), then save and upload again."); continue; }
      if (!desc) { bad("TASK_MISSING", t.task, "", `Status ${n + 1} has a value but Task ${n + 1} is empty.`, `Type the task in "${col(t.task)}", or clear "${col(t.status)}" if there is no Task ${n + 1}.`); continue; }
      const sv = parseStatus(st);
      if (!sv) { bad("STATUS_INVALID", t.status, st, `Status ${n + 1} must be Done or Not Done (found "${st}").`, `Write exactly Done or Not Done in "${col(t.status)}". Also accepted: Completed, Complete, Yes (Done) and Incomplete, Not Completed, No (Not Done). ${st ? "" : "The cell is empty."}`.trim()); continue; }
      tasks.push({ d: desc, s: sv });
    }
    if (!tasks.length && here.length === before) bad("NO_TASK", L.tasks[0].task, "", "The goal has no task.", `Put at least one task in "${col(L.tasks[0].task)}" with its status in "${col(L.tasks[0].status)}".`);
    if (here.length) { problems.push(...here); return; }
    out.push({ row_no: row, year: y, week: w, bu_id: (u as UnitRef).id, sub_kr: L.subKr === null ? null : normaliseSubKr(cell(L.subKr)), goal, tasks });
  });
  if (!out.length && !problems.length) return { error: "The sheet has no data rows." };
  return { rows: out, problems, unknownUnits: [...unknown] };
}

import type { HistoryProblem, HistoryRow, UnitRef } from "./history";

/**
 * Turns what the database (and the file reader) say into something a person can act on: exactly where, what was found, why it is refused, and what to do.
 * Pure functions: no I/O. The database keeps its short messages (tests rely on them); this adds the explanation.
 */
export interface ExplainedProblem extends HistoryProblem { context?: string }
export interface ProblemGroup { code: string; title: string; count: number; rows: number[]; fix: string }

const RULES: { re: RegExp; code: string; title: string; fix: string }[] = [
  { re: /no longer exists/i, code: "UNIT_GONE", title: "Business Unit no longer exists", fix: "The unit was removed after the file was read. Add it again under Business Units (or correct the unit in the file) and upload the file again." },
  { re: /Sub-KR ".*" must look like/i, code: "SUBKR_FORMAT", title: "Sub-KR is not written as 1.1", fix: "Write the Sub-KR as the key result number, a dot, then the Sub-KR number, for example 1.1 or 2.3 (key results run from 1 to 4). For a goal that supports no Sub-KR, leave the cell empty or write Stretch." },
  { re: /needs a title of up to 500/i, code: "GOAL_LENGTH", title: "Goal title is empty or too long", fix: "Give the goal a title of up to 500 characters. Shorten it, and move the detail into a task." },
  { re: /goal has no task/i, code: "NO_TASK", title: "Goal without a task", fix: "Every goal needs at least one task with a status. Add a task in Task 1 and its Done / Not Done in Status 1." },
  { re: /task has no description/i, code: "TASK_INVALID", title: "Task without a description or status", fix: "Each task needs a description of up to 1000 characters and a status of Done or Not Done. Fix or clear the task and status cells on this row." },
  { re: /not ended\. Only closed quarters/i, code: "QUARTER_OPEN", title: "The quarter has not ended", fix: "Only quarters that have ended can be loaded here. Remove these rows from the file and load them after the quarter ends. Weeks of the current quarter are entered through the normal weekly reports." },
  { re: /has not closed yet/i, code: "WEEK_OPEN", title: "The week has not closed yet", fix: "A week can be loaded only after its final lock. Remove these rows, or upload them after the week has closed." },
  { re: /organisation holiday/i, code: "HOLIDAY", title: "The week was declared an organisation holiday", fix: "No report is expected for a holiday week, so none can be loaded. Remove these rows, or check that the week number is the right one." },
  { re: /already closed this week/i, code: "WEEK_LOCKED", title: "The application has already closed the week", fix: "A closed week accepts a late report only through a late-report exception (Governance, Late reports). Remove these rows from the file and use that process for them." },
  { re: /already has a report for this week/i, code: "REPORT_EXISTS", title: "A report already exists for this unit and week", fix: "History can never overwrite an existing report. Remove these rows from the file (the report in the application stays as it is). If the existing report is wrong, correct it through the normal process." },
  { re: /appears twice/i, code: "DUPLICATE", title: "The same goal appears twice", fix: "Delete the repeated row. If they are two different goals, give them different titles." },
];

/** Adds the code, the plain-language fix and the row's own context (unit, week, goal) to a message the database returned. */
export function explainIssue(p: { row: number; message: string }, parsed: Map<number, HistoryRow>, units: UnitRef[]): ExplainedProblem {
  const rule = RULES.find((r) => r.re.test(p.message));
  const r = parsed.get(p.row);
  const unit = r ? units.find((u) => u.id === r.bu_id) : undefined;
  return {
    row: p.row, message: p.message, code: rule?.code ?? "OTHER", fix: rule?.fix ?? "Correct this row and upload the file again. If it is unclear why the row is refused, send this row number and message to support.",
    context: r ? `${unit ? `${unit.name} (${unit.code})` : "Unit"} · ${r.year} week ${r.week} · goal "${r.goal.length > 70 ? `${r.goal.slice(0, 70)}…` : r.goal}"` : undefined,
    found: r ? `${r.year}, week ${r.week}${r.sub_kr ? `, Sub-KR ${r.sub_kr}` : ""}` : undefined,
  };
}

/** One line per kind of problem, with how many rows and which, so a long list reads as a short to-do list. */
export function groupProblems(problems: ExplainedProblem[]): ProblemGroup[] {
  const by = new Map<string, ProblemGroup>();
  for (const p of problems) {
    const code = p.code ?? "OTHER";
    const rule = RULES.find((x) => x.code === code);
    const g = by.get(code) ?? { code, title: rule?.title ?? TITLES[code] ?? "Other problem", count: 0, rows: [], fix: p.fix ?? rule?.fix ?? "" };
    g.count++;
    if (g.rows.length < 25 && !g.rows.includes(p.row)) g.rows.push(p.row);
    by.set(code, g);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}
const TITLES: Record<string, string> = {
  YEAR_INVALID: "Year is not a year", WEEK_INVALID: "Week is not a number from 1 to 53", WEEK_NOT_IN_YEAR: "Week number does not exist in that year", UNIT_UNKNOWN: "Business Unit not found",
  GOAL_EMPTY: "Goal is empty", FORMULA: "Cell contains a formula", TASK_MISSING: "Status without a task", STATUS_INVALID: "Status is not Done or Not Done", NO_TASK: "Goal without a task",
};

/** Explains a refusal the file reader gives (size, type, damaged workbook...) with what to do. */
export function explainFileError(message: string): { problem: string; fix: string } {
  const m = message;
  if (/empty/i.test(m)) return { problem: m, fix: "The file has no content. Open it, check that the data is there, save it again and upload it." };
  if (/larger than/i.test(m)) return { problem: m, fix: "Split the sheet into smaller files (for example one quarter per file) and upload them one after another." };
  if (/Only \.csv and \.xlsx/i.test(m)) return { problem: m, fix: "Save the sheet as an Excel workbook (.xlsx) or as CSV (File, Save as) and upload that file. Older .xls files and other formats are not accepted." };
  if (/real \.xlsx|could not be read/i.test(m)) return { problem: m, fix: "The file is damaged or is not really an Excel workbook (for example a renamed file). Open it in Excel, choose File, Save as, .xlsx (or CSV), and upload the new file." };
  if (/text CSV/i.test(m)) return { problem: m, fix: "A .csv file must be plain text. If it was created by renaming an Excel file, open it in Excel and save it as CSV or as .xlsx." };
  if (/header row and at least one data row/i.test(m)) return { problem: m, fix: "Put the column names in the first row and at least one goal in the rows below, in the first worksheet of the workbook." };
  if (/no worksheet/i.test(m)) return { problem: m, fix: "Add a worksheet with the data and save the workbook again." };
  if (/more than \d+ columns/i.test(m)) return { problem: m, fix: "Remove the columns that are not part of the layout (Year, Week, BU/Depart, SubKR, Goal, Task 1 to Task 10 with their statuses), including empty ones far to the right." };
  if (/more than \d+ rows/i.test(m)) return { problem: m, fix: "Split the sheet into smaller files (for example one quarter per file) and upload them one after another." };
  if (/column|Task \d|Status \d/i.test(m)) return { problem: m, fix: "Rename or add the columns in the first row of the first worksheet so they match the layout, then upload again. The template shows the exact layout." };
  if (/no data rows/i.test(m)) return { problem: m, fix: "The sheet has headers but no goals below them. Add the rows and upload again." };
  return { problem: m, fix: "Check the file against the template and upload it again." };
}

/** Explains a database error that has no friendly code (the raw message is kept so support can see exactly what happened). */
export function interpretTechnicalError(raw: string): { problem: string; fix: string } {
  const r = raw.toLowerCase();
  if (/statement timeout|canceling statement/.test(r)) return { problem: "The database took too long to process the file and stopped it.", fix: "Nothing was changed. Split the file into smaller files (for example one quarter or one year per file) and upload them one at a time." };
  if (/duplicate key|unique constraint/.test(r)) return { problem: "Something the import needs to create already exists (for example a report or a goal for the same unit, week and position).", fix: "Nothing was changed. This usually means part of this file was loaded before or the same goal appears more than once. Check for repeated rows and for reports that already exist, then upload again." };
  if (/foreign key/.test(r)) return { problem: "A row refers to a Business Unit, quarter, week or Sub-KR that is not in the application.", fix: "Nothing was changed. Check the unit names or codes and the Sub-KR numbers in the file against what exists in the application." };
  if (/check constraint|violates/.test(r)) return { problem: "A value in the file breaks one of the application's rules (for example a text that is too long or a number out of range).", fix: "Nothing was changed. Look for very long text, odd characters or numbers outside the allowed range, and upload again." };
  if (/connection|terminat|econn|socket/.test(r)) return { problem: "The connection to the database was interrupted.", fix: "Nothing was changed. Try again in a minute. If it keeps happening, split the file into smaller files." };
  if (/permission denied|not authori/.test(r)) return { problem: "The database refused the action for your account.", fix: "Sign in again with your authenticator code, or ask the Super Admin to check that your role may import history." };
  return { problem: "The database refused the import for a reason that is not one of the usual rules.", fix: "Nothing was changed. Try again; if it repeats, send the technical detail below and the reference to support, and try loading a smaller part of the file (for example one quarter) to find which rows cause it." };
}

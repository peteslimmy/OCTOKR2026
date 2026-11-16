// Turns an uploaded sheet (already read as plain cells) into the quarterly goals a Business Unit Lead is adding for the unit.
// One goal per row, in a column called Goal (BU goal, Business Unit goal and Title are accepted too). Nothing here talks to the database:
// the caller supplies the unit's active goal titles and gets back the titles to add plus every problem found, each with its row.

export const BU_GOAL_UPLOAD_LIMITS = { goals: 100, title: 500 } as const;
export const BU_GOAL_TEMPLATE_HEADERS = ["Goal"] as const;
export interface BuGoalUploadResult { titles: string[]; errors: string[] }

export const buGoalTemplateCsv = () => `${BU_GOAL_TEMPLATE_HEADERS.join(",")}\r\n`;

export function parseBuGoalUpload(headers: string[], rows: string[][], existingTitles: Set<string> = new Set()): BuGoalUploadResult {
  const col = headers.findIndex((h) => /^(bu[\s_-]*goals?|business[\s_-]*unit[\s_-]*goals?|goals?|goal[\s_-]*title|title)$/i.test(h.trim()));
  if (col < 0) return { titles: [], errors: ["The first row must have a column heading called Goal."] };
  const titles: string[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const existing = new Set([...existingTitles].map((t) => t.trim().toLowerCase()));
  rows.forEach((r, idx) => {
    const line = idx + 2;                                // the sheet's own row number: the header is row 1
    const title = (r[col] ?? "").trim();
    if (!title) return;                                  // blank rows are ignored
    if (title.startsWith("=")) { errors.push(`Row ${line}: the cell starts with "=" (formulas are not accepted).`); return; }
    if (title.length > BU_GOAL_UPLOAD_LIMITS.title) { errors.push(`Row ${line}: the goal is longer than ${BU_GOAL_UPLOAD_LIMITS.title} characters.`); return; }
    const key = title.toLowerCase();
    if (existing.has(key)) { errors.push(`Row ${line}: your unit already has this goal this quarter ("${title.slice(0, 60)}").`); return; }
    if (seen.has(key)) { errors.push(`Row ${line}: the same goal is already on row ${seen.get(key)}.`); return; }
    seen.set(key, line);
    titles.push(title);
  });
  if (titles.length === 0 && errors.length === 0) errors.push("The file has no goals. Put one goal on each row under the heading Goal.");
  if (titles.length > BU_GOAL_UPLOAD_LIMITS.goals) errors.push(`The file has ${titles.length} goals; at most ${BU_GOAL_UPLOAD_LIMITS.goals} can be uploaded at once.`);
  return { titles, errors };
}

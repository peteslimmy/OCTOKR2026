/**
 * "What to do" for the row-level messages of every bulk upload (employees, business units, strategy, sign-ins, weekly goals). Pure and shared by the server and the screens.
 * The message says what is wrong; this says how to correct it in the spreadsheet. Unknown messages get a general instruction rather than nothing.
 */
const RULES: [RegExp, string][] = [
  [/not a valid email|email address/i, "Write the work email in full, like name@company.com, with no spaces, and without a leading = + - or @. Fix the cell and upload again."],
  [/already appears on row/i, "The same person is listed twice. Delete the repeated row (or merge the roles into one row)."],
  [/at least one role|is not a role/i, "Use a role code or role name exactly as on the Roles page, for example BU_LEAD or BU Lead. Separate several roles with a comma or semicolon."],
  [/No employee has this email/i, "Import the person under Import employees first (with this exact email), then upload the sign-ins again."],
  [/employee is inactive/i, "Reactivate the employee (employment status ACTIVE) before giving them a sign-in, or delete the row."],
  [/already has a sign-in/i, "Nothing to do: this person can already sign in. Delete the row. To change their roles use Access & permissions."],
  [/domain .* is not approved/i, "Use a company email address, or ask the Super Admin to approve this email domain in Settings."],
  [/needs the permission/i, "Ask someone who may hand out this role (roles.manage) to run this row, or remove the role from it."],
  [/not a Business Unit|unknown (business )?unit|no business unit/i, "Type the unit exactly as its code or its name appears under Business Units, or add the unit first."],
  [/is not a year/i, "Type a four-digit year such as 2026."],
  [/must be 1 to 4/i, "Use 1, 2, 3 or 4 (quarters may also be written Q1 to Q4; key results are numbered 1 to 4)."],
  [/Sub-KR .* must be a number/i, "Write the Sub-KR as a number such as 1, 2 or 1.2."],
  [/is empty/i, "Fill in the empty cell, or delete the row if it is a spare line."],
  [/formula/i, "Copy the cell and paste it back as values only (Paste special, then Values). Save and upload again."],
  [/already exists|already imported|already in/i, "It is already in the application. Delete the row, or choose the option that updates existing records if you mean to change them."],
  [/too long|up to \d+ characters/i, "Shorten the text to fit the limit in the message."],
  [/not (a )?valid|invalid/i, "Correct the value as described in the message, then upload again."],
  [/week|quarter|closed|locked/i, "Check the week or quarter in the row. It must exist, be open for this action, and belong to the unit you are working on."],
  [/Sub-KR|key result|KR\b/i, "Use a Sub-KR code that exists for this quarter (see Strategy), written like 1.1, or leave it empty for a stretch goal."],
  [/task/i, "Each goal needs at least one task. Put the task text in the Task column and keep one task per row if the file uses one row per task."],
];
export const GENERAL_FIX = "Correct this row as the message describes and upload the file again. Nothing was changed, so it is safe to retry.";
export function fixFor(message: string): string {
  return RULES.find(([re]) => re.test(message))?.[1] ?? GENERAL_FIX;
}
export const withFixes = <T extends { message: string }>(problems: T[]): (T & { fix: string })[] => problems.map((p) => ({ ...p, fix: fixFor(p.message) }));

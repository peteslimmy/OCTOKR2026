/**
 * Sign-in accounts from a sheet (gap-closure plan, Phase C, ADR-080): people who are already employees get a sign-in and one or more roles.
 *
 *   Email | Roles          (Roles: codes or names separated by comma, semicolon or slash; for example "BU_LEAD" or "BU Lead; Presenter")
 *
 * Pure functions; the server and the database re-check everything.
 */
export interface SignInRow { row: number; email: string; roles: string[] }
export interface SignInProblem { row: number; message: string }
export interface RoleRef { code: string; name: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const EMAIL = /^[^@\s,;<>"()]+@[^@\s,;<>"()]+\.[^@\s,;<>"()]+$/;

export function parseSignInSheet(headers: string[], rows: string[][], roles: RoleRef[]): { rows: SignInRow[]; problems: SignInProblem[] } | { error: string } {
  const h = headers.map(norm);
  const e = h.findIndex((x) => ["email", "emailaddress", "workemail"].includes(x));
  const r = h.findIndex((x) => ["roles", "role", "rolecodes"].includes(x));
  if (e < 0 || r < 0) return { error: "The sheet needs an Email column and a Roles column. The first row must hold the column names." };
  const byKey = new Map<string, string>();
  for (const ro of roles) { byKey.set(norm(ro.code), ro.code); byKey.set(norm(ro.name), ro.code); }
  const out: SignInRow[] = [], problems: SignInProblem[] = [], seen = new Map<string, number>();
  rows.forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((x) => !x || !x.trim())) return;
    const email = (cells[e] ?? "").trim().toLowerCase();
    if (!email || email.length > 200 || !EMAIL.test(email) || /^[=+\-@]/.test(email)) return void problems.push({ row, message: "This is not a valid email address." });
    if (seen.has(email)) return void problems.push({ row, message: `This email already appears on row ${seen.get(email)}.` });
    seen.set(email, row);
    const names = (cells[r] ?? "").split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);
    if (!names.length) return void problems.push({ row, message: "Give at least one role." });
    const codes: string[] = [];
    for (const n of names) {
      const code = byKey.get(norm(n));
      if (!code) return void problems.push({ row, message: `"${n}" is not a role. Use a role code or name.` });
      if (!codes.includes(code)) codes.push(code);
    }
    out.push({ row, email, roles: codes });
  });
  if (!out.length && !problems.length) return { error: "The sheet has no data rows." };
  return { rows: out, problems };
}

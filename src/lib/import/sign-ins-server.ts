import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { adminClient } from "@/lib/supabase/admin";
import type { SignInProblem, SignInRow } from "./sign-ins";

export interface CheckedSignIn extends SignInRow { name: string; unit: string }

/** What the database says about each person in the sheet: they must be an active employee with no sign-in yet, and the actor may hand out every role. */
export async function checkSignIns(rows: SignInRow[], actor: Actor): Promise<{ ok: CheckedSignIn[]; problems: SignInProblem[] }> {
  const sb = adminClient();
  const { data: emps } = await sb.from("employees").select("id, email, first_name, last_name, employment_status, business_units(name), users(id)").in("email", rows.map((r) => r.email));
  const byEmail = new Map((emps ?? []).map((e) => [String(e.email).toLowerCase(), e as unknown as { id: string; first_name: string; last_name: string; employment_status: string; business_units: { name: string } | null; users: { id: string } | null }]));
  const { data: roles } = await sb.rpc("read_roles");
  const privileged = new Set(((roles as { code: string; privileged: boolean }[] | null) ?? []).filter((r) => r.privileged).map((r) => r.code));
  const { data: approved } = await sb.from("allowed_email_domains").select("domain");
  const domains = new Set((approved ?? []).map((d) => String(d.domain)));
  const ok: CheckedSignIn[] = [], problems: SignInProblem[] = [];
  for (const r of rows) {
    const e = byEmail.get(r.email);
    if (!e) problems.push({ row: r.row, message: "No employee has this email. Add the person under Import employees first." });
    else if (e.employment_status !== "ACTIVE") problems.push({ row: r.row, message: "This employee is inactive." });
    else if (e.users) problems.push({ row: r.row, message: "This person already has a sign-in." });
    else if (!domains.has(r.email.split("@")[1] ?? "")) problems.push({ row: r.row, message: `The email domain @${r.email.split("@")[1]} is not approved. Ask the Super Admin to approve it under Administration > Settings.` });
    else if (r.roles.some((c) => privileged.has(c)) && !actor.permissions.has("roles.manage")) problems.push({ row: r.row, message: "Handing out this role needs the permission to manage roles." });
    else ok.push({ ...r, name: `${e.first_name} ${e.last_name}`, unit: e.business_units?.name ?? "" });
  }
  return { ok, problems };
}

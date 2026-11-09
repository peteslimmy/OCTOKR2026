import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Super Admin accounts are invisible to everyone who is not a Super Admin (ADR-118). The database enforces it wherever a person is read through a signed-in session
 * (supabase/migrations/20261109000007_super_admin_shield.sql). This file is the same rule for server code that reads with the service role (which sees everything)
 * and for requests that name a person: a request that mentions a hidden account is answered "not found", exactly as for an account that does not exist.
 */
export interface Hidden { users: Set<string>; employees: Set<string>; emails: Set<string> }
const NONE: Hidden = { users: new Set(), employees: new Set(), emails: new Set() };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cache: { at: number; value: Hidden } | null = null;
const TTL_MS = 10_000;

/** Every Super Admin account (the set a non-Super Admin must not see). Kept for ten seconds. */
export async function allSuperAdmins(): Promise<Hidden> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const sb = adminClient();
  const { data: roles, error } = await sb.from("user_roles").select("user_id, roles!inner(code)").eq("roles.code", "SUPER_ADMIN");
  if (error) throw new Error(`shield unavailable: ${error.message}`);
  const ids = [...new Set((roles ?? []).map((r) => String(r.user_id)))];
  const value: Hidden = { users: new Set(ids), employees: new Set(), emails: new Set() };
  if (ids.length) {
    const { data: us, error: e2 } = await sb.from("users").select("id, email, employee_id").in("id", ids);
    if (e2) throw new Error(`shield unavailable: ${e2.message}`);
    for (const u of us ?? []) { if (u.employee_id) value.employees.add(String(u.employee_id)); if (u.email) value.emails.add(String(u.email).toLowerCase()); }
  }
  cache = { at: Date.now(), value };
  return value;
}
export const forgetSuperAdmins = () => { cache = null; };

/** What this person must not see: nothing for a Super Admin. */
export async function hiddenFrom(actor: { roles: readonly string[] }): Promise<Hidden> {
  return actor.roles.includes("SUPER_ADMIN") ? NONE : allSuperAdmins();
}

/** The ids (and addresses) named anywhere in a value: strings that look like an id or an email address, found in objects and lists to a sane depth. */
export function namedIn(value: unknown, depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 6 || out.size > 500) return out;
  if (typeof value === "string") { if (UUID.test(value)) out.add(value.toLowerCase()); else if (value.includes("@") && value.length < 200) out.add(value.toLowerCase()); }
  else if (Array.isArray(value)) for (const v of value.slice(0, 500)) namedIn(v, depth + 1, out);
  else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) namedIn(v, depth + 1, out);
  return out;
}

/**
 * True when the request names a hidden person by account id or employee id. An email address is deliberately not treated this way: a new account with a Super Admin's address
 * gets the same answer as one with any other taken address, so the refusal does not reveal that the address belongs to a Super Admin.
 */
export function mentionsHidden(named: Set<string>, h: Hidden): boolean {
  for (const n of named) if (h.users.has(n) || h.employees.has(n)) return true;
  return false;
}

/** Removes the hidden accounts from a list of people-shaped rows, by whichever of the id fields the rows carry. */
export function withoutHidden<T extends Record<string, unknown>>(rows: T[], h: Hidden, fields: { user?: string[]; employee?: string[]; email?: string[] } = { user: ["id", "user_id"], employee: ["employee_id"], email: ["email"] }): T[] {
  if (!h.users.size) return rows;
  return rows.filter((r) =>
    !(fields.user ?? []).some((f) => typeof r[f] === "string" && h.users.has(r[f] as string))
    && !(fields.employee ?? []).some((f) => typeof r[f] === "string" && h.employees.has(r[f] as string))
    && !(fields.email ?? []).some((f) => typeof r[f] === "string" && h.emails.has((r[f] as string).toLowerCase())));
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";

export interface Actor {
  id: string;
  email: string;
  name: string;
  buId: string | null;
  buName: string | null;
  roles: string[];
  permissions: ReadonlySet<string>;
  /** Second-factor situation of this session (ADR-052). `totp` and `email` say which methods are set up; `aal` is effective. */
  mfa: {
    required: boolean;
    enrolled: boolean;
    totp: boolean;
    email: boolean;
    emailVerified: boolean;
    aal: "aal1" | "aal2";
  };
}

type MfaStatus = {
  required: boolean;
  enrolled: boolean;
  totp: boolean;
  email: boolean;
  emailVerifiedAt: string | null;
  aal: "aal1" | "aal2";
};

export const can = (a: Actor, code: string) => a.permissions.has(code);

type ProfileRow = {
  id: string;
  email: string;
  status: string;
  employees: { first_name: string; last_name: string; business_unit_id: string; business_units: { name: string } | null } | null;
  user_roles: { roles: { code: string; role_permissions: { permissions: { code: string } | null }[] } | null }[];
};

/**
 * Resolves the verified caller. Identity comes from auth.getUser() (JWT verified by the auth server),
 * never from a cookie claim or a request field (ADR-035). Reads run under the caller's own RLS.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const sb = await userClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  // The profile and the second-factor status do not depend on each other: ask for both at once (one round trip fewer on every request).
  const [{ data, error }, { data: m }] = await Promise.all([
    sb
      .from("users")
      .select(
        "id, email, status, employees(first_name, last_name, business_unit_id, business_units(name)), user_roles!user_roles_user_id_fkey(roles(code, role_permissions(permissions(code))))",
      )
      .eq("id", auth.user.id)
      .maybeSingle<ProfileRow>(),
    sb.rpc("read_my_mfa_status"),
  ]);
  if (error) console.error("getActor profile query failed:", error.message);
  if (error || !data || data.status !== "ACTIVE") return null;
  const roles = data.user_roles.map((ur) => ur.roles?.code).filter((c): c is string => !!c);
  const permissions = new Set<string>();
  for (const ur of data.user_roles) for (const rp of ur.roles?.role_permissions ?? []) if (rp.permissions) permissions.add(rp.permissions.code);
  const status = (m as MfaStatus | null) ?? { required: false, enrolled: false, totp: false, email: false, emailVerifiedAt: null, aal: "aal1" as const };
  const mfa: Actor["mfa"] = {
    required: status.required,
    enrolled: status.enrolled,
    totp: status.totp,
    email: status.email,
    emailVerified: status.emailVerifiedAt !== null,
    aal: status.aal,
  };
  return {
    id: data.id,
    email: data.email,
    name: data.employees ? `${data.employees.first_name} ${data.employees.last_name}` : data.email,
    buId: data.employees?.business_unit_id ?? null,
    buName: data.employees?.business_units?.name ?? null,
    roles,
    permissions,
    mfa,
  };
});

/** For pages: pages render in parallel with layouts, so each page must enforce authentication itself. */
export async function requireActor(opts: { partial?: boolean } = {}): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (!opts.partial) enforceMfaForPage(a);
  return a;
}

/** Pages follow the same second-factor rule as the API: elevated users must enrol, enrolled users must complete the challenge. */
export function enforceMfaForPage(a: Actor) {
  if (a.mfa.required && !a.mfa.enrolled) redirect("/account/security?enrol=1");
  if (a.mfa.enrolled && a.mfa.aal !== "aal2") redirect("/login?mfa=1");
}

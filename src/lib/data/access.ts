import "server-only";
import { listUsers } from "@/lib/data";
import { dbError } from "@/lib/data/errors";
import { listPermissions, listRoles, type PermissionRow } from "@/lib/data/config";
import { userClient } from "@/lib/supabase/server";
import type { ConflictPair, GrantLite, RoleLite, ReviewUser } from "@/lib/rbac/access";

export interface AccessModel {
  roles: (RoleLite & { id: string; description: string | null; members: number; isSystem: boolean })[];
  permissions: PermissionRow[];
  users: ReviewUser[];
  conflicts: ConflictPair[];
  /** the units each person is limited to (a person with none is unrestricted) */
  scopes: Record<string, string[]>;
  units: { id: string; name: string }[];
  /** false when the signed-in person may not read other people's direct grants (only people who manage roles may) */
  grantsVisible: boolean;
}

/** Roles, permissions, people, their direct grants and the separation-of-duties pairs, read as the signed-in person. */
export async function getAccessModel(canReadGrants: boolean): Promise<AccessModel> {
  const sb = await userClient();
  const [roles, permissions, users, grantsRes, conflictsRes, scopesRes, unitsRes] = await Promise.all([
    listRoles(), listPermissions(), listUsers(false),
    canReadGrants ? sb.from("user_permission_grants").select("user_id, reason, expires_at, permissions(code), grantor:users!user_permission_grants_granted_by_fkey(email)") : Promise.resolve({ data: [], error: null }),
    sb.from("permission_conflicts").select("permission_a, permission_b, reason"),
    canReadGrants ? sb.from("user_unit_scopes").select("user_id, business_unit_id") : Promise.resolve({ data: [], error: null }),
    sb.from("business_units").select("id, name").eq("status", "ACTIVE").order("name"),
  ]);
  if (grantsRes.error) throw dbError(grantsRes.error, "direct grants");
  if (conflictsRes.error) throw dbError(conflictsRes.error, "conflicts of duties");
  const grants = new Map<string, GrantLite[]>();
  for (const g of (grantsRes.data ?? []) as unknown as { user_id: string; reason: string | null; expires_at: string | null; permissions: { code: string } | null; grantor: { email: string } | null }[]) {
    if (!g.permissions) continue;
    grants.set(g.user_id, [...(grants.get(g.user_id) ?? []), { permission: g.permissions.code, reason: g.reason, expiresAt: g.expires_at, grantedBy: g.grantor?.email ?? null }]);
  }
  return {
    roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, members: r.members, isSystem: r.is_system, permissions: r.permissions, requiresMfa: r.requires_mfa })),
    permissions,
    users: users.map((u) => ({
      id: u.id, name: u.employees ? `${u.employees.first_name} ${u.employees.last_name}` : u.email, email: u.email, unit: u.employees?.business_units?.name ?? null, status: u.status,
      roles: u.user_roles.map((r) => r.roles?.code).filter((c): c is string => !!c), lastLoginAt: u.last_login_at, grants: grants.get(u.id) ?? [],
    })),
    conflicts: ((conflictsRes.data ?? []) as { permission_a: string; permission_b: string; reason: string }[]).map((c) => ({ a: c.permission_a, b: c.permission_b, reason: c.reason })),
    scopes: ((scopesRes.data ?? []) as { user_id: string; business_unit_id: string }[]).reduce<Record<string, string[]>>((m, r) => { (m[r.user_id] ??= []).push(r.business_unit_id); return m; }, {}),
    units: ((unitsRes.data ?? []) as { id: string; name: string }[]),
    grantsVisible: canReadGrants,
  };
}

export interface ReviewItem { userId: string; snapshot: { name: string; email: string; unit: string | null; roles: string[]; permissions: number; critical: number; grants: { permission: string; expires_at: string | null; reason: string | null }[]; units: number; last_login_at: string | null }; decision: "KEEP" | "CHANGE" | "SELF" | null; comment: string | null }
export interface AccessReviewRow { id: string; label: string; status: "OPEN" | "SIGNED_OFF"; openedAt: string; openedBy: string | null; dueAt: string; signedOffAt: string | null; signedOffBy: string | null; attestation: string | null; summary: { people: number; keep: number; change: number; self: number } | null }
export interface AccessReviews { settings: { enabled: boolean; months: number }; reviews: AccessReviewRow[]; open: { review: AccessReviewRow; items: ReviewItem[] } | null }

/** Access reviews: the schedule, the history and the open review with a line for every person. Only people who manage roles may read them. */
export async function getAccessReviews(): Promise<AccessReviews> {
  const sb = await userClient();
  const [settings, reviews] = await Promise.all([
    sb.from("access_review_settings").select("enabled, frequency_months").maybeSingle(),
    sb.from("access_reviews").select("id, label, status, opened_at, due_at, signed_off_at, attestation, summary, opener:users!access_reviews_opened_by_fkey(email), signer:users!access_reviews_signed_off_by_fkey(email)").order("opened_at", { ascending: false }).limit(20),
  ]);
  if (reviews.error) throw dbError(reviews.error, "access reviews");
  const rows = ((reviews.data ?? []) as unknown as { id: string; label: string; status: "OPEN" | "SIGNED_OFF"; opened_at: string; due_at: string; signed_off_at: string | null; attestation: string | null; summary: AccessReviewRow["summary"]; opener: { email: string } | null; signer: { email: string } | null }[])
    .map((r): AccessReviewRow => ({ id: r.id, label: r.label, status: r.status, openedAt: r.opened_at, openedBy: r.opener?.email ?? null, dueAt: r.due_at, signedOffAt: r.signed_off_at, signedOffBy: r.signer?.email ?? null, attestation: r.attestation, summary: r.summary }));
  const open = rows.find((r) => r.status === "OPEN") ?? null;
  let items: ReviewItem[] = [];
  if (open) {
    const res = await sb.from("access_review_items").select("user_id, snapshot, decision, comment").eq("review_id", open.id);
    if (res.error) throw dbError(res.error, "access review items");
    items = ((res.data ?? []) as { user_id: string; snapshot: ReviewItem["snapshot"]; decision: ReviewItem["decision"]; comment: string | null }[]).map((i) => ({ userId: i.user_id, snapshot: i.snapshot, decision: i.decision, comment: i.comment }))
      .sort((a, b) => b.snapshot.critical - a.snapshot.critical || a.snapshot.name.localeCompare(b.snapshot.name));
  }
  const st = settings.data as { enabled: boolean; frequency_months: number } | null;
  return { settings: { enabled: st?.enabled ?? false, months: st?.frequency_months ?? 3 }, reviews: rows, open: open ? { review: open, items } : null };
}

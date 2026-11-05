import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getAccessModel } from "@/lib/data/access";
import { capabilityStatus, conflictsHeld, effectiveAccess } from "@/lib/rbac/access";
import { GrantForm, RevokeGrant } from "../access-client";
import { ScopeForm } from "../review-client";

export const metadata: Metadata = { title: "Access detail" };

const RISK_TONE = { low: "info", medium: "info", high: "warn", critical: "critical" } as const;
const dateText = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso)) : null);

export default async function AccessDetail({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "roles.request") && !can(actor, "users.manage") && !can(actor, "roles.manage")) return <Card><EmptyState title="Access control is not available for your role" /></Card>;
  const { userId } = await params;
  const manage = can(actor, "roles.manage");
  const model = await getAccessModel(manage);
  const user = model.users.find((u) => u.id === userId);
  if (!user) notFound();

  const now = new Date();
  const roleMap = new Map(model.roles.map((r) => [r.code, r]));
  const held = effectiveAccess(user.roles, roleMap, user.grants, now);
  const heldSet = new Set(held.keys());
  const status = capabilityStatus(heldSet, model.roles);
  const allowed = status.filter((s) => s.allowed), blocked = status.filter((s) => !s.allowed);
  const conflicts = conflictsHeld(heldSet, model.conflicts);
  const byModule = new Map<string, typeof model.permissions>();
  for (const p of model.permissions) if (heldSet.has(p.code)) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
  // permissions that can still be granted directly: not reserved, not already held
  const grantable = model.permissions.filter((p) => !p.reserved && !heldSet.has(p.code) && (!p.protected || actor.permissions.has(p.code)));

  return (
    <>
      <PageHeader title={user.name} description={`${user.email}${user.unit ? ` · ${user.unit}` : ""} · ${user.status.toLowerCase()} · last signed in ${dateText(user.lastLoginAt) ?? "never"}`}
        actions={<><Link href="/admin/access" className={buttonClass("secondary", "sm")}>All people</Link><Link href="/admin/people" className={buttonClass("secondary", "sm")}>Change roles</Link></>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Roles" description="Each role is a set of permissions. To change roles, use People." />
          <div className="flex flex-wrap gap-3 px-6 py-4">
            {user.roles.map((r) => { const role = roleMap.get(r); return (
              <div key={r} className="rounded-lg border border-line px-3 py-2 text-sm"><p className="font-medium">{role?.name ?? r}</p><p className="text-xs text-muted">{role?.permissions.length ?? 0} permissions{role?.requiresMfa ? " · authenticator required" : ""}</p></div>
            ); })}
          </div>
          {conflicts.length ? <div className="border-t border-line px-6 py-3 text-sm text-[var(--critical-fg)]">{conflicts.map((c) => <p key={`${c.a}${c.b}`}><strong>Conflict of duties:</strong> {c.a} with {c.b}. {c.reason}.</p>)}</div> : null}
        </Card>

        <Card>
          <CardHeader title="What this person cannot do yet" description="Each line says what is missing and which existing role would add it." />
          {blocked.length === 0 ? <EmptyState title="Nothing missing">This person can do everything listed below.</EmptyState> : (
            <DataTable caption="Things this person cannot do" columns={[{ label: "Function" }, { label: "Needs" }, { label: "A role that would give it" }]} maxHeight="26rem">
              {blocked.map(({ capability: c, missing, grantedByRoles }) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td><span className="font-medium">{c.label}</span><span className="block text-xs text-muted">{c.module}{c.path ? ` · ${c.path}` : ""}</span></td>
                  <td className="font-mono text-xs">{missing.join(", ")}</td>
                  <td>{grantedByRoles.length ? grantedByRoles.map((r) => <Badge key={r} tone="brand">{r}</Badge>) : <span className="text-muted">No single role. Grant it directly or build a role.</span>}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>

        <Card>
          <CardHeader title={`What this person can do (${allowed.length})`} />
          <ul className="grid gap-x-6 gap-y-1 px-6 py-4 text-sm sm:grid-cols-2">{allowed.map(({ capability: c }) => <li key={c.id} className="flex items-start gap-2"><span aria-hidden className="text-[var(--done-fg)]">✓</span><span>{c.label}<span className="block text-xs text-muted">{c.module}</span></span></li>)}</ul>
        </Card>

        <Card>
          <CardHeader title={`Every permission held (${held.size})`} description="Where each one comes from." />
          {[...byModule.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, perms]) => (
            <div key={m} className="border-t border-line first:border-0">
              <h3 className="px-6 pt-3 text-xs font-semibold tracking-wide text-muted uppercase">{m}</h3>
              <ul className="divide-y divide-line">
                {perms.map((p) => (
                  <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm">
                    <span><span className="font-mono text-xs">{p.code}</span> <Badge tone={RISK_TONE[p.risk]}>{p.risk}</Badge><span className="block text-xs text-muted">{p.description}</span></span>
                    <span className="flex flex-wrap gap-1">{held.get(p.code)!.map((s, i) => <Badge key={i} tone={s.kind === "grant" ? "warn" : "brand"}>{s.kind === "grant" ? `Direct${s.expiresAt ? ` until ${dateText(s.expiresAt)}` : ""}` : s.label}</Badge>)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>

        <Card>
          <CardHeader title="Unit scope" description="Limits the hands-on work that is about a unit or a person in it: raising, changing, settling and voiding violations, and setting or correcting a person's attendance. Organisation-wide work (holding a session, finalising a roster) is not limited." />
          {manage ? <ScopeForm userId={user.id} units={model.units} current={model.scopes[user.id] ?? []} /> : <p className="px-6 py-4 text-sm text-muted">Only people who manage roles can see and change a unit scope.</p>}
        </Card>

        <Card>
          <CardHeader title="Direct grants" description="A single permission given to this person outside their roles, with a reason and, optionally, an end date. Every grant and removal is audited." />
          {!model.grantsVisible ? <p className="px-6 py-4 text-sm text-muted">Only people who manage roles can see and change direct grants.</p> : (
            <>
              {user.grants.length === 0 ? <p className="px-6 py-4 text-sm text-muted">No direct grants.</p> : (
                <ul className="divide-y divide-line">
                  {user.grants.map((g) => (
                    <li key={g.permission} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                      <div><p className="font-mono text-xs">{g.permission}</p><p className="text-muted">{g.reason ?? "No reason recorded"} · by {g.grantedBy ?? "unknown"} · {g.expiresAt ? (new Date(g.expiresAt) > now ? `ends ${dateText(g.expiresAt)}` : <Badge tone="locked">Expired {dateText(g.expiresAt)}</Badge>) : "no end date"}</p></div>
                      <RevokeGrant userId={user.id} permission={g.permission} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-line"><GrantForm userId={user.id} options={grantable.map((p) => ({ code: p.code, module: p.module, description: p.description, risk: p.risk }))} /></div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

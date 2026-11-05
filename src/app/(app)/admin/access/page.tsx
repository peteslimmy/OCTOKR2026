import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getAccessModel, getAccessReviews } from "@/lib/data/access";
import { accessReview, effectiveAccess } from "@/lib/rbac/access";
import { MatrixCsv } from "./access-client";
import { ReviewPanel } from "./review-client";

export const metadata: Metadata = { title: "Access & permissions" };

const RISK_TONE = { low: "info", medium: "info", high: "warn", critical: "critical" } as const;
const SEV_TONE = { high: "critical", medium: "warn", low: "info" } as const;
const TABS = [["people", "People"], ["matrix", "Roles & permissions"], ["review", "Access review"]] as const;
const dateText = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(new Date(iso)) : "Never");

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "roles.request") && !can(actor, "users.manage") && !can(actor, "roles.manage")) return <Card><EmptyState title="Access control is not available for your role" /></Card>;
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "people";
  const model = await getAccessModel(can(actor, "roles.manage"));
  const roleMap = new Map(model.roles.map((r) => [r.code, r]));
  const risk = new Map(model.permissions.map((p) => [p.code, p.risk]));
  const now = new Date();

  return (
    <>
      <PageHeader title="Access & permissions" description="Who can do what, and why. Read a person's real access, compare roles side by side, and review where access deserves a second look."
        actions={<><Link href="/admin/roles" className={buttonClass("secondary", "sm")}>Edit roles</Link><Link href="/admin/people" className={buttonClass("secondary", "sm")}>People</Link></>} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Access sections">
        {TABS.map(([id, label]) => <Link key={id} href={`/admin/access?tab=${id}`} aria-current={tab === id ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-sm ${tab === id ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`}>{label}</Link>)}
      </nav>

      {tab === "people" ? (
        <Card>
          <CardHeader title={`People (${model.users.length})`} description="Open a person to see everything they can and cannot do, and why." />
          <DataTable caption="People, their roles and their access" columns={[{ label: "Person" }, { label: "Unit" }, { label: "Roles" }, { label: "Permissions", align: "right" }, { label: "Critical", align: "right" }, { label: "Direct grants", align: "right" }, { label: "Last sign-in" }, { label: "Open", srOnly: true }]}>
            {model.users.map((u) => {
              const held = effectiveAccess(u.roles, roleMap, u.grants, now);
              const critical = [...held.keys()].filter((p) => risk.get(p) === "critical").length;
              return (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td><span className="font-medium">{u.name}</span><span className="block text-xs text-muted">{u.email}{u.status !== "ACTIVE" ? ` · ${u.status.toLowerCase()}` : ""}</span></td>
                  <td className="text-muted">{u.unit ?? "—"}</td>
                  <td><span className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="brand">{roleMap.get(r)?.name ?? r}</Badge>)}</span></td>
                  <td className="text-right tabular-nums">{held.size}</td>
                  <td className="text-right tabular-nums">{critical ? <Badge tone="critical">{critical}</Badge> : 0}</td>
                  <td className="text-right tabular-nums">{model.grantsVisible ? u.grants.length : "—"}</td>
                  <td className="text-muted">{dateText(u.lastLoginAt)}</td>
                  <td><Link href={`/admin/access/${u.id}`} className="text-brand-700 underline">Open<span className="sr-only"> {u.name}</span></Link></td>
                </tr>
              );
            })}
          </DataTable>
        </Card>
      ) : null}

      {tab === "matrix" ? <Matrix model={model} /> : null}

      {tab === "review" ? (
        <>
        {can(actor, "roles.manage") ? (
          <Card className="mb-4">
            <CardHeader title="Periodic access review" description="Every so often, check that each person's access is still right and sign it off. Nobody reviews their own access." />
            <ReviewPanel data={await getAccessReviews()} me={actor.id} />
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Access review" description="Where access deserves a second look. These are prompts to check, not findings." />
          {(() => {
            const flags = accessReview({ users: model.users, roles: model.roles, risk, conflicts: model.conflicts, now });
            if (!flags.length) return <EmptyState title="Nothing to look at">No unusual access was found.</EmptyState>;
            return (
              <ul className="divide-y divide-line">
                {flags.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]).map((f) => (
                  <li key={f.id} className="space-y-1 px-6 py-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium"><Badge tone={SEV_TONE[f.severity]}>{f.severity === "high" ? "Act" : f.severity === "medium" ? "Check" : "Note"}</Badge>{f.title}</p>
                    <p className="text-muted">{f.detail}</p>
                    {f.userIds.length ? <p className="flex flex-wrap gap-2 text-xs">{f.userIds.slice(0, 6).map((id) => <Link key={id} href={`/admin/access/${id}`} className="text-brand-700 underline">{model.users.find((u) => u.id === id)?.name}</Link>)}</p> : null}
                  </li>
                ))}
              </ul>
            );
          })()}
          {!model.grantsVisible ? <p className="border-t border-line px-6 py-3 text-xs text-muted">Direct grants are visible to people who manage roles only, so the checks on grants are not shown to you.</p> : null}
        </Card>
        </>
      ) : null}
    </>
  );
}

function Matrix({ model }: { model: Awaited<ReturnType<typeof getAccessModel>> }) {
  const modules = [...new Set(model.permissions.map((p) => p.module))].sort();
  const csvRows = model.permissions.map((p) => ({ module: p.module, code: p.code, risk: p.risk, has: model.roles.map((r) => r.permissions.includes(p.code)) }));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Roles at a glance" description="What each role is for and how many people hold it." action={<MatrixCsv roles={model.roles.map((r) => r.name)} rows={csvRows} />} />
        <DataTable caption="Roles" columns={[{ label: "Role" }, { label: "People", align: "right" }, { label: "Permissions", align: "right" }, { label: "Critical", align: "right" }, { label: "Authenticator" }, { label: "What it is for" }]}>
          {model.roles.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="font-medium">{r.name} <span className="font-mono text-xs text-muted">{r.code}</span></td>
              <td className="text-right tabular-nums">{r.members}</td><td className="text-right tabular-nums">{r.permissions.length}</td>
              <td className="text-right tabular-nums">{r.permissions.filter((p) => model.permissions.find((x) => x.code === p)?.risk === "critical").length}</td>
              <td>{r.requiresMfa ? <Badge tone="info">Required</Badge> : <span className="text-muted">Not required</span>}</td>
              <td className="text-muted">{r.description ?? "—"}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
      {modules.map((m) => (
        <Card key={m}>
          <CardHeader title={m} description={`${model.permissions.filter((p) => p.module === m).length} permissions`} />
          <DataTable caption={`${m}: which roles hold which permissions`} columns={[{ label: "Permission" }, { label: "Risk" }, ...model.roles.map((r) => ({ label: r.name, align: "right" as const }))]} maxHeight="30rem">
            {model.permissions.filter((p) => p.module === m).map((p) => (
              <tr key={p.code} className="border-b border-line last:border-0">
                <td><span className="font-mono text-xs">{p.code}</span><span className="block text-xs text-muted">{p.description}</span></td>
                <td><Badge tone={RISK_TONE[p.risk]}>{p.risk}</Badge>{p.reserved ? <> <Badge tone="critical">Reserved</Badge></> : p.protected ? <> <Badge tone="warn">Protected</Badge></> : null}</td>
                {model.roles.map((r) => <td key={r.code} className="text-right">{r.permissions.includes(p.code) ? <span aria-label="Held" className="font-semibold text-[var(--done-fg)]">✓</span> : <span className="text-muted" aria-label="Not held">·</span>}</td>)}
              </tr>
            ))}
          </DataTable>
        </Card>
      ))}
    </div>
  );
}

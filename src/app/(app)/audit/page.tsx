import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, DataTable, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { AUDIT_PAGE_SIZE, filterFrom, pageAudit } from "@/lib/data/audit";

export const metadata: Metadata = { title: "Audit" };

const OUTCOMES = ["SUCCESS", "DENIED", "FAILURE"];

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const actor = await requireActor();
  if (!can(actor, "audit.read")) return <Card><EmptyState title="You do not have access to the audit log" /></Card>;
  const sp = await searchParams;
  const filter = filterFrom(sp);
  const cursor = typeof sp.cursor === "string" ? sp.cursor : null;
  const { rows, nextCursor } = await pageAudit(filter, cursor, AUDIT_PAGE_SIZE);

  const keep = new URLSearchParams();
  for (const [k, v] of [["action", filter.action], ["type", filter.entityType], ["outcome", filter.outcome], ["from", filter.from], ["to", filter.to], ["q", filter.q]] as const) if (v) keep.set(k, v);
  const filtered = keep.size > 0;
  const older = new URLSearchParams(keep); if (nextCursor) older.set("cursor", nextCursor);

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of critical actions. Entries cannot be edited or deleted by anyone. Newest first."
        actions={<a href={`/api/v1/audit/export${filtered ? `?${keep}` : ""}`} className={buttonClass("secondary", "sm")} download>Export CSV{filtered ? " (filtered)" : ""}</a>} />
      <form method="get" className="mb-4 grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter the audit log">
        <Field id="au-action" label="Action starts with"><Input name="action" defaultValue={filter.action ?? ""} placeholder="ROLE_" maxLength={60} /></Field>
        <Field id="au-type" label="Entity type"><Input name="type" defaultValue={filter.entityType ?? ""} placeholder="role" maxLength={60} /></Field>
        <Field id="au-outcome" label="Outcome"><Select name="outcome" defaultValue={filter.outcome ?? ""}><option value="">Any</option>{OUTCOMES.map((o) => <option key={o} value={o}>{o.toLowerCase()}</option>)}</Select></Field>
        <Field id="au-from" label="From"><Input type="date" name="from" defaultValue={filter.from ?? ""} /></Field>
        <Field id="au-to" label="To"><Input type="date" name="to" defaultValue={filter.to ?? ""} /></Field>
        <Field id="au-q" label="Entity id or words in the reason"><Input name="q" defaultValue={filter.q ?? ""} maxLength={100} /></Field>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className={buttonClass("primary", "sm")}>Apply filters</button>
          {filtered ? <Link href="/audit" className={buttonClass("secondary", "sm")}>Clear</Link> : null}
        </div>
      </form>
      <Card>
        <CardHeader title={`${rows.length}${nextCursor ? "+" : ""} event${rows.length === 1 ? "" : "s"}${cursor ? " on this page" : filtered ? " match" : " most recent"}`} />
        {rows.length === 0 ? <EmptyState title="No audit events match" /> : (
          <DataTable caption="Audit events" columns={[{ label: "When" }, { label: "Action" }, { label: "Entity" }, { label: "Role" }, { label: "Reason" }, { label: "Ref" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{wat(r.occurred_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                <td><span className="font-medium">{r.action}</span>{r.outcome !== "SUCCESS" ? <> <Badge tone="critical">{r.outcome}</Badge></> : null}</td>
                <td className="text-muted">{r.entity_type}</td>
                <td className="text-muted">{r.actor_role ?? "system"}</td>
                <td className="max-w-xs">{r.reason ?? ""}</td>
                <td className="font-mono text-xs text-muted">{r.correlation_id?.slice(0, 8) ?? ""}</td>
              </tr>
            ))}
          </DataTable>
        )}
        {nextCursor ? <p className="border-t border-line px-6 py-3"><Link href={`/audit?${older}`} className={buttonClass("secondary", "sm")}>Older events</Link></p> : null}
      </Card>
    </>
  );
}

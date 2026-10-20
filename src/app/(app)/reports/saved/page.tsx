import type { Metadata } from "next";
import Link from "next/link";
import { paramString } from "@/components/reports/filters";
import { wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { dbError } from "@/lib/data/errors";
import { reportById } from "@/lib/reports/catalogue";
import { userClient } from "@/lib/supabase/server";
import { DeleteSaved } from "./delete-saved";

export const metadata: Metadata = { title: "Saved reports" };

export default async function SavedPage() {
  const actor = await requireActor();
  if (!actor.permissions.has("reports.view")) return <Card><EmptyState title="Reports are not available for your role" /></Card>;
  const sb = await userClient();
  const [saved, snaps] = await Promise.all([
    sb.from("saved_reports").select("*").order("updated_at", { ascending: false }),
    sb.from("report_snapshots").select("id, report_id, title, definition_version, row_count, checksum, generated_at, note, params").order("generated_at", { ascending: false }).limit(100),
  ]);
  if (saved.error) throw dbError(saved.error, "saved reports");
  if (snaps.error) throw dbError(snaps.error, "snapshots");
  return (
    <>
      <PageHeader title="Saved reports and snapshots" description="Saved views hold a report and its filters, never data. Official snapshots are frozen, checksummed records of organisation-wide results."
        actions={<><Link href="/reports/builder" className={buttonClass("secondary", "sm")}>New in builder</Link><Link href="/reports" className={buttonClass("secondary", "sm")}>All reports</Link></>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Saved views (${saved.data?.length ?? 0})`} />
          {saved.data?.length ? (
            <ul className="divide-y divide-line">
              {saved.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                  <div>
                    <Link href={`/reports/${s.report_id}${paramString(s.params ?? {}, { ...(Array.isArray(s.columns) && s.columns.length ? { cols: s.columns.join(",") } : {}), ...(s.sort_by ? { sort: s.sort_by.key, dir: s.sort_by.dir } : {}) })}`} className="font-medium text-brand-700 underline">{s.name}</Link>
                    <p className="text-muted">{reportById(s.report_id)?.title ?? s.report_id} · updated {wat(s.updated_at)} {s.owner_id === actor.id ? (s.shared_with?.length ? `· shared with ${s.shared_with.length}` : "· private") : <Badge tone="info">Shared with you</Badge>}</p>
                  </div>
                  {s.owner_id === actor.id ? <DeleteSaved id={s.id} /> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No saved views yet">Open any report and choose “Save this view”.</EmptyState>}
        </Card>
        <Card>
          <CardHeader title={`Official snapshots (${snaps.data?.length ?? 0})`} description="Visible to holders of organisation-wide report access." />
          {snaps.data?.length ? (
            <ul className="divide-y divide-line">
              {snaps.data.map((s) => (
                <li key={s.id} className="px-6 py-3 text-sm">
                  <Link href={`/reports/snapshots/${s.id}`} className="font-medium text-brand-700 underline">{s.title}</Link>
                  <p className="text-muted">{reportById(s.report_id)?.title ?? s.report_id} · {s.row_count} rows · {s.definition_version} · {wat(s.generated_at)} · checksum <code className="font-mono text-xs">{String(s.checksum).slice(0, 12)}…</code></p>
                  {s.note ? <p className="text-muted">Note: {s.note}</p> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No snapshots yet">Snapshots are created from an organisation-wide report by an Admin, Executive or Director.</EmptyState>}
        </Card>
      </div>
    </>
  );
}

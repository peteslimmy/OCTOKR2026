import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/reports/sanitize";
import type { Metadata } from "next";
import Link from "next/link";
import { ResultBody } from "@/components/reports/report-view";
import { wat } from "@/components/status";
import { Badge, Banner, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { requireActor } from "@/lib/auth/actor";
import { dbError } from "@/lib/data/errors";
import type { ReportResult } from "@/lib/reports/types";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Report snapshot" };

export default async function SnapshotPage({ params }: PageProps<"/reports/snapshots/[id]">) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !actor.permissions.has("reports.view")) return <Card><EmptyState title="Snapshot not available" /></Card>;
  const sb = await userClient();
  const { data, error } = await sb.from("report_snapshots").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error, "snapshot");
  if (!data) return <Card><EmptyState title="Snapshot not found" action={<Link href="/reports/saved" className="text-sm text-brand-700 underline">Back to saved reports</Link>}>It may not exist, or it holds organisation-wide data your role cannot open.</EmptyState></Card>;
  const result = data.result as ReportResult;
  const recomputed = createHash("sha256").update(canonicalJson({ columns: result.columns, rows: result.rows, summary: result.summary })).digest("hex");
  const ok = recomputed === data.checksum;
  return (
    <>
      <PageHeader title={data.title} description={`Official snapshot of “${result.title}”, generated ${wat(data.generated_at)} (server time). Frozen: it will not change if the live data does.`}
        actions={<><ExecutiveCommentary module="HISTORICAL_REPORT" subjectLabel={data.title} /><Link href="/reports/saved" className={buttonClass("secondary", "sm")}>Saved and snapshots</Link></>} />
      <div className="space-y-6">
        <Banner tone={ok ? "done" : "critical"} title={ok ? "Checksum verified" : "Checksum mismatch: do not rely on this snapshot"}>
          <span className="font-mono text-xs break-all">{data.checksum}</span> · definition {data.definition_version} · {data.row_count} rows · scope {String(data.scope).toLowerCase()} · filters {JSON.stringify(data.params)}
          {data.note ? <> · note: {data.note}</> : null}
        </Banner>
        <Badge tone="locked">Historical record</Badge>
        <ResultBody result={result} />
      </div>
    </>
  );
}

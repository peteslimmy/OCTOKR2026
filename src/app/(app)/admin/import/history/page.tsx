import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { RollbackCard } from "../rollback-card";
import { HistoryWizard } from "./history-wizard";

export const metadata: Metadata = { title: "Import historical reports" };
interface Batch { id: string; file_name: string; rows: number; status: string; issues: number | null; created_at: string; committed_at: string | null; reports: number | null; goals: number | null; tasks: number | null }

export default async function Page() {
  const actor = await requireActor();
  if (!can(actor, "history.import")) return <Card><EmptyState title="Only a Super Admin can load historical reports" /></Card>;
  const sb = await userClient();
  const { data } = await sb.rpc("read_history_batches");
  const batches = (data ?? []) as Batch[];
  return (
    <>
      <PageHeader title="Import historical reports" description="Load past weekly reports from a spreadsheet. Scores are recomputed by the normal rules; nothing is copied from an old score and nobody is notified."
        actions={<Link href="/admin/import" className="text-sm text-brand-700 underline">Back to Import</Link>} />
      <div className="space-y-6">
        <HistoryWizard />
        <Card>
          <CardHeader title="Recent uploads" description="Every committed upload is kept as evidence and cannot be changed." />
          {!batches.length ? <EmptyState title="No uploads yet" /> : (
            <DataTable caption="Recent historical uploads" columns={[{ label: "Started" }, { label: "File" }, { label: "Rows" }, { label: "State" }, { label: "Reports" }, { label: "Goals" }, { label: "Tasks" }]}>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="whitespace-nowrap">{wat(b.created_at)}</td><td className="break-all">{b.file_name}</td><td className="tabular-nums">{b.rows}</td>
                  <td><Badge tone={b.status === "COMMITTED" ? "done" : "undefined"}>{b.status === "COMMITTED" ? "Imported" : b.status === "STAGED" ? "Checked, not imported" : b.status === "VOIDED" ? "Rolled back" : "Not finished"}</Badge></td>
                  <td className="tabular-nums">{b.reports ?? "—"}</td><td className="tabular-nums">{b.goals ?? "—"}</td><td className="tabular-nums">{b.tasks ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
        <RollbackCard kind="history" />
      </div>
    </>
  );
}

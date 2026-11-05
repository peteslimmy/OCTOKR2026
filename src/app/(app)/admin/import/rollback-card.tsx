import { wat } from "@/components/status";
import { Card, CardHeader, DataTable, EmptyState } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { VoidImportButton } from "./void-import-button";

type Kind = "strategy" | "history" | "signIns";
interface Row { id: string; file_name?: string; row_count?: number; user_count?: number; remaining?: number; status?: string; at: string | null; void_until: string | null; voided_at: string | null; void_reason?: string | null; voidable: boolean }

const COPY: Record<Kind, { title: string; endpoint: (id: string) => string; extra: string; perm: string }> = {
  strategy: { title: "Strategy imports", endpoint: (id) => `strategy-imports/${id}/void`, perm: "strategy.import",
    extra: "The objective, key results and Sub-KRs it added are archived and removed, and the quarters it created are removed, so they can be imported again." },
  history: { title: "Historical imports", endpoint: (id) => `history-imports/${id}/void`, perm: "history.import",
    extra: "The reports, goals, tasks, weeks, quarterly scores and placeholder strategy it created are removed, and the quarter and unit dates it changed are put back. The file can then be imported again." },
  signIns: { title: "Sign-in imports", endpoint: (id) => `sign-in-imports/${id}/void`, perm: "users.manage",
    extra: "The accounts it created are removed. It is refused if any of them has signed in, acted in the application or had its roles changed." },
};

/** Recent imports of one kind, with the Super Admin's roll-back button while the 72-hour window is open (ADR-087, ADR-088). The database refuses anyone else. */
export async function RollbackCard({ kind }: { kind: Kind }) {
  const actor = await requireActor();
  const copy = COPY[kind];
  if (!can(actor, copy.perm)) return null;
  const sb = await userClient();
  const { data } = await sb.rpc("read_rollbackable_imports");
  const rows = ((data as Record<string, Row[]> | null)?.[kind] ?? []) as Row[];
  const canVoid = can(actor, "history.import");            // the Super Admin tier; the database checks it again
  return (
    <Card>
      <CardHeader title={`Recent ${copy.title.toLowerCase()}`} description="A Super Admin can roll an import back for 72 hours after it was made. Nothing is lost: the audit trail and the rollback record stay." />
      {!rows.length ? <EmptyState title="Nothing imported yet" /> : (
        <DataTable caption={copy.title} columns={[{ label: "When" }, { label: kind === "signIns" ? "People" : "File" }, { label: "Rollback" }]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{r.at ? wat(r.at) : "—"}</td>
              <td className="break-all">{kind === "signIns" ? `${r.user_count} account(s), ${r.remaining} still present` : r.file_name}</td>
              <td>{r.voided_at ? <span title={r.void_reason ?? undefined}>Rolled back {wat(r.voided_at)}</span>
                : r.voidable && canVoid ? <VoidImportButton batchId={r.id} fileName={r.file_name ?? "this sign-in import"} until={r.void_until ? wat(r.void_until) : ""} endpoint={copy.endpoint(r.id)} extra={copy.extra} />
                : r.voidable ? `Until ${r.void_until ? wat(r.void_until) : ""}` : "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

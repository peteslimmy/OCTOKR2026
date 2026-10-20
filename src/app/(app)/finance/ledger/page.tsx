import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getLedger, listLedgerReversals } from "@/lib/data/governance";
import { ReversalButtons, ReversalQueue } from "./reversal-actions";

export const metadata: Metadata = { title: "Ledger" };

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));

export default async function LedgerPage() {
  const actor = await requireActor();
  if (!can(actor, "finance.ledger.view")) return <Card><EmptyState title="You do not have access to the ledger" /></Card>;
  const [rows, reversals] = await Promise.all([getLedger(200), listLedgerReversals()]);
  const canRequest = can(actor, "ledger.reversal.request"), canEmergency = can(actor, "ledger.reversal.emergency");
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));
  return (
    <>
      <PageHeader title="Ledger" description="Append-only. Entries are never edited or deleted; a correction is a compensating entry."
        actions={<Link href="/finance" className="rounded-lg border border-line bg-panel px-4 py-2 text-sm">Fund summary</Link>} />
      <Card>
        <CardHeader title={`${rows.length} most recent entries`} />
        {rows.length === 0 ? <EmptyState title="The ledger is empty">The first violation payment creates the first credit.</EmptyState> : (
          <DataTable caption="Violation fund ledger" columns={[{ label: "When" }, { label: "Type" }, { label: "Source" }, { label: "Reference" }, { label: "Amount", align: "right" }, { label: "Balance", align: "right" }, { label: "Correction", srOnly: true }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{wat(r.created_at)}</td>
                <td><Badge tone={r.entry_type === "CREDIT" ? "done" : "notdone"}>{r.entry_type === "CREDIT" ? "Credit (in)" : "Debit (out)"}</Badge></td>
                <td className="text-muted">{r.source_type.replace("_", " ").toLowerCase()}</td>
                <td className="font-mono text-xs text-muted">{r.reference.slice(0, 18)}</td>
                <td className="text-right tabular-nums">{r.entry_type === "DEBIT" ? "−" : "+"}{money(r.amount)}</td>
                <td className="text-right font-medium tabular-nums">{money(r.running_balance)}</td>
                <td className="text-right">
                  {r.reverses_entry_id ? <Badge tone="info">Reverses an earlier entry</Badge>
                    : r.reversed ? <Badge tone="undefined">Reversed</Badge>
                    : r.reversal_open ? <Badge tone="warn">Reversal in progress</Badge>
                    : (canRequest || canEmergency) ? <ReversalButtons id={r.id} reference={r.reference} canRequest={canRequest} canEmergency={canEmergency} /> : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Reversal requests" description="A wrong entry is never edited or deleted. It is cancelled by a new entry that points back to it: one person requests, a different person approves, and someone other than the requester posts it." />
        <ReversalQueue me={actor.id} canApprove={can(actor, "ledger.reversal.approve")} canExecute={can(actor, "ledger.reversal.execute")}
          items={reversals.map((r) => ({ id: r.id, status: r.status, emergency: r.emergency, reason: r.reason, entryReference: r.entry_reference, entryType: r.entry_type, amount: Number(r.amount),
            requestedBy: r.requested_by, requestedById: r.requested_by_id, decidedBy: r.decided_by, executedBy: r.executed_by, comment: r.decision_comment, reversalReference: r.reversal_reference, when: when(r.created_at) }))} />
      </Card>
    </>
  );
}

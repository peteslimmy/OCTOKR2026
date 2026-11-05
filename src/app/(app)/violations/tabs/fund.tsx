import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, Banner, Card, CardHeader, DataTable, EmptyState } from "@/components/ui/primitives";
import { can, type Actor } from "@/lib/auth/actor";
import { getFundSummary, getLedger, listDisbursements, listLedgerReversals, listPurposes } from "@/lib/data/governance";
import type { ModuleParams } from "../page";
import { NewRequestButton, RequestActions, ReviseRequestButton } from "../finance-actions";
import { RequestTrail } from "../request-trail";
import { ReversalButtons, ReversalQueue } from "../reversal-actions";

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));
const TONE = { SUBMITTED: "info", UNDER_REVIEW: "info", APPROVED: "warn", REJECTED: "critical", DISBURSED: "done", WITHDRAWN: "undefined" } as const;
const LABEL = { SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", APPROVED: "Approved · awaiting release", REJECTED: "Rejected", DISBURSED: "Disbursed", WITHDRAWN: "Withdrawn" } as const;

/** The money: the balance, requests for funds with their approval and release, and the append-only ledger. */
export async function FundTab({ actor, params }: { actor: Actor; params: ModuleParams }) {
  const canView = can(actor, "finance.fund.view"), canLedger = can(actor, "finance.ledger.view");
  const view = params.view === "ledger" && canLedger ? "ledger" : "requests";
  const [fund, requests, purposes] = await Promise.all([canView ? getFundSummary() : Promise.resolve(null), listDisbursements(), listPurposes()]);
  const queue = requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW");

  return (
    <div className="space-y-6">
      {fund ? (
        <section aria-label="Fund summary">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5"><p className="text-sm text-muted">Available to commit</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(fund.available)}</p>
              <p className="mt-1 text-xs text-muted">Ledger balance {money(fund.balance)} − approved, not yet released {money(fund.committed)}</p></Card>
            <Card className="p-5"><p className="text-sm text-muted">Inflows (payments)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(fund.inflow)}</p></Card>
            <Card className="p-5"><p className="text-sm text-muted">Outflows (released)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(fund.outflow)}</p></Card>
            <Card className="p-5"><p className="text-sm text-muted">Waiting for a decision</p><p className="mt-1 text-2xl font-semibold tabular-nums">{fund.pending_requests}</p>
              <p className="mt-1 text-xs text-muted">{fund.approved_awaiting_disbursement ?? 0} approved, awaiting release</p></Card>
          </div>
          {fund.reconciled ? <p className="mt-3 text-sm text-[var(--done-fg)]">✓ Reconciled: ledger balance equals recorded payments minus recorded disbursements.</p>
            : <div className="mt-3"><Banner tone="critical" title="Reconciliation mismatch">The ledger does not match the recorded payments and disbursements. Do not release funds until this is investigated.</Banner></div>}
        </section>
      ) : null}

      {canLedger ? (
        <div className="flex gap-2" role="group" aria-label="Fund views">
          {([["requests", "Requests"], ["ledger", "Ledger"]] as const).map(([id, label]) => (
            <Link key={id} href={`/violations?tab=fund&view=${id}`} aria-current={view === id ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${view === id ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`}>{label}</Link>
          ))}
        </div>
      ) : null}

      {view === "requests" ? (
        <Card>
          <CardHeader title={`Fund requests (${requests.length})`} description={queue.length ? `${queue.length} waiting for a decision` : "A request names an amount, a purpose and a justification; Finance decides; release is a separate step."}
            action={can(actor, "disbursement.create") ? <NewRequestButton available={fund ? Number(fund.available) : null} purposes={purposes.filter((p) => p.active).map((p) => p.name)} /> : undefined} />
          {requests.length === 0 ? <EmptyState title="No requests for funds yet">HR or Admin raises a request with the amount, purpose and justification; Finance decides.</EmptyState> : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {requests.map((r) => (
                <li key={r.id} className="space-y-2 px-6 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-semibold tabular-nums">{money(r.amount)} <span className="text-sm font-normal text-muted">· {r.purpose}</span></p>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  </div>
                  <p><span className="text-xs text-muted">Justification</span><br />{r.justification}</p>
                  <RequestTrail r={r} />
                  {r.status === "REJECTED" && r.requested_by === actor.id && !r.resubmitted_as && can(actor, "disbursement.create")
                    ? <ReviseRequestButton id={r.id} amount={Number(r.amount)} purpose={r.purpose} justification={r.justification} reason={r.decision?.reason ?? null}
                        available={fund ? Number(fund.available) : null} purposes={purposes.filter((p) => p.active).map((p) => p.name)} /> : null}
                  <RequestActions id={r.id} status={r.status} amount={money(r.amount)} mine={r.requested_by === actor.id}
                    canDecide={can(actor, "disbursement.approve")} canReject={can(actor, "disbursement.reject")} canDisburse={can(actor, "disbursement.disburse")}
                    balanceAfter={fund ? money(Number(fund.available) - Number(r.amount)) : null} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : <Ledger actor={actor} />}
    </div>
  );
}

async function Ledger({ actor }: { actor: Actor }) {
  const [rows, reversals] = await Promise.all([getLedger(200), listLedgerReversals()]);
  const canRequest = can(actor, "ledger.reversal.request"), canEmergency = can(actor, "ledger.reversal.emergency");
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));
  return (
    <>
      <Card>
        <CardHeader title={`Ledger: ${rows.length} most recent entries`} description="Append-only. Entries are never edited or deleted; a correction is a compensating entry." />
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
      <Card>
        <CardHeader title="Reversal requests" description="A wrong entry is never edited or deleted. It is cancelled by a new entry that points back to it: one person requests, a different person approves, someone else posts it." />
        <ReversalQueue me={actor.id} canApprove={can(actor, "ledger.reversal.approve")} canExecute={can(actor, "ledger.reversal.execute")}
          items={reversals.map((r) => ({ id: r.id, status: r.status, emergency: r.emergency, reason: r.reason, entryReference: r.entry_reference, entryType: r.entry_type, amount: Number(r.amount),
            requestedBy: r.requested_by, requestedById: r.requested_by_id, decidedBy: r.decided_by, executedBy: r.executed_by, comment: r.decision_comment, reversalReference: r.reversal_reference, when: when(r.created_at) }))} />
      </Card>
    </>
  );
}

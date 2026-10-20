import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, Banner, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getFundSummary, listDisbursements } from "@/lib/data/governance";
import { NewRequestButton, RequestActions } from "./finance-actions";

export const metadata: Metadata = { title: "Finance" };

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));
const TONE = { SUBMITTED: "info", UNDER_REVIEW: "info", APPROVED: "warn", REJECTED: "critical", DISBURSED: "done" } as const;
const LABEL = { SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", APPROVED: "Approved · awaiting release", REJECTED: "Rejected", DISBURSED: "Disbursed" } as const;

export default async function FinancePage() {
  const actor = await requireActor();
  if (!can(actor, "finance.fund.view") && !can(actor, "disbursement.create")) {
    return <Card><EmptyState title="Finance is not available for your role" /></Card>;
  }
  const canView = can(actor, "finance.fund.view");
  const [fund, requests] = await Promise.all([canView ? getFundSummary() : Promise.resolve(null), listDisbursements()]);
  const queue = requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW");

  return (
    <>
      <PageHeader title="Violation fund" description="All amounts are in Nigerian Naira. The ledger is authoritative and append-only; approval and cash release are separate steps."
        actions={<>
          {can(actor, "disbursement.create") ? <NewRequestButton available={fund ? Number(fund.available) : null} /> : null}
          {can(actor, "finance.ledger.view") ? <Link href="/finance/ledger" className={buttonClass("secondary", "sm")}>Ledger</Link> : null}
        </>} />
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

        <Card>
          <CardHeader title={`Disbursement requests (${requests.length})`} description={queue.length ? `${queue.length} waiting for a decision` : undefined} />
          {requests.length === 0 ? <EmptyState title="No disbursement requests yet">HR or Admin raises a request with the amount, purpose and justification; Finance decides.</EmptyState> : (
            <ul className="divide-y divide-line">
              {requests.map((r) => (
                <li key={r.id} className="space-y-2 px-6 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-semibold tabular-nums">{money(r.amount)} <span className="text-sm font-normal text-muted">· {r.purpose}</span></p>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  </div>
                  <p className="text-muted">{r.justification}</p>
                  <p className="text-xs text-muted">Requested by {r.requester_name} · {wat(r.created_at)}</p>
                  {r.decision ? <p className="text-xs text-muted">{r.decision.decision === "APPROVED" ? "Approved" : "Rejected"} by {r.decision.by} · {wat(r.decision.at)}{r.decision.reason ? ` · “${r.decision.reason}”` : ""}</p> : null}
                  {r.disbursement ? <p className="text-xs text-muted">Released · reference {r.disbursement.reference} · {wat(r.disbursement.at)}</p> : null}
                  <RequestActions id={r.id} status={r.status} amount={money(r.amount)} mine={r.requested_by === actor.id}
                    canDecide={can(actor, "disbursement.approve")} canReject={can(actor, "disbursement.reject")} canDisburse={can(actor, "disbursement.disburse")}
                    balanceAfter={fund ? money(Number(fund.available) - Number(r.amount)) : null} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

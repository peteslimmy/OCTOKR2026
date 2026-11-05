import Link from "next/link";
import { Badge, Banner, Card, CardHeader, DataTable, EmptyState } from "@/components/ui/primitives";
import { can, type Actor } from "@/lib/auth/actor";
import { fundSummaryOrNull, getLedger, listDisbursements, listViolations } from "@/lib/data/governance";
import { serverNow } from "@/lib/data";
import { buildViolationOverview, type Severity } from "@/lib/insights/violation-overview";
import { FundChart } from "../fund-chart";

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(n));
const SEV: Record<Severity, { label: string; tone: "critical" | "warn" | "info" | "done" }> = { high: { label: "Act", tone: "critical" }, medium: { label: "Watch", tone: "warn" }, low: { label: "Note", tone: "info" }, good: { label: "Good", tone: "done" } };
const KIND: Record<string, string> = { violation: "Violation", payment: "Payment", void: "Voided", request: "Request", decision: "Decision", release: "Released" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(iso));
const attempt = async <T,>(fn: () => Promise<T>, fallback: T) => { try { return await fn(); } catch { return fallback; } };

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = <><p className="text-sm text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}</>;
  return href ? <Link href={href} className="block rounded-xl border border-line bg-panel p-5 shadow-[var(--shadow-card)] hover:border-brand-700">{body}</Link> : <Card className="p-5">{body}</Card>;
}

/** Money in and out, violations raised and collected, what is happening now, and what to look at. */
export async function OverviewTab({ actor }: { actor: Actor }) {
  const canViolations = can(actor, "violation.create") || can(actor, "violation.edit") || can(actor, "violation.payment.record") || can(actor, "dashboard.executive.view");
  const canFund = can(actor, "finance.fund.view");
  const [fund, violations, requests, ledger, now] = await Promise.all([
    canFund ? fundSummaryOrNull() : Promise.resolve(null), canViolations ? attempt(listViolations, []) : Promise.resolve([]),
    attempt(listDisbursements, []), can(actor, "finance.ledger.view") ? attempt(() => getLedger(1000), []) : Promise.resolve([]), serverNow(),
  ]);
  const o = buildViolationOverview({
    now, balance: fund ? Number(fund.balance) : null,
    violations: violations.map((v) => ({ id: v.id, employee: v.employee_name, unit: v.business_unit, type: v.type, criticality: v.criticality, fine: Number(v.fine_amount), status: v.status, createdAt: v.created_at, paidAt: v.payment?.paid_at ?? null, voidedAt: v.voided_at ?? null })),
    requests: requests.map((r) => ({ id: r.id, amount: Number(r.amount), purpose: r.purpose, status: r.status, createdAt: r.created_at, decidedAt: r.decision?.at ?? null, releasedAt: r.disbursement?.at ?? null, requester: r.requester_name })),
    ledger: ledger.map((l) => ({ type: l.entry_type, amount: Number(l.amount), createdAt: l.created_at, reference: l.reference })),
  });

  return (
    <div className="space-y-6">
      {fund ? (
        <section aria-label="The fund" className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Available to commit" value={money(fund.available)} note={`Ledger balance ${money(fund.balance)}`} href="/violations?tab=fund" />
            <Tile label="Money in" value={money(fund.inflow)} note="Violation payments received" href="/violations?tab=fund&view=ledger" />
            <Tile label="Money out" value={money(fund.outflow)} note="Released to requests" href="/violations?tab=fund&view=ledger" />
            <Tile label="Fund lasts about" value={o.runwayMonths === null ? "—" : `${o.runwayMonths.toFixed(1)} months`} note={o.avgMonthlyOutflow ? `At ${money(o.avgMonthlyOutflow)} a month` : "Nothing spent in recent months"} />
          </div>
          {!fund.reconciled ? <Banner tone="critical" title="Reconciliation mismatch">The ledger does not match the recorded payments and disbursements. Do not release funds until this is investigated.</Banner> : null}
        </section>
      ) : null}

      {canViolations ? (
        <section aria-label="Violations" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Violations raised" value={String(o.counts.total - o.counts.void)} note={`${o.counts.thisMonth} this month · ${o.counts.lastMonth} last month`} href="/violations?tab=violations" />
          <Tile label="Pending payment" value={String(o.counts.open)} note={`${money(o.money.outstanding)} outstanding`} href="/violations?tab=violations&status=OPEN" />
          <Tile label="Collection rate" value={o.money.collectionRate === null ? "—" : `${o.money.collectionRate.toFixed(0)}%`} note={`${money(o.money.collected)} of ${money(o.money.raised)} collected`} />
          <Tile label="Unpaid over 30 days" value={String(o.ageing.over30)} note={o.ageing.oldestDays === null ? "Nothing unpaid" : `Oldest ${o.ageing.oldestDays} days`} href="/violations?tab=violations&status=OPEN&overdue=1" />
        </section>
      ) : null}

      <Card>
        <CardHeader title="What to look at" description="Fixed rules over the figures on this page: where fines are slow to come in, where violations are rising, and what is waiting." />
        {o.insights.length === 0 ? <EmptyState title="Nothing to report yet">Insights appear as violations are raised and the fund is used.</EmptyState> : (
          <ul className="divide-y divide-line">{o.insights.map((i, k) => <li key={k} className="flex items-start gap-3 px-6 py-3 text-sm"><Badge tone={SEV[i.severity].tone}>{SEV[i.severity].label}</Badge><span>{i.text}</span></li>)}</ul>
        )}
      </Card>

      {ledger.length ? (
        <Card>
          <CardHeader title="Money in and out" description="By month, for the last six months." />
          <div className="px-4 py-3"><FundChart data={o.monthly.map((m) => ({ label: m.label, credit: m.credit, debit: m.debit }))} /></div>
        </Card>
      ) : null}

      {canViolations && o.counts.total > 0 ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader title="By type" />
            <DataTable caption="Violations by type" columns={[{ label: "Type" }, { label: "Count", align: "right" }, { label: "Fines", align: "right" }]} maxHeight="18rem">
              {o.byType.map((t) => <tr key={t.name} className="border-b border-line last:border-0"><td>{t.name}</td><td className="text-right tabular-nums">{t.count}</td><td className="text-right tabular-nums">{money(t.amount)}</td></tr>)}
            </DataTable>
          </Card>
          <Card>
            <CardHeader title="By unit" />
            <DataTable caption="Violations by unit" columns={[{ label: "Unit" }, { label: "Count", align: "right" }, { label: "Fines", align: "right" }]} maxHeight="18rem">
              {o.byUnit.map((t) => <tr key={t.name} className="border-b border-line last:border-0"><td>{t.name}</td><td className="text-right tabular-nums">{t.count}</td><td className="text-right tabular-nums">{money(t.amount)}</td></tr>)}
            </DataTable>
          </Card>
          <Card>
            <CardHeader title="Unpaid, by age and repeat violations" />
            <dl className="grid grid-cols-3 gap-2 px-6 py-3 text-center text-sm">
              <div><dt className="text-xs text-muted">Under a week</dt><dd className="text-xl font-semibold tabular-nums">{o.ageing.under7}</dd></div>
              <div><dt className="text-xs text-muted">A week to a month</dt><dd className="text-xl font-semibold tabular-nums">{o.ageing.from7to30}</dd></div>
              <div><dt className="text-xs text-muted">Over a month</dt><dd className="text-xl font-semibold tabular-nums">{o.ageing.over30}</dd></div>
            </dl>
            <div className="border-t border-line px-6 py-3 text-sm">
              <p className="mb-1 font-medium">More than one in 90 days</p>
              {o.repeat.length === 0 ? <p className="text-muted">Nobody.</p> : <ul className="text-muted">{o.repeat.map((r) => <li key={`${r.name}${r.unit}`}>{r.name} ({r.unit}): {r.count}</li>)}</ul>}
            </div>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Recent activity" description="Violations, payments, requests, decisions and releases, newest first." />
        {o.activity.length === 0 ? <EmptyState title="No activity yet" /> : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {o.activity.map((a, k) => <li key={k} className="flex items-start gap-3 px-6 py-2.5 text-sm"><span className="w-28 shrink-0 text-xs text-muted">{when(a.at)}</span><Badge tone={a.kind === "payment" || a.kind === "release" ? "done" : a.kind === "void" ? "undefined" : "info"}>{KIND[a.kind]}</Badge><span>{a.text}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

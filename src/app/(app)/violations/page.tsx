import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { FundTab } from "./tabs/fund";
import { OverviewTab } from "./tabs/overview";
import { SettingsTab } from "./tabs/settings";
import { ViolationsTab } from "./tabs/violations";

export const metadata: Metadata = { title: "Violations & Funds" };

export interface ModuleParams { tab?: string; status?: string; unit?: string; view?: string; overdue?: string; new?: string }

/**
 * Violations and the violation fund, as one story: a rule is broken, a fine is raised, it is paid into the fund, and the fund is spent.
 * Four tabs. A person sees only the tabs their permissions allow, so HR works in Violations, Finance in Fund, and the Overview serves both.
 */
export default async function ViolationsModule({ searchParams }: { searchParams: Promise<ModuleParams> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const any = (...p: string[]) => p.some((x) => can(actor, x));
  const tabs = [
    { id: "overview", label: "Overview", show: any("violation.create", "violation.edit", "violation.payment.record", "finance.fund.view", "dashboard.executive.view", "disbursement.create") },
    { id: "violations", label: "Violations", show: any("violation.create", "violation.edit", "violation.payment.record", "violation.void") },
    { id: "fund", label: "Fund", show: any("finance.fund.view", "disbursement.create", "finance.ledger.view") },
    { id: "settings", label: "Settings", show: any("violation.edit", "finance.purpose.manage") },
  ].filter((t) => t.show);
  if (!tabs.length) return <Card><EmptyState title="Violations & Funds is not available for your role" /></Card>;
  const active = tabs.find((t) => t.id === sp.tab)?.id ?? tabs[0].id;

  return (
    <>
      <PageHeader title="Violations & Funds" description="Fines are in Nigerian Naira. A payment, the violation and the fund's ledger credit are recorded together or not at all; the ledger is append-only." />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Violations and Funds sections">
        {tabs.map((t) => (
          <Link key={t.id} href={`/violations?tab=${t.id}`} aria-current={active === t.id ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${active === t.id ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel hover:bg-surface"}`}>{t.label}</Link>
        ))}
      </nav>
      <Suspense key={JSON.stringify([active, sp.status, sp.unit, sp.view, sp.overdue, sp.new])} fallback={<div className="space-y-4" role="status" aria-label="Loading"><div className="shimmer h-40 rounded-2xl" /><div className="shimmer h-72 rounded-2xl" /></div>}>
        {active === "overview" ? <OverviewTab actor={actor} /> : null}
        {active === "violations" ? <ViolationsTab actor={actor} params={sp} /> : null}
        {active === "fund" ? <FundTab actor={actor} params={sp} /> : null}
        {active === "settings" ? <SettingsTab actor={actor} /> : null}
      </Suspense>
    </>
  );
}

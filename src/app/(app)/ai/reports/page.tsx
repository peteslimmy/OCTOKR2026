import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { availableReports } from "@/lib/ai/reports";
import { aiModuleStatus } from "@/lib/ai/status";
import { AiTabs } from "../ai-tabs";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Reports · 4COREPAL" };

export default async function ReportsPage() {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.insights.org") && !can(actor, "ai.insights.bu")) return <Notice><EmptyState title="Reports are not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const asker = { id: actor.id, buId: actor.buId, permissions: actor.permissions };
  const reports = availableReports(asker);
  return (
    <>
      <PageHeader title="Reports" description="Reports built from the application's own records and forecasting rules. Every figure is a recorded or calculated one; the wording that says what changed is fixed from those figures. An optional written explanation, if you ask for it, is shown only when every figure in it is in the report." />
      <AiTabs current="reports" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <li key={r.id}><Link href={`/ai/reports/${r.id}`} className="block h-full rounded-xl border border-line bg-panel p-4 hover:bg-surface">
            <p className="font-medium">{r.title}</p><p className="mt-1 text-sm text-muted">{r.description}</p><p className="mt-2 text-xs text-muted">{r.scope === "organisation" ? "Whole organisation" : r.scope === "unit" ? "One unit" : "Organisation, or one unit"}</p>
          </Link></li>
        ))}
      </ul>
    </>
  );
}

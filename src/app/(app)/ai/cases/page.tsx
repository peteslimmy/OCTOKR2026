import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../ai-tabs";
import { SEVERITY, STATUS_LABEL } from "../case-labels";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Cases · 4COREPAL" };
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
type Rel<T> = T | T[] | null;
type Row = { id: string; reference: string; title: string; category: string; severity: string; status: string; detected_at: string; response_due_at: string | null; business_units: Rel<{ name: string }> };
const one = <T,>(v: Rel<T>): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.case.view")) return <Notice><EmptyState title="Cases are not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const sp = await searchParams;
  const openOnly = sp.show !== "all";
  const sb = await userClient();
  let q = sb.from("ai_cases").select("id, reference, title, category, severity, status, detected_at, response_due_at, business_units!ai_cases_business_unit_id_fkey(name)").order("detected_at", { ascending: false }).limit(100);
  if (openOnly) q = q.not("status", "in", "(RESOLVED,CLOSED)");
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Performance intelligence cases" description="Each case records what was noticed, the evidence as it was then, who was asked and what they said, what was agreed and how it ended. A cause is a hypothesis until the data confirms it." />
      <AiTabs current="cases" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <div className="mb-3 flex gap-3 text-sm"><Link href="/ai/cases" className={openOnly ? "font-semibold underline" : "underline"}>Open cases</Link><Link href="/ai/cases?show=all" className={!openOnly ? "font-semibold underline" : "underline"}>All cases</Link></div>
      <Card>
        {rows.length === 0 ? <EmptyState title={openOnly ? "No open cases" : "No cases yet"}>Cases open when the daily review finds something that needs a response.</EmptyState> : (
          <DataTable caption="Cases" columns={[{ label: "Reference" }, { label: "Case" }, { label: "Unit" }, { label: "Severity" }, { label: "Status" }, { label: "Detected" }, { label: "Response due" }]} maxHeight="38rem">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs"><Link href={`/ai/cases/${r.id}`} className="text-brand-700 underline">{r.reference}</Link></td>
                <td className="max-w-md font-medium">{r.title}</td><td>{one(r.business_units)?.name ?? "Organisation"}</td>
                <td><Badge tone={SEVERITY[r.severity] ?? "info"}>{r.severity.toLowerCase()}</Badge></td><td>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="text-muted">{day(r.detected_at)}</td><td className="text-muted">{r.response_due_at ? day(r.response_due_at) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}

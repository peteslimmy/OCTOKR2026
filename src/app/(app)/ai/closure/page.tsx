import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../ai-tabs";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Closure · 4COREPAL" };
const TONE: Record<string, "warn" | "done" | "critical" | "info"> = { PENDING: "warn", PARTIAL: "info", ANSWERED: "done", ESCALATED: "critical" };
const LABEL: Record<string, string> = { PENDING: "Waiting for answers", PARTIAL: "Partly answered", ANSWERED: "Answered", ESCALATED: "Escalated to executives" };
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
const month = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
type Rel<T> = T | T[] | null;
type Row = { id: string; status: string; goal_count: number; month: string; due_at: string; business_unit_id: string; business_units: Rel<{ name: string }> };
const one = <T,>(v: Rel<T>): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

export default async function ClosurePage() {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.assistant.use") && !can(actor, "ai.remark.submit") && !can(actor, "ai.insights.org")) return <Notice><EmptyState title="4COREPAL is not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.from("ai_closure_requests").select("id, status, goal_count, month, due_at, business_unit_id, business_units(name)").order("month", { ascending: false }).limit(48);
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Monthly review of open activities" description="On the last day of each month, goals that were set again and again without being finished are put to the unit: finished but not recorded, still in progress, partly done, stepped down, no longer needed, deferred, blocked or changed in scope. Nothing is cancelled or changed by an answer until a different person has approved it." />
      <AiTabs current="closure" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <Card>
        {rows.length === 0 ? <EmptyState title="No review yet">The first one is sent on the last day of a month in which a goal has been carried forward without being finished.</EmptyState> : (
          <DataTable caption="Monthly reviews" columns={[{ label: "Month" }, { label: "Unit" }, { label: "Goals", align: "right" }, { label: "Status" }, { label: "Due" }, { label: "Action", srOnly: true }]} maxHeight="36rem">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{month(r.month)}</td><td>{one(r.business_units)?.name}</td><td className="text-right tabular-nums">{r.goal_count}</td>
                <td><Badge tone={TONE[r.status] ?? "info"}>{LABEL[r.status] ?? r.status}</Badge></td><td className="text-muted">{day(r.due_at)}</td>
                <td><Link href={`/ai/closure/${r.id}`} className="text-brand-700 underline">{can(actor, "ai.remark.submit") && actor.buId === r.business_unit_id && r.status !== "ANSWERED" ? "Answer" : "View"}</Link></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}

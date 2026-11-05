import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../ai-tabs";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Remarks · 4COREPAL" };
const TONE: Record<string, "warn" | "done" | "critical" | "info"> = { PENDING: "warn", PARTIAL: "info", ANSWERED: "done", ESCALATED: "critical", EXPIRED: "critical" };
const LABEL: Record<string, string> = { PENDING: "Waiting for remarks", PARTIAL: "Partly answered", ANSWERED: "Answered", ESCALATED: "Escalated to executives", EXPIRED: "Expired" };
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
type Rel<T> = T | T[] | null;
type Row = { id: string; status: string; task_count: number; requested_at: string; due_at: string; business_unit_id: string; business_units: Rel<{ name: string }>; reporting_weeks: Rel<{ week_number: number }> };
const one = <T,>(v: Rel<T>): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

export default async function RemarksPage() {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.assistant.use") && !can(actor, "ai.remark.submit") && !can(actor, "ai.insights.org")) return <Notice><EmptyState title="4COREPAL is not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.from("ai_remark_requests").select("id, status, task_count, requested_at, due_at, business_unit_id, business_units(name), reporting_weeks(week_number)").order("requested_at", { ascending: false }).limit(60);
  const rows = (data ?? []) as unknown as Row[];
  const mine = (r: Row) => can(actor, "ai.remark.submit") && actor.buId === r.business_unit_id;
  return (
    <>
      <PageHeader title="Remarks on tasks that were not done" description="After a week closes, tasks that were not done get a reason from the unit that owned them: blocked, waiting on another team, no longer needed, or simply not finished. A remark is an explanation for the record. It never changes a task, a score or a closed week." />
      <AiTabs current="remarks" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing needs a remark">When a finished week has tasks that were not done, the unit lead is asked here and by email.</EmptyState> : (
          <DataTable caption="Remark requests" columns={[{ label: "Unit" }, { label: "Week" }, { label: "Tasks", align: "right" }, { label: "Status" }, { label: "Asked" }, { label: "Due" }, { label: "Action", srOnly: true }]} maxHeight="36rem">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{one(r.business_units)?.name ?? "—"}</td><td>Week {one(r.reporting_weeks)?.week_number ?? "—"}</td><td className="text-right tabular-nums">{r.task_count}</td>
                <td><Badge tone={TONE[r.status] ?? "info"}>{LABEL[r.status] ?? r.status}</Badge></td><td className="text-muted">{day(r.requested_at)}</td><td className="text-muted">{day(r.due_at)}</td>
                <td><Link href={`/ai/remarks/${r.id}`} className="text-brand-700 underline">{mine(r) && r.status !== "ANSWERED" ? "Give remarks" : "View"}</Link></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}

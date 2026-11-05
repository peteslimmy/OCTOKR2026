import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../../ai-tabs";
import { RemarkForm, type FormTask } from "./remark-form";
import { Notice } from "../../notice";

export const metadata: Metadata = { title: "Give remarks · 4COREPAL" };
interface Req { id: string; status: string; dueAt: string; requestedAt: string; businessUnitId: string; unit: string; weekNumber: number; weekStart: string; weekEnd: string; tasks: FormTask[] }
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
const STATUS: Record<string, { label: string; tone: "done" | "critical" | "warn" }> = { ANSWERED: { label: "Answered", tone: "done" }, ESCALATED: { label: "Escalated", tone: "critical" }, PARTIAL: { label: "Partly answered", tone: "warn" }, PENDING: { label: "Waiting", tone: "warn" } };

export default async function RemarkRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  const { id } = await params;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice><EmptyState title="That request was not found" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.rpc("read_ai_remark_request", { p_request: id });
  const r = data as Req | null;
  if (!r) return <Notice><EmptyState title="That request was not found, or it belongs to another unit"><Link href="/ai/remarks" className="underline">Back to remarks</Link></EmptyState></Notice>;
  const canAnswer = can(actor, "ai.remark.submit") && actor.buId === r.businessUnitId && r.status !== "ANSWERED";
  const tasks = r.tasks;
  const st = STATUS[r.status] ?? STATUS.PENDING;
  return (
    <>
      <PageHeader title={`${r.unit}: week ${r.weekNumber}`} description={`Tasks set for ${day(r.weekStart)} to ${day(r.weekEnd)} that were not done. Each was due at the end of that week.`} actions={<Link href="/ai/remarks" className="text-sm underline">All requests</Link>} />
      <AiTabs current="remarks" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <Card>
        <CardHeader title={`${tasks.filter((t) => !t.reasonCode).length} of ${tasks.length} still need a remark`} description={`Asked ${day(r.requestedAt)}, due ${day(r.dueAt)}.`} action={<Badge tone={st.tone}>{st.label}</Badge>} />
        {tasks.length === 0 ? <EmptyState title="No tasks on this request" /> : <RemarkForm requestId={r.id} tasks={tasks} canAnswer={canAnswer} />}
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../../ai-tabs";
import { ClosureForm, type Item } from "./closure-form";
import { Notice } from "../../notice";

export const metadata: Metadata = { title: "Monthly review · 4COREPAL" };
interface Req { id: string; status: string; dueAt: string; requestedAt: string; businessUnitId: string; unit: string; month: string; items: Item[] }
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
const month = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const ST: Record<string, { label: string; tone: "done" | "critical" | "warn" }> = { ANSWERED: { label: "Answered", tone: "done" }, ESCALATED: { label: "Escalated", tone: "critical" }, PARTIAL: { label: "Partly answered", tone: "warn" }, PENDING: { label: "Waiting", tone: "warn" } };

export default async function ClosureRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  const { id } = await params;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice><EmptyState title="That review was not found" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.rpc("read_ai_closure_request", { p_request: id });
  const r = data as Req | null;
  if (!r) return <Notice><EmptyState title="That review was not found, or it belongs to another unit"><Link href="/ai/closure" className="underline">Back to reviews</Link></EmptyState></Notice>;
  const canAnswer = can(actor, "ai.remark.submit") && actor.buId === r.businessUnitId && r.status !== "ANSWERED";
  const st = ST[r.status] ?? ST.PENDING;
  return (
    <>
      <PageHeader title={`${r.unit}: review of ${month(r.month)}`} description="Goals set again and again with the same wording without being finished. Tell management what should happen to each." actions={<Link href="/ai/closure" className="text-sm underline">All reviews</Link>} />
      <AiTabs current="closure" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <Card>
        <CardHeader title={`${r.items.filter((i) => !i.option).length} of ${r.items.length} goals still need an answer`} description={`Asked ${day(r.requestedAt)}, due ${day(r.dueAt)}.`} action={<Badge tone={st.tone}>{st.label}</Badge>} />
        <ClosureForm requestId={r.id} items={r.items} canAnswer={canAnswer} />
      </Card>
    </>
  );
}

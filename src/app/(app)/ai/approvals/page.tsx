import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../ai-tabs";
import { DecideButtons } from "./decide-buttons";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Approvals · 4COREPAL" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));
type Appr = { id: string; action_type: string; subject_type: string; subject_id: string | null; proposal: Record<string, unknown>; case_id: string | null; requested_by: string | null; by_agent: boolean; status: string; decided_at: string | null; decision_note: string | null; created_at: string };
const OPTION: Record<string, string> = { COMPLETED_NOT_RECORDED: "finished but not recorded", PARTIALLY_COMPLETED: "partly done", STEPPED_DOWN: "stepped down", NO_LONGER_REQUIRED: "no longer required", DEFERRED: "deferred", SCOPE_CHANGED: "scope changed" };

export default async function ApprovalsPage() {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.approval.decide")) return <Notice><EmptyState title="Approvals are for the people who decide what the agent and the units propose" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.from("ai_approvals").select("*").order("created_at", { ascending: false }).limit(60);
  const all = (data ?? []) as Appr[];
  const pending = all.filter((a) => a.status === "PENDING"), decided = all.filter((a) => a.status !== "PENDING").slice(0, 15);
  const text = (a: Appr) => a.subject_type === "disposition"
    ? `${String(a.proposal.title ?? "A goal")}: ${OPTION[String(a.proposal.option)] ?? String(a.proposal.option)}. ${String(a.proposal.explanation ?? "")}`
    : `Corrective plan: ${String(a.proposal.intervention ?? "")}`;
  return (
    <>
      <PageHeader title="Approvals" description="What the units and the agent propose, waiting for a decision. Nothing here changes an official goal, target or score, and nobody decides their own proposal." />
      <AiTabs current="approvals" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <Card>
        <CardHeader title={`${pending.length} waiting`} />
        {pending.length === 0 ? <EmptyState title="Nothing is waiting for a decision" /> : (
          <ul className="divide-y divide-line">
            {pending.map((a) => (
              <li key={a.id} className="grid gap-3 px-6 py-4 text-sm md:grid-cols-[1fr_18rem]">
                <div><p className="flex flex-wrap items-center gap-2"><Badge tone={a.subject_type === "disposition" ? "info" : "brand"}>{a.subject_type === "disposition" ? "Open activity" : "Corrective plan"}</Badge><span className="text-xs text-muted">{when(a.created_at)}{a.by_agent ? ", proposed by the agent" : ""}</span></p>
                  <p className="mt-1">{text(a)}</p>{a.case_id ? <p className="mt-1 text-xs"><Link href={`/ai/cases/${a.case_id}`} className="text-brand-700 underline">Open the case</Link></p> : null}</div>
                <DecideButtons approvalId={a.id} mine={a.requested_by === actor.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {decided.length ? (
        <Card className="mt-4">
          <CardHeader title="Recently decided" />
          <ul className="divide-y divide-line">{decided.map((a) => <li key={a.id} className="px-6 py-3 text-sm"><Badge tone={a.status === "REJECTED" ? "critical" : "done"}>{a.status.toLowerCase()}</Badge> <span className="ml-1">{text(a)}</span>{a.decided_at ? <span className="text-xs text-muted"> {when(a.decided_at)}</span> : null}{a.decision_note ? <p className="mt-0.5 text-xs text-muted">{a.decision_note}</p> : null}</li>)}</ul>
        </Card>
      ) : null}
    </>
  );
}

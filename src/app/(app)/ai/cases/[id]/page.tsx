import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { aiModuleStatus } from "@/lib/ai/status";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "../../ai-tabs";
import { CATEGORY_LABEL, EVENT_LABEL, SEVERITY, STATUS_LABEL } from "../../case-labels";
import { ActionStatusButtons, AddActionForm, ManageForm, RespondForm, SubmitPlanButton } from "./case-actions";
import { Notice } from "../../notice";

export const metadata: Metadata = { title: "Case · 4COREPAL" };
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(iso));
type Hyp = { text: string; status: string; basis?: string };
type Case = { id: string; reference: string; title: string; category: string; description: string; severity: string; status: string; assessment: string; hypotheses: Hyp[] | Record<string, never>; recommendation: string; detected_at: string; response_due_at: string | null; responded_at: string | null; resolution: string | null; business_unit_id: string | null; assigned_bu_id: string | null; created_by_agent: boolean };
type Ev = { id: string; kind: string; summary: string; captured_value: unknown; captured_at: string };
type Evt = { id: string; seq: number; event_type: string; by_agent: boolean; detail: Record<string, unknown>; occurred_at: string };
type Plan = { id: string; status: string; problem: string; root_cause_assessment: string; intervention: string; expected_outcome: string; success_measure: string; target_date: string | null; review_date: string | null; baseline_score: number | null; review_score: number | null; effectiveness: string | null; owner_bu_id: string | null; created_by_agent: boolean; decision_note: string | null };
type Act = { id: string; plan_id: string; description: string; owner_bu_id: string | null; due_date: string | null; status: string; note: string | null };
const EFFECT: Record<string, string> = { IMPROVED: "Improved", NO_CHANGE: "No change", WORSE: "Worse", INSUFFICIENT_DATA: "Not enough data to say" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  const { id } = await params;
  if (!can(actor, "ai.case.view")) return <Notice><EmptyState title="Cases are not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Notice><EmptyState title="That case was not found" /></Notice>;
  const sb = await userClient();
  const { data } = await sb.from("ai_cases").select("*").eq("id", id).maybeSingle();
  const c = data as Case | null;
  if (!c) return <Notice><EmptyState title="That case was not found, or it belongs to another unit"><Link href="/ai/cases" className="underline">Back to cases</Link></EmptyState></Notice>;
  const [ev, evt, pl] = await Promise.all([
    sb.from("ai_case_evidence").select("id, kind, summary, captured_value, captured_at").eq("case_id", id).order("captured_at"),
    sb.from("ai_case_events").select("id, seq, event_type, by_agent, detail, occurred_at").eq("case_id", id).order("seq"),
    sb.from("ai_corrective_plans").select("*").eq("case_id", id).order("created_at"),
  ]);
  const plans = (pl.data ?? []) as Plan[];
  const acts = plans.length ? (((await sb.from("ai_corrective_actions").select("*").in("plan_id", plans.map((p) => p.id)).order("created_at")).data ?? []) as Act[]) : [];
  const evidence = (ev.data ?? []) as Ev[], events = (evt.data ?? []) as Evt[];
  const hyps = Array.isArray(c.hypotheses) ? c.hypotheses : [];
  const open = c.status !== "RESOLVED" && c.status !== "CLOSED";
  const mine = can(actor, "ai.remark.submit") && !!actor.buId && (actor.buId === c.business_unit_id || actor.buId === c.assigned_bu_id);
  const manage = can(actor, "ai.case.manage"), assign = can(actor, "ai.action.assign");
  return (
    <>
      <PageHeader title={`${c.reference}: ${c.title}`} description={`${CATEGORY_LABEL[c.category] ?? c.category}. Detected ${when(c.detected_at)}${c.created_by_agent ? " by the daily review" : ""}.`} actions={<Link href="/ai/cases" className="text-sm underline">All cases</Link>} />
      <AiTabs current="cases" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="What was noticed" action={<span className="flex gap-2"><Badge tone={SEVERITY[c.severity] ?? "info"}>{c.severity.toLowerCase()}</Badge><Badge tone="undefined">{STATUS_LABEL[c.status] ?? c.status}</Badge></span>} />
            <div className="space-y-3 px-6 py-4 text-sm">
              <p>{c.description}</p>
              {c.assessment ? <p><span className="font-medium">Assessment. </span>{c.assessment}</p> : null}
              {c.recommendation ? <p><span className="font-medium">Suggested next step. </span>{c.recommendation}</p> : null}
              {c.resolution ? <Banner tone="done" title="Resolution">{c.resolution}</Banner> : null}
              {c.response_due_at && open && !c.responded_at ? <p className="text-xs text-muted">A response is due by {day(c.response_due_at)}.</p> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Possible causes" description="Hypotheses to check. None is confirmed unless it says so, and a unit's remarks are its own account." />
            {hyps.length === 0 ? <EmptyState title="No hypothesis yet">The unit&apos;s response will be the first account of what happened.</EmptyState> : (
              <ul className="divide-y divide-line">{hyps.map((h, i) => <li key={i} className="flex items-start gap-3 px-6 py-3 text-sm"><Badge tone={h.status === "CONFIRMED" ? "done" : "undefined"}>{h.status === "CONFIRMED" ? "Confirmed" : "Hypothesis"}</Badge><span>{h.text}{h.basis ? <span className="text-xs text-muted"> ({h.basis})</span> : null}</span></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Evidence" description="As it was recorded when the case was opened." />
            {evidence.length === 0 ? <EmptyState title="No evidence recorded" /> : <ul className="divide-y divide-line">{evidence.map((e) => <li key={e.id} className="px-6 py-3 text-sm"><Badge tone="info">{e.kind.toLowerCase().replace("_", " ")}</Badge> <span className="ml-1">{e.summary}</span></li>)}</ul>}
          </Card>
          <Card>
            <CardHeader title="Corrective plans" description="The agent drafts. A person adds the actions and sends it; a different person decides it. Whether it worked is judged on the unit's later scores." />
            {plans.length === 0 ? <EmptyState title="No plan yet">A plan is drafted for high and critical cases of a unit.</EmptyState> : (
              <div className="divide-y divide-line">
                {plans.map((p) => {
                  const pa = acts.filter((a) => a.plan_id === p.id);
                  return (
                    <section key={p.id} className="space-y-3 px-6 py-4 text-sm" aria-label="Corrective plan">
                      <div className="flex flex-wrap items-center gap-2"><Badge tone={p.status === "IN_PROGRESS" ? "done" : p.status === "REJECTED" ? "critical" : "warn"}>{p.status.replace("_", " ").toLowerCase()}</Badge>{p.created_by_agent ? <Badge tone="undefined">drafted by the agent</Badge> : null}{p.effectiveness ? <Badge tone={p.effectiveness === "IMPROVED" ? "done" : p.effectiveness === "WORSE" ? "critical" : "warn"}>{EFFECT[p.effectiveness]}</Badge> : null}</div>
                      <dl className="grid gap-2 sm:grid-cols-2">
                        <div><dt className="text-xs text-muted">Problem</dt><dd>{p.problem}</dd></div><div><dt className="text-xs text-muted">Root cause</dt><dd>{p.root_cause_assessment}</dd></div>
                        <div><dt className="text-xs text-muted">Intervention</dt><dd>{p.intervention}</dd></div><div><dt className="text-xs text-muted">Expected outcome</dt><dd>{p.expected_outcome}</dd></div>
                        <div><dt className="text-xs text-muted">How success is measured</dt><dd>{p.success_measure}</dd></div>
                        <div><dt className="text-xs text-muted">Target and review</dt><dd>{p.target_date ? `Target ${day(p.target_date)}` : "No target date"}{p.review_date ? `, review ${day(p.review_date)}` : ""}{p.baseline_score !== null ? `. Baseline score ${Number(p.baseline_score).toFixed(1)}%` : ""}{p.review_score !== null ? `, score at review ${Number(p.review_score).toFixed(1)}%` : ""}.</dd></div>
                      </dl>
                      {p.decision_note ? <p className="text-xs text-muted">Decision note: {p.decision_note}</p> : null}
                      {pa.length ? (
                        <ul className="divide-y divide-line rounded-lg border border-line">
                          {pa.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                              <div><p>{a.description}</p><p className="text-xs text-muted">{a.due_date ? `Due ${day(a.due_date)}. ` : ""}{a.status === "DONE" ? "Done." : a.status === "BLOCKED" ? `Blocked: ${a.note ?? ""}` : a.status === "CANCELLED" ? "Cancelled." : "Open."}</p></div>
                              {p.status === "IN_PROGRESS" && mine && a.status !== "CANCELLED" && a.status !== "DONE" ? <ActionStatusButtons actionId={a.id} status={a.status} /> : null}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-xs text-muted">No actions yet.</p>}
                      {assign && (p.status === "DRAFT" || p.status === "IN_PROGRESS") ? <AddActionForm planId={p.id} ownerBuId={p.owner_bu_id} /> : null}
                      {assign && p.status === "DRAFT" && pa.length ? <SubmitPlanButton planId={p.id} /> : null}
                    </section>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {mine && open ? <Card><CardHeader title="Respond" description="Tell management what is happening. Answering stops further reminders." /><div className="px-6 py-4">{c.responded_at ? <p className="mb-3 text-xs text-muted">Your unit responded on {when(c.responded_at)}. You can add more.</p> : null}<RespondForm caseId={c.id} /></div></Card> : null}
          {manage && open ? <Card><CardHeader title="Manage" /><div className="px-6 py-4"><ManageForm caseId={c.id} current={c.status} /></div></Card> : null}
          {manage && c.status === "RESOLVED" ? <Card><CardHeader title="Close" /><div className="px-6 py-4"><ManageForm caseId={c.id} current={c.status} /></div></Card> : null}
          <Card>
            <CardHeader title="Timeline" />
            <ol className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="px-6 py-3 text-sm">
                  <p className="font-medium">{EVENT_LABEL[e.event_type] ?? e.event_type}{e.by_agent ? <span className="ml-1 text-xs font-normal text-muted">(agent)</span> : null}</p>
                  <p className="text-xs text-muted">{when(e.occurred_at)}</p>
                  {typeof e.detail.text === "string" ? <p className="mt-1">{e.detail.text}</p> : null}
                  {typeof e.detail.note === "string" && e.detail.note ? <p className="mt-1">{e.detail.note}</p> : null}
                  {e.event_type === "STATUS_CHANGE" ? <p className="mt-0.5 text-xs">{STATUS_LABEL[String(e.detail.from)] ?? String(e.detail.from)} to {STATUS_LABEL[String(e.detail.to)] ?? String(e.detail.to)}</p> : null}
                  {e.event_type === "COMMUNICATION" || e.event_type === "ESCALATION" ? <p className="mt-0.5 text-xs">{String(e.detail.recipients ?? 0)} {Number(e.detail.recipients) === 1 ? "person" : "people"} notified.</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

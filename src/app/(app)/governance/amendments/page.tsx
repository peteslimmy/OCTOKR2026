import type { Metadata } from "next";
import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { listAmendments } from "@/lib/data/governance";
import { StatusPill } from "../sessions/[sessionId]/roster-workspace";
import { DecisionButtons } from "./decision-buttons";

export const metadata: Metadata = { title: "Attendance amendments" };

export default async function AmendmentsPage() {
  const actor = await requireActor();
  if (!["attendance.amendment.view", "attendance.amendment.approve", "attendance.amendment.request"].some((p) => can(actor, p))) {
    return <Card><EmptyState title="Attendance amendments are not available for your role" /></Card>;
  }
  const all = await listAmendments();
  const pending = all.filter((a) => a.status === "PENDING");
  const history = all.filter((a) => a.status !== "PENDING");
  const approver = can(actor, "attendance.amendment.approve");

  return (
    <>
      <PageHeader title="Attendance amendments" description="Corrections to finalised attendance. The original roster is never changed; an approved amendment changes only the effective status, and the requester can never decide their own request."
        actions={<Link href="/governance" className="rounded-lg border border-line bg-panel px-4 py-2 text-sm">Sessions</Link>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Pending (${pending.length})`} />
          {pending.length === 0 ? <EmptyState title="No pending requests">Requests are raised from a finalised roster using “Request correction”.</EmptyState> : (
            <ul className="divide-y divide-line">
              {pending.map((a) => {
                const mine = a.requested_by === actor.id;
                return (
                  <li key={a.id} className="space-y-3 px-6 py-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{a.employee_name} <span className="font-normal text-muted">· session {a.session_date}</span></p>
                      <span className="text-muted">Requested by {a.requester_name} · {wat(a.requested_at)}</span>
                    </div>
                    <p className="flex flex-wrap items-center gap-2">Original <StatusPill status={a.source_status} /> · effective <StatusPill status={a.effective_status} /> → proposed <StatusPill status={a.proposed_status} /></p>
                    <p><span className="text-muted">Reason:</span> {a.reason}</p>
                    {a.evidence_refs.length ? <p className="text-muted">Evidence: {a.evidence_refs.map((e) => e.ref).join(", ")}</p> : <p className="text-muted">No evidence attached (optional).</p>}
                    {approver && !mine ? <DecisionButtons id={a.id} /> : mine ? <Badge tone="info">You requested this — an independent approver must decide</Badge> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="History" description="Read-only. Decisions are never reopened or edited." />
          {history.length === 0 ? <EmptyState title="No decisions yet" /> : (
            <ul className="divide-y divide-line">
              {history.map((a) => (
                <li key={a.id} className="space-y-2 px-6 py-4 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{a.employee_name} <Badge tone={a.status === "APPROVED" ? "done" : "critical"}>{a.status === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                    <span className="font-normal text-muted">{a.source_status} → {a.proposed_status}</span></p>
                  <p><span className="text-muted">Reason:</span> {a.reason}{a.decision_reason ? <> · <span className="text-muted">Decision note:</span> {a.decision_reason}</> : null}</p>
                  <ol className="space-y-1 text-muted">{a.events.map((e, i) => <li key={i}>{wat(e.at)} · {e.type.toLowerCase().replace("_", " ")}{e.actor ? ` by ${e.actor}` : ""}</li>)}</ol>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

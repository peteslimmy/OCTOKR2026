"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { ApiFailure, apiRequest, useAction } from "@/components/ui/client";
import { ACTION_STATUSES, REPEATED_CARRY_THRESHOLD, actionStatusLabel } from "@/lib/session-notes/constants";
import type { ActionRow, Person } from "@/lib/session-notes/types";
import { DialogForm, AreaF, PersonF, SelectF, TextF } from "./forms";
import { ActionStatusBadge, LinkChips, dateText } from "./common";

export interface ActionCaps { assign: boolean; update: boolean; verify: boolean; viewerId: string; viewerBuId: string | null }

/** Whether the viewer may report on this action: the assignee, whoever set it, an assigner, or (with the update permission) a BU Lead of the responsible unit. The database decides again. */
export const canWorkAction = (a: ActionRow, c: ActionCaps) => a.assignee_id === c.viewerId || a.created_by === c.viewerId || c.assign || (c.update && c.viewerBuId === a.business_unit_id);

/** One action item with everything that can be done to it, and its whole story. Completing it never completes an OKR task or goal. */
export function ActionCard({ a, caps, people, contextSessionId, readOnly }: { a: ActionRow; caps: ActionCaps; people: Person[]; contextSessionId?: string; readOnly?: boolean }) {
  const { run } = useAction();
  const [status, setStatus] = useState<string>(a.status);
  const [progress, setProgress] = useState(a.progress_note ?? "");
  const [blocked, setBlocked] = useState(a.blocked_reason ?? "");
  const [remarks, setRemarks] = useState("");
  const [why, setWhy] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState(a.due_date);
  const [vremarks, setVremarks] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const work = !readOnly && canWorkAction(a, caps) && a.status !== "CANCELLED";
  const finished = a.status === "COMPLETED" || a.status === "CANCELLED";
  const ver = !readOnly && caps.verify && a.status === "COMPLETED" && a.verification_status === "PENDING";

  const upload = async (f: File) => {
    const form = new FormData();
    form.append("file", f);
    form.append("metadata", JSON.stringify({ recordType: "ACTION", recordId: a.id, purpose: "COMPLETION_EVIDENCE" }));
    const res = await fetch(`/api/v1/okr-sessions/${a.origin_session_id}/attachments`, { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiFailure(json?.error?.code ?? "ERROR", json?.error?.message ?? "The file could not be uploaded. Nothing was saved.", res.status);
  };

  const patch = (body: Record<string, unknown>) => apiRequest("PATCH", `okr-actions/${a.id}`, { expectedVersion: a.version, contextSessionId, ...body });

  return (
    <Card className={`p-4 ${a.overdue ? "border-[#fecaca]" : ""}`} data-testid="action-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{a.reference}</span>
            <ActionStatusBadge status={a.status} />
            <Badge tone={a.priority === "CRITICAL" || a.priority === "HIGH" ? "warn" : "undefined"}>{a.priority.charAt(0) + a.priority.slice(1).toLowerCase()} priority</Badge>
            {a.overdue ? <Badge tone="critical">Overdue</Badge> : a.due_soon ? <Badge tone="warn">Due soon</Badge> : null}
            {a.escalated_at ? <Badge tone="critical" title={a.escalation_reason ?? undefined}>Escalated</Badge> : null}
            {a.reviews >= REPEATED_CARRY_THRESHOLD ? <Badge tone="warn" title="Reviewed in several later sessions without being closed">Carried {a.reviews} times</Badge> : a.reviews > 0 ? <Badge tone="info">Carried forward {a.reviews}×</Badge> : null}
            {a.extensions > 0 ? <Badge tone="undefined">Deadline moved {a.extensions}×</Badge> : null}
            {a.requires_verification ? <Badge tone={a.verification_status === "VERIFIED" ? "done" : "info"}>Verification: {a.verification_status.toLowerCase().replace("_", " ")}</Badge> : null}
          </div>
          <p className="mt-1 text-base text-ink">{a.description}</p>
          <p className="mt-1 text-xs text-muted">
            Owner <strong className="text-ink">{a.assignee_name ?? "—"}</strong> · {a.business_unit_name ?? "—"} · due <strong className={a.overdue ? "text-[var(--critical-fg)]" : "text-ink"}>{dateText(a.due_date)}</strong>
            {a.extensions > 0 ? ` (was ${dateText(a.original_due_date)})` : ""} · from {a.origin_session_reference} · set by {a.created_by_name ?? "—"}
          </p>
          {a.assignee_unavailable ? <p role="alert" className="mt-1 text-xs text-[var(--critical-fg)]">The owner is suspended or no longer with the organisation. Reassign this action.</p> : null}
        </div>
      </div>
      {a.status === "BLOCKED" && a.blocked_reason ? <p className="mt-2 rounded bg-[var(--critical-bg)] px-2 py-1 text-sm text-[var(--critical-fg)]">Blocked: {a.blocked_reason}</p> : null}
      {a.progress_note ? <p className="mt-2 text-sm text-ink"><span className="text-muted">Latest progress:</span> {a.progress_note}</p> : null}
      {a.status === "COMPLETED" ? <p className="mt-2 text-sm text-ink"><span className="text-muted">Completed {dateText(a.completed_at)} by {a.completed_by_name ?? "—"}:</span> {a.completion_remarks}</p> : null}
      <div className="mt-2"><LinkChips links={a.links} /></div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        {work ? (
          <DialogForm label={finished ? "Reopen…" : "Update…"} title={`Update ${a.reference}`} description="Report progress, say what is blocking it, or complete it. This never changes an OKR task or goal." submitLabel="Save update" success="Action updated."
            canSubmit={status !== "COMPLETED" || a.status === "COMPLETED" || remarks.trim().length > 0} onOpen={() => { setStatus(a.status); setProgress(a.progress_note ?? ""); setBlocked(a.blocked_reason ?? ""); setRemarks(""); setWhy(""); }}
            onSubmit={() => patch({ status: status === a.status ? undefined : status, progress: progress.trim() || undefined, blockedReason: status === "BLOCKED" ? blocked.trim() || undefined : undefined, completionRemarks: status === "COMPLETED" && a.status !== "COMPLETED" ? remarks.trim() : undefined, reason: why.trim() || undefined })}>
            <SelectF id={`st-${a.id}`} label="Status" value={status} onChange={setStatus} options={ACTION_STATUSES.filter((s) => s !== "CANCELLED" || caps.assign || a.created_by === caps.viewerId).map((s) => [s, actionStatusLabel[s]] as const)} />
            <AreaF id={`pr-${a.id}`} label="Progress update" value={progress} onChange={setProgress} max={5000} />
            {status === "BLOCKED" ? <AreaF id={`bl-${a.id}`} label="What is blocking it?" value={blocked} onChange={setBlocked} required max={2000} /> : null}
            {status === "COMPLETED" && a.status !== "COMPLETED" ? <AreaF id={`cr-${a.id}`} label="Completion remarks" value={remarks} onChange={setRemarks} required max={5000} hint={a.evidence_required ? "Evidence is required: attach it first using “Attach evidence”." : undefined} /> : null}
            {(finished || status === "CANCELLED") ? <TextF id={`wy-${a.id}`} label="Reason" value={why} onChange={setWhy} required max={2000} hint="Needed to reopen or cancel." /> : null}
          </DialogForm>
        ) : null}
        {work && !finished ? (
          <>
            <input ref={file} type="file" className="sr-only" aria-label={`Attach evidence to ${a.reference}`} accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt"
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; await run(() => upload(f), { success: "Evidence attached." }); }} />
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>Attach evidence{a.evidence_required ? " (required)" : ""}</Button>
          </>
        ) : null}
        {!readOnly && caps.assign && !finished ? (
          <>
            <DialogForm label="Reassign…" title={`Reassign ${a.reference}`} description="The reason and both people are kept in the history. The new owner is notified." submitLabel="Reassign" success="Action reassigned." canSubmit={!!assignee && why.trim().length > 0}
              onOpen={() => { setAssignee(""); setWhy(""); }} onSubmit={() => apiRequest("POST", `okr-actions/${a.id}/reassign`, { assigneeId: assignee, reason: why.trim(), expectedVersion: a.version, contextSessionId })}>
              <PersonF id={`as-${a.id}`} label="New owner" people={people.filter((p) => p.id !== a.assignee_id)} value={assignee} onChange={setAssignee} unit={a.business_unit_id} required />
              <TextF id={`rw-${a.id}`} label="Reason" value={why} onChange={setWhy} required max={2000} />
            </DialogForm>
            <DialogForm label="Extend deadline…" title={`Extend ${a.reference}`} description="A later deadline needs a justification. The original date is kept." submitLabel="Extend" success="Deadline extended." canSubmit={due > a.due_date && why.trim().length > 0}
              onOpen={() => { setDue(a.due_date); setWhy(""); }} onSubmit={() => apiRequest("POST", `okr-actions/${a.id}/extend`, { dueDate: due, reason: why.trim(), expectedVersion: a.version, contextSessionId })}>
              <TextF id={`du-${a.id}`} label="New due date" type="date" value={due} onChange={setDue} required />
              <TextF id={`ew-${a.id}`} label="Justification" value={why} onChange={setWhy} required max={2000} />
            </DialogForm>
            {!a.escalated_at ? (
              <DialogForm label="Escalate…" title={`Escalate ${a.reference}`} description="Executives and the facilitator are told. This does not change the action." submitLabel="Escalate" success="Escalated." canSubmit={why.trim().length > 0} onOpen={() => setWhy("")}
                onSubmit={() => apiRequest("POST", `okr-actions/${a.id}/escalate`, { reason: why.trim(), contextSessionId })}>
                <TextF id={`es-${a.id}`} label="Why is this being escalated?" value={why} onChange={setWhy} required max={2000} />
              </DialogForm>
            ) : null}
          </>
        ) : null}
        {ver ? (
          <DialogForm label="Verify completion…" title={`Verify ${a.reference}`} description="Check the completion remarks and evidence. If something is missing the action goes back to in progress." submitLabel="Record verification" success="Verification recorded." variant="primary"
            canSubmit onOpen={() => setVremarks("")} onSubmit={() => apiRequest("POST", `okr-actions/${a.id}/verify`, { outcome: "VERIFIED", remarks: vremarks.trim() || undefined, expectedVersion: a.version })}>
            <TextF id={`vr-${a.id}`} label="Remarks (optional)" value={vremarks} onChange={setVremarks} max={3000} />
            <p className="text-xs text-muted">To send it back instead, use “Send back…”.</p>
          </DialogForm>
        ) : null}
        {ver ? (
          <DialogForm label="Send back…" title={`Send back ${a.reference}`} submitLabel="Send back" success="Sent back to the owner." variant="danger" canSubmit={vremarks.trim().length > 0} onOpen={() => setVremarks("")}
            onSubmit={() => apiRequest("POST", `okr-actions/${a.id}/verify`, { outcome: "REJECTED", remarks: vremarks.trim(), expectedVersion: a.version })}>
            <TextF id={`vb-${a.id}`} label="What is missing?" value={vremarks} onChange={setVremarks} required max={3000} />
          </DialogForm>
        ) : null}
        <Link href={`/session-notes/${a.origin_session_id}?tab=history`} className="inline-flex min-h-8 items-center px-3 text-sm text-brand-700 underline">History in {a.origin_session_reference}</Link>
      </div>
    </Card>
  );
}

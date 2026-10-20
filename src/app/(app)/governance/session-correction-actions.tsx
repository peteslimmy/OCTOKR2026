"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Textarea, Field } from "@/components/ui/primitives";

/** On a session page: ask for the recorded outcome to be corrected, or (Super Admin) do it at once in an emergency. */
export function OutcomeCorrectionButtons({ sessionId, outcome, canRequest, canEmergency }: { sessionId: string; outcome: string; canRequest: boolean; canEmergency: boolean }) {
  const [mode, setMode] = useState<null | "request" | "emergency">(null);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const emergency = mode === "emergency";
  if (!canRequest && !canEmergency) return null;
  return (
    <>
      <span className="inline-flex flex-wrap gap-2">
        {canRequest ? <Button size="sm" variant="secondary" onClick={() => setMode("request")}>Request outcome correction</Button> : null}
        {canEmergency ? <Button size="sm" variant="danger" onClick={() => setMode("emergency")}>Emergency outcome correction</Button> : null}
      </span>
      <Modal open={mode !== null} onOpenChange={(o) => { if (!o) setMode(null); }} title={emergency ? "Emergency outcome correction" : "Request an outcome correction"}
        description={emergency
          ? `This reopens a session recorded as ${outcome} NOW, without the usual second person. The recorded roster is archived, HR and approvers are alerted and it is audited as an emergency.`
          : `This asks for the session recorded as ${outcome} to be reopened so it can be held or skipped properly. A different person must approve it and someone other than you must execute it. The recorded roster is archived, never lost.`}>
        <div className="space-y-3">
          <Field id={`sc-${sessionId}`} label={emergency ? "Reason (required, at least 10 characters)" : "Reason (required)"}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={emergency ? "danger" : "primary"} disabled={pending || reason.trim().length < (emergency ? 10 : 1)}
              onClick={async () => {
                const ok = await run(() => apiRequest("POST", `governance-sessions/${sessionId}/${emergency ? "emergency-outcome-correction" : "outcome-corrections"}`,
                  emergency ? { reason, idempotencyKey: key, confirm: true } : { reason, idempotencyKey: key }),
                  { success: emergency ? "Session reopened. HR and approvers were alerted." : "Correction requested. A different person must approve it." });
                if (ok) { setMode(null); setReason(""); setKey(crypto.randomUUID()); }
              }}>{emergency ? "Reopen the session now" : "Send request"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export interface CorrectionView {
  id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED"; emergency: boolean; reason: string; fromOutcome: string; weekLabel: string; sessionId: string;
  requestedBy: string | null; requestedById: string; decidedBy: string | null; executedBy: string | null; comment: string | null; archivedRows: number | null; when: string;
}

/** The correction queue. Buttons appear only where the person may act; the database enforces the same rules whatever the screen shows. */
export function CorrectionQueue({ items, me, canApprove, canExecute }: { items: CorrectionView[]; me: string; canApprove: boolean; canExecute: boolean }) {
  const [target, setTarget] = useState<{ id: string; decision: "APPROVE" | "REJECT"; label: string } | null>(null);
  const [comment, setComment] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const fresh = () => { setKey(crypto.randomUUID()); setComment(""); };
  if (items.length === 0) return <p className="px-6 py-4 text-sm text-muted">No correction requests yet.</p>;
  return (
    <>
      <ul className="divide-y divide-line" aria-label="Session outcome corrections">
        {items.map((r) => (
          <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.weekLabel}</span>
              <Badge tone="info">Recorded as {r.fromOutcome.toLowerCase()}</Badge>
              {r.emergency ? <Badge tone="critical">Emergency</Badge> : null}
              <Badge tone={r.status === "PENDING" ? "warn" : r.status === "APPROVED" ? "info" : r.status === "EXECUTED" ? "done" : "critical"}>
                {r.status === "PENDING" ? "Waiting for approval" : r.status === "APPROVED" ? "Approved, not yet executed" : r.status === "EXECUTED" ? "Session reopened" : "Rejected"}</Badge>
            </div>
            <p className="text-muted">Requested by {r.requestedBy ?? "someone"} · {r.when}. Reason: {r.reason}</p>
            {r.decidedBy ? <p className="text-muted">{r.status === "REJECTED" ? "Rejected" : "Approved"} by {r.decidedBy}{r.comment ? `: ${r.comment}` : ""}</p> : null}
            {r.status === "EXECUTED" ? <p className="text-muted">Executed by {r.executedBy ?? "someone"}; {r.archivedRows ?? 0} roster rows archived.</p> : null}
            {r.status === "PENDING" && canApprove ? (
              r.requestedById === me ? <p className="text-xs text-muted">You made this request, so someone else must decide it.</p> : (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => { setTarget({ id: r.id, decision: "APPROVE", label: r.weekLabel }); fresh(); }}>Approve<span className="sr-only"> correction for {r.weekLabel}</span></Button>
                  <Button size="sm" variant="danger" onClick={() => { setTarget({ id: r.id, decision: "REJECT", label: r.weekLabel }); fresh(); }}>Reject<span className="sr-only"> correction for {r.weekLabel}</span></Button>
                </div>
              )
            ) : null}
            {r.status === "APPROVED" && canExecute ? (
              r.requestedById === me ? <p className="text-xs text-muted">You made this request, so someone else must execute it.</p> : (
                <Button size="sm" disabled={pending} onClick={async () => { await run(() => apiRequest("POST", `session-corrections/${r.id}/execute`, { idempotencyKey: crypto.randomUUID() }), { success: "Session reopened. The earlier roster is archived." }); }}>
                  Reopen the session<span className="sr-only"> for {r.weekLabel}</span></Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <Modal open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }} title={target?.decision === "APPROVE" ? "Approve this correction?" : "Reject this correction?"}
        description={target?.decision === "APPROVE" ? `${target?.label}. Approving does not change anything yet: someone other than the requester must still execute it.` : `${target?.label}. The requester is told why.`}>
        <div className="space-y-3">
          <Field id="sc-comment" label={target?.decision === "REJECT" ? "Reason for rejecting (required)" : "Comment (optional)"}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target?.decision === "REJECT" ? "danger" : "primary"} disabled={pending || (target?.decision === "REJECT" && !comment.trim())}
              onClick={async () => {
                if (!target) return;
                const ok = await run(() => apiRequest("POST", `session-corrections/${target.id}/decision`, { decision: target.decision, comment: comment.trim() || undefined, idempotencyKey: key }),
                  { success: target.decision === "APPROVE" ? "Approved. It now waits to be executed." : "Request rejected." });
                if (ok) setTarget(null);
              }}>{target?.decision === "APPROVE" ? "Approve" : "Reject request"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

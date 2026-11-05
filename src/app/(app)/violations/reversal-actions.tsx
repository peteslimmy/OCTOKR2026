"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Textarea, Field } from "@/components/ui/primitives";

const money = (n: number | string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(n));

/** Per-entry controls: ask for a reversal (ordinary path) or, for a Super Admin, perform an emergency reversal. */
export function ReversalButtons({ id, reference, canRequest, canEmergency }: { id: string; reference: string; canRequest: boolean; canEmergency: boolean }) {
  const [mode, setMode] = useState<null | "request" | "emergency">(null);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const emergency = mode === "emergency";
  return (
    <>
      <span className="inline-flex gap-1">
        {canRequest ? <Button size="sm" variant="secondary" onClick={() => setMode("request")}>Request reversal<span className="sr-only"> of {reference}</span></Button> : null}
        {canEmergency ? <Button size="sm" variant="danger" onClick={() => setMode("emergency")}>Emergency reversal<span className="sr-only"> of {reference}</span></Button> : null}
      </span>
      <Modal open={mode !== null} onOpenChange={(o) => { if (!o) setMode(null); }} title={emergency ? "Emergency reversal" : "Request a reversal"}
        description={emergency
          ? `${reference}. This posts a compensating entry NOW, without the usual second person. Every finance and admin user is alerted and the action is audited as an emergency. The original entry is not changed.`
          : `${reference}. A different person must approve it, and someone other than you must post it. Until then nothing changes in the ledger.`}>
        <div className="space-y-3">
          <Field id={`rv-${id}`} label={emergency ? "Reason (required, at least 10 characters)" : "Reason (required)"}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={emergency ? "danger" : "primary"} disabled={pending || reason.trim().length < (emergency ? 10 : 1)}
              onClick={async () => {
                const ok = await run(() => apiRequest("POST", `ledger-entries/${id}/${emergency ? "emergency-reversal" : "reversal-requests"}`,
                  emergency ? { reason, idempotencyKey: key, confirm: true } : { reason, idempotencyKey: key }),
                  { success: emergency ? "Emergency reversal posted. Finance and admin users were alerted." : "Reversal requested. A different person must approve it." });
                if (ok) { setMode(null); setReason(""); setKey(crypto.randomUUID()); }
              }}>{emergency ? "Post emergency reversal" : "Send request"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export interface ReversalView {
  id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED"; emergency: boolean; reason: string; entryReference: string; entryType: "CREDIT" | "DEBIT"; amount: number;
  requestedBy: string | null; requestedById: string; decidedBy: string | null; executedBy: string | null; comment: string | null; reversalReference: string | null; when: string;
}

/** The queue. Buttons appear only where the person may act; the database enforces the same rules whatever the screen shows. */
export function ReversalQueue({ items, me, canApprove, canExecute }: { items: ReversalView[]; me: string; canApprove: boolean; canExecute: boolean }) {
  const [target, setTarget] = useState<{ id: string; decision: "APPROVE" | "REJECT"; ref: string } | null>(null);
  const [comment, setComment] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const fresh = () => { setKey(crypto.randomUUID()); setComment(""); };
  if (items.length === 0) return <p className="px-6 py-4 text-sm text-muted">No reversal requests yet.</p>;
  return (
    <>
      <ul className="divide-y divide-line" aria-label="Ledger reversal requests">
        {items.map((r) => (
          <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.entryReference}</span>
              <span className="tabular-nums">{r.entryType === "CREDIT" ? "+" : "−"}{money(r.amount)}</span>
              {r.emergency ? <Badge tone="critical">Emergency</Badge> : null}
              <Badge tone={r.status === "PENDING" ? "warn" : r.status === "APPROVED" ? "info" : r.status === "EXECUTED" ? "done" : "critical"}>
                {r.status === "PENDING" ? "Waiting for approval" : r.status === "APPROVED" ? "Approved, not yet posted" : r.status === "EXECUTED" ? "Posted" : "Rejected"}</Badge>
            </div>
            <p className="text-muted">Requested by {r.requestedBy ?? "someone"} · {r.when}. Reason: {r.reason}</p>
            {r.decidedBy ? <p className="text-muted">{r.status === "REJECTED" ? "Rejected" : "Approved"} by {r.decidedBy}{r.comment ? `: ${r.comment}` : ""}</p> : null}
            {r.status === "EXECUTED" ? <p className="text-muted">Posted by {r.executedBy ?? "someone"} as {r.reversalReference}.</p> : null}
            {r.status === "PENDING" && canApprove ? (
              r.requestedById === me ? <p className="text-xs text-muted">You made this request, so someone else must decide it.</p> : (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => { setTarget({ id: r.id, decision: "APPROVE", ref: r.entryReference }); fresh(); }}>Approve<span className="sr-only"> reversal of {r.entryReference}</span></Button>
                  <Button size="sm" variant="danger" onClick={() => { setTarget({ id: r.id, decision: "REJECT", ref: r.entryReference }); fresh(); }}>Reject<span className="sr-only"> reversal of {r.entryReference}</span></Button>
                </div>
              )
            ) : null}
            {r.status === "APPROVED" && canExecute ? (
              r.requestedById === me ? <p className="text-xs text-muted">You made this request, so someone else must post it.</p> : (
                <Button size="sm" disabled={pending} onClick={async () => { await run(() => apiRequest("POST", `ledger-reversals/${r.id}/execute`, { idempotencyKey: crypto.randomUUID() }), { success: "Reversal posted to the ledger." }); }}>
                  Post reversal<span className="sr-only"> of {r.entryReference}</span></Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <Modal open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }} title={target?.decision === "APPROVE" ? "Approve this reversal?" : "Reject this reversal?"}
        description={target?.decision === "APPROVE" ? `${target?.ref}. Approving does not change the ledger yet: someone other than the requester must still post it.` : `${target?.ref}. The requester is told why.`}>
        <div className="space-y-3">
          <Field id="lr-comment" label={target?.decision === "REJECT" ? "Reason for rejecting (required)" : "Comment (optional)"}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target?.decision === "REJECT" ? "danger" : "primary"} disabled={pending || (target?.decision === "REJECT" && !comment.trim())}
              onClick={async () => {
                if (!target) return;
                const ok = await run(() => apiRequest("POST", `ledger-reversals/${target.id}/decision`, { decision: target.decision, comment: comment.trim() || undefined, idempotencyKey: key }),
                  { success: target.decision === "APPROVE" ? "Approved. It now waits to be posted." : "Request rejected." });
                if (ok) setTarget(null);
              }}>{target?.decision === "APPROVE" ? "Approve" : "Reject request"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui/primitives";

type ItemType = "OBJECTIVE" | "KR" | "SUBKR";
const NOUN: Record<ItemType, string> = { OBJECTIVE: "objective", KR: "key result", SUBKR: "Sub-KR" };

/** In an ACTIVE quarter nothing is edited directly. This asks for an edit, an addition or a retirement; a different person must approve it. */
export function RequestChange({ mode, itemType, itemId, parentId, current, label }: {
  mode: "EDIT" | "ADD" | "RETIRE"; itemType: ItemType; itemId?: string; parentId?: string; current?: { title: string; description: string | null }; label: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(current?.title ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const verb = mode === "EDIT" ? "Request edit" : mode === "ADD" ? `Request new ${NOUN[itemType]}` : "Request retirement";
  const id = `rc-${mode}-${itemId ?? parentId}`;
  return (
    <>
      <Button size="sm" variant={mode === "RETIRE" ? "ghost" : "secondary"} onClick={() => setOpen(true)}>{verb}<span className="sr-only"> ({label})</span></Button>
      <Modal open={open} onOpenChange={setOpen} title={`${verb}: ${label}`}
        description={mode === "RETIRE"
          ? "A retired item stays on record with its goals and history, but takes no new goals. A different person must approve this."
          : "This quarter is active, so its strategy is a controlled baseline. Nothing changes until a different person approves. Earlier versions are kept."}>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", "strategy/change-requests", {
            changeType: mode, itemType, itemId: itemId ?? null, parentId: parentId ?? null, title: mode === "RETIRE" ? null : title, description: mode === "RETIRE" ? null : description || null, reason, idempotencyKey: key,
          }), { success: "Change requested. A different person must approve it." });
          if (ok) { setOpen(false); setReason(""); setKey(crypto.randomUUID()); if (mode === "ADD") { setTitle(""); setDescription(""); } }
        }}>
          {mode !== "RETIRE" ? (<>
            <Field id={`${id}-t`} label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} /></Field>
            <Field id={`${id}-d`} label="Description (optional)"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></Field>
          </>) : null}
          <Field id={`${id}-r`} label="Why is this change needed? (audited)" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !reason.trim() || (mode !== "RETIRE" && !title.trim())}>{pending ? "Sending…" : "Send request"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export interface ChangeView {
  id: string; status: "PENDING" | "APPLIED" | "REJECTED"; summary: string; reason: string; requestedBy: string | null; requestedById: string; decidedBy: string | null; comment: string | null; when: string;
}

/** Waiting and decided change requests. Approving applies the change at once; the requester can never decide their own. */
export function ChangeQueue({ items, me, canApprove }: { items: ChangeView[]; me: string; canApprove: boolean }) {
  const [target, setTarget] = useState<{ id: string; decision: "APPROVE" | "REJECT"; summary: string } | null>(null);
  const [comment, setComment] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  if (items.length === 0) return <p className="px-6 py-4 text-sm text-muted">No change requests for this quarter.</p>;
  return (
    <>
      <ul className="divide-y divide-line" aria-label="Strategy change requests">
        {items.map((r) => (
          <li key={r.id} className="space-y-1 px-6 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.summary}</span>
              <Badge tone={r.status === "PENDING" ? "warn" : r.status === "APPLIED" ? "done" : "critical"}>{r.status === "PENDING" ? "Waiting for approval" : r.status === "APPLIED" ? "Approved and applied" : "Rejected"}</Badge>
            </div>
            <p className="text-muted">Requested by {r.requestedBy ?? "someone"} · {r.when}. Reason: {r.reason}</p>
            {r.decidedBy ? <p className="text-muted">{r.status === "REJECTED" ? "Rejected" : "Approved"} by {r.decidedBy}{r.comment ? `: ${r.comment}` : ""}</p> : null}
            {r.status === "PENDING" && canApprove ? (
              r.requestedById === me ? <p className="text-xs text-muted">You made this request, so someone else must decide it.</p> : (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => { setTarget({ id: r.id, decision: "APPROVE", summary: r.summary }); setComment(""); setKey(crypto.randomUUID()); }}>Approve<span className="sr-only"> change: {r.summary}</span></Button>
                  <Button size="sm" variant="danger" onClick={() => { setTarget({ id: r.id, decision: "REJECT", summary: r.summary }); setComment(""); setKey(crypto.randomUUID()); }}>Reject<span className="sr-only"> change: {r.summary}</span></Button>
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <Modal open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }} title={target?.decision === "APPROVE" ? "Approve and apply this change?" : "Reject this change?"}
        description={target?.decision === "APPROVE" ? `${target?.summary}. Approving applies it now and records a new version. Earlier versions are kept.` : `${target?.summary}. The requester is told why.`}>
        <div className="space-y-3">
          <Field id="sc-decision-comment" label={target?.decision === "REJECT" ? "Reason for rejecting (required)" : "Comment (optional)"}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={target?.decision === "REJECT" ? "danger" : "primary"} disabled={pending || (target?.decision === "REJECT" && !comment.trim())}
              onClick={async () => {
                if (!target) return;
                const ok = await run(() => apiRequest("POST", `strategy/change-requests/${target.id}/decision`, { decision: target.decision, comment: comment.trim() || undefined, idempotencyKey: key }),
                  { success: target.decision === "APPROVE" ? "Approved and applied." : "Request rejected." });
                if (ok) setTarget(null);
              }}>{target?.decision === "APPROVE" ? "Approve and apply" : "Reject request"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

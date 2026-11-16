"use client";

import { Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Textarea } from "@/components/ui/primitives";
import { wat } from "@/components/status";

export interface ChangeRequest { id: string; kind: "ADD" | "RENAME" | "RETIRE" | "RESTORE"; status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"; title: string | null; goal_title: string | null; reason: string; unit: string | null;
  requested_at: string; requester: string | null; decided_at: string | null; decider: string | null; decision_reason: string | null; mine: boolean }

const KIND: Record<ChangeRequest["kind"], string> = { ADD: "Add a goal", RENAME: "Rename a goal", RETIRE: "Retire a goal", RESTORE: "Restore a goal" };
const TONE = { PENDING: "warn", APPROVED: "done", REJECTED: "notdone", WITHDRAWN: "locked" } as const;

/** Admin and Super Admin: lock this unit's goals for the quarter, or every unit's, and lift a lock again with a reason. */
export function LockControls({ quarterId, businessUnitId, unitName, lockedScope }: { quarterId: string; businessUnitId: string; unitName: string; lockedScope: "ALL_UNITS" | "ONE_UNIT" | null }) {
  const { run, pending } = useAction();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lockedScope ? <Badge tone="locked">{lockedScope === "ALL_UNITS" ? "Locked for every unit" : `Locked for ${unitName}`}</Badge> : <Badge tone="info">Not locked</Badge>}
      {lockedScope ? (
        <Button size="sm" variant="secondary" onClick={() => setUnlockOpen(true)}><LockOpen className="h-4 w-4" aria-hidden />Unlock</Button>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", "bu-goals/lock", { quarterId, businessUnitId }), { success: `${unitName}'s goals are locked.` })}><Lock className="h-4 w-4" aria-hidden />Lock {unitName}</Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", "bu-goals/lock", { quarterId }), { success: "Every unit's goals are locked." })}><Lock className="h-4 w-4" aria-hidden />Lock every unit</Button>
        </>
      )}
      <Modal open={unlockOpen} onOpenChange={setUnlockOpen} title="Unlock the goals" description="Units can change their goals directly again. Say why; the reason is recorded in the audit log.">
        <div className="space-y-3">
          <Field id="unlock-reason" label="Reason (required, audited)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setUnlockOpen(false)}>Cancel</Button>
            <Button disabled={pending || !reason.trim()} onClick={async () => { const ok = await run(() => apiRequest("POST", "bu-goals/unlock", { quarterId, reason, ...(lockedScope === "ONE_UNIT" ? { businessUnitId } : {}) }), { success: "Unlocked." }); if (ok) { setUnlockOpen(false); setReason(""); } }}>Unlock</Button></div>
        </div>
      </Modal>
    </div>
  );
}

/** A BU Lead asks to change a locked goal (or add one) and says why. */
export function RequestChangeButton({ quarterId, businessUnitId, kind, goalId, currentTitle, label }: { quarterId: string; businessUnitId: string; kind: ChangeRequest["kind"]; goalId?: string; currentTitle?: string; label: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(currentTitle ?? "");
  const [reason, setReason] = useState("");
  const needsTitle = kind === "ADD" || kind === "RENAME";
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} title={`${KIND[kind]}${currentTitle && kind !== "ADD" ? `: ${currentTitle}` : ""}`}
        description="These goals are locked. An Executive, Admin or HR decides this request; the change only happens if it is approved.">
        <div className="space-y-3">
          {needsTitle ? <Field id={`rc-title-${kind}-${goalId ?? "new"}`} label={kind === "ADD" ? "The new goal" : "The new wording"}><Textarea value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} required /></Field> : null}
          <Field id={`rc-reason-${kind}-${goalId ?? "new"}`} label="Why is this change needed? (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || !reason.trim() || (needsTitle && !title.trim())}
              onClick={async () => { const ok = await run(() => apiRequest("POST", "bu-goals/change-requests", { quarterId, businessUnitId, kind, goalId, title: needsTitle ? title : undefined, reason }), { success: "Request sent for approval." }); if (ok) { setOpen(false); setReason(""); } }}>Send request</Button></div>
        </div>
      </Modal>
    </>
  );
}

/** The change requests for the quarter. Approvers (Executive, Admin, HR) approve or reject; the person who asked can withdraw a pending one. */
export function ChangeRequestList({ requests, canDecide }: { requests: ChangeRequest[]; canDecide: boolean }) {
  const { run, pending } = useAction();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (requests.length === 0) return <p className="px-6 py-4 text-sm text-muted">No change requests for this quarter.</p>;
  return (
    <ul className="divide-y divide-line px-6" aria-label="Goal change requests">
      {requests.map((r) => (
        <li key={r.id} className="space-y-2 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[r.status]}>{r.status === "PENDING" ? "Waiting for a decision" : r.status === "APPROVED" ? "Approved" : r.status === "REJECTED" ? "Rejected" : "Withdrawn"}</Badge>
            <span className="font-medium">{KIND[r.kind]}</span>{r.unit ? <span className="text-muted">· {r.unit}</span> : null}
          </div>
          <p>{r.kind === "ADD" || r.kind === "RENAME" ? <>{r.goal_title && r.kind === "RENAME" ? <><span className="text-muted line-through">{r.goal_title}</span> → </> : null}<strong className="font-medium">{r.title}</strong></> : <strong className="font-medium">{r.goal_title}</strong>}</p>
          <p className="text-muted">Why: {r.reason} · {r.requester ?? "Someone"} · {wat(r.requested_at)}</p>
          {r.status !== "PENDING" && r.decision_reason ? <p className="text-muted">Decision: {r.decision_reason}{r.decider ? ` · ${r.decider}` : ""}</p> : null}
          {r.status === "PENDING" ? (
            <div className="flex flex-wrap gap-2">
              {canDecide && !r.mine ? <>
                <Button size="sm" disabled={pending} onClick={() => run(() => apiRequest("POST", `bu-goals/change-requests/${r.id}/decide`, { approve: true }), { success: "Approved. The change is in place." })}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => { setRejecting(r.id); setReason(""); }}>Reject</Button></> : null}
              {r.mine ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => apiRequest("POST", `bu-goals/change-requests/${r.id}/withdraw`), { success: "Request withdrawn." })}>Withdraw</Button> : null}
            </div>
          ) : null}
          <Modal open={rejecting === r.id} onOpenChange={(o) => setRejecting(o ? r.id : null)} title="Reject this request" description="The reason is sent to the person who asked.">
            <div className="space-y-3">
              <Field id={`rj-${r.id}`} label="Reason (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
                <Button variant="danger" disabled={pending || !reason.trim()} onClick={async () => { const ok = await run(() => apiRequest("POST", `bu-goals/change-requests/${r.id}/decide`, { approve: false, reason }), { success: "Request rejected." }); if (ok) setRejecting(null); }}>Reject</Button></div>
            </div>
          </Modal>
        </li>
      ))}
    </ul>
  );
}

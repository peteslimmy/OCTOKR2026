"use client";

import { useEffect, useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, NativeSelect, Textarea } from "@/components/ui/primitives";
import { wat } from "@/components/status";
import type { RetirementExecutive, RetirementRequest } from "@/lib/data/bu-goal-retirements";

const ROLE: Record<RetirementExecutive["role"], string> = { EXECUTIVE: "Executive", DIRECTOR: "Director" };
const TONE = { PENDING: "warn", APPROVED: "done", REJECTED: "notdone", CANCELLED: "locked" } as const;
const LABEL = { PENDING: "Waiting for approval", APPROVED: "Approved: goal retired", REJECTED: "Rejected: goal stays active", CANCELLED: "Cancelled" } as const;

/** "Retire" on a unit goal: choose the executive by name and give the justification. The goal is retired only if that executive approves. */
export function RetireGoalButton({ goalId, goalTitle }: { goalId: string; goalTitle: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [executives, setExecutives] = useState<RetirementExecutive[] | null>(null);
  const [executiveId, setExecutiveId] = useState("");
  const [justification, setJustification] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());   // one attempt keeps one key; a new one after success
  useEffect(() => {
    if (!open || executives) return;
    apiRequest<RetirementExecutive[]>("GET", "bu-goals/retirement-executives").then(setExecutives, () => setExecutives([]));
  }, [open, executives]);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Retire</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Retire this goal: ${goalTitle}`}
        description="A goal is retired only when the executive you choose approves. Until then it stays exactly as it is. If they reject, it stays active.">
        <div className="space-y-3">
          <Field id={`rt-exec-${goalId}`} label="Executive who decides (required)" hint={executives && executives.length === 0 ? "No executive is available to choose. Ask an Admin." : undefined}>
            <NativeSelect value={executiveId} onChange={(e) => setExecutiveId(e.target.value)} required>
              <option value="">{executives ? "Choose an executive…" : "Loading…"}</option>
              {(executives ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({ROLE[x.role]})</option>)}
            </NativeSelect>
          </Field>
          <Field id={`rt-just-${goalId}`} label="Justification (required)"><Textarea value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || !executiveId || !justification.trim()}
              onClick={async () => {
                const ok = await run(() => apiRequest("POST", "bu-goals/retirements", { goalId, executiveId, justification, idempotencyKey: key }), { success: "Sent for approval. The goal stays as it is until the executive decides." });
                if (ok) { setOpen(false); setJustification(""); setExecutiveId(""); setKey(crypto.randomUUID()); }
              }}>Send for approval</Button></div>
        </div>
      </Modal>
    </>
  );
}

/** Retirement requests. The chosen executive approves or rejects (a comment is required to reject); the lead sees the outcome and can cancel a pending one. */
export function RetirementList({ requests, emptyText }: { requests: RetirementRequest[]; emptyText: string }) {
  const { run, pending } = useAction();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  if (requests.length === 0) return <p className="px-6 py-4 text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="divide-y divide-line px-6" aria-label="Goal retirement requests">
      {requests.map((r) => (
        <li key={r.id} className="space-y-2 py-3 text-sm" data-testid="retirement-request">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
            <strong className="font-medium">{r.goal_code ? <span className="mr-2 font-mono text-xs text-muted">{r.goal_code}</span> : null}{r.goal_title}</strong>
            {r.unit ? <span className="text-muted">· {r.unit}</span> : null}
          </div>
          <p className="text-muted">Justification: {r.justification} · {r.requester ?? "A unit lead"} · {wat(r.requested_at)}</p>
          {r.status === "PENDING" ? <p>Retirement pending approval by <strong className="font-medium">{r.executive ?? "the chosen executive"}</strong>{r.executive_active ? "" : " (this account is not active: cancel and choose another executive)"}</p> : null}
          {r.status !== "PENDING" ? <p className="text-muted">{r.status === "CANCELLED" ? "Cancelled" : r.status === "APPROVED" ? "Approved" : "Rejected"} by {r.decider ?? "someone"}{r.decided_at ? ` · ${wat(r.decided_at)}` : ""}{r.decision_comment ? ` · Comment: ${r.decision_comment}` : ""}</p> : null}
          {r.status === "PENDING" ? (
            <div className="flex flex-wrap gap-2">
              {r.can_decide ? <>
                <Button size="sm" disabled={pending} onClick={() => run(() => apiRequest("POST", `bu-goals/retirements/${r.id}/decide`, { approve: true, idempotencyKey: crypto.randomUUID() }), { success: "Approved. The goal is retired." })}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => { setRejecting(r.id); setComment(""); }}>Reject</Button></> : null}
              {r.mine ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => apiRequest("POST", `bu-goals/retirements/${r.id}/cancel`), { success: "Request cancelled. The goal is unchanged." })}>Cancel request</Button> : null}
            </div>
          ) : null}
          <Modal open={rejecting === r.id} onOpenChange={(o) => setRejecting(o ? r.id : null)} title="Reject this retirement" description="The goal stays active. Your comment is sent to the Business Unit Lead.">
            <div className="space-y-3">
              <Field id={`rr-${r.id}`} label="Comment (required)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} required /></Field>
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
                <Button variant="danger" disabled={pending || !comment.trim()} onClick={async () => { const ok = await run(() => apiRequest("POST", `bu-goals/retirements/${r.id}/decide`, { approve: false, comment, idempotencyKey: crypto.randomUUID() }), { success: "Retirement rejected. The goal stays active." }); if (ok) setRejecting(null); }}>Reject</Button></div>
            </div>
          </Modal>
        </li>
      ))}
    </ul>
  );
}

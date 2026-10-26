"use client";

import { useState } from "react";
import { apiRequest, ConfirmButton, Modal, useAction, useOpenOnNew } from "@/components/ui/client";
import { Badge, Button, Input, Label, Textarea, Field } from "@/components/ui/primitives";
import { ReviewRow, StepForm } from "@/components/ui/step-form";

export function NewRequestButton({ available }: { available: number | null }) {
  const [open, setOpen] = useState(useOpenOnNew("disbursement"));
  const [f, setF] = useState({ amount: "", purpose: "", justification: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Request funds</Button>
      <Modal open={open} onOpenChange={setOpen} title="Request funds" description="The request goes to Finance for approval, then release. Finance will review and decide. You cannot approve or release your own request.">
        <StepForm submitLabel="Submit request" pending={pending} onCancel={() => setOpen(false)}
          onSubmit={async () => {
            const ok = await run(() => apiRequest("POST", "disbursement-requests", { amount: Number(f.amount), purpose: f.purpose, justification: f.justification, idempotencyKey: key }), { success: "Request submitted to Finance." });
            if (ok) { setOpen(false); setKey(crypto.randomUUID()); setF({ amount: "", purpose: "", justification: "" }); }
          }}
          steps={[
            { id: "amount", title: "Amount", valid: Number(f.amount) > 0, content: (
              <div><Label htmlFor="dr-amt">Amount (₦)</Label><Input id="dr-amt" type="number" step="0.01" min="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
                {available !== null ? <p className="mt-1 text-xs text-muted">Available to commit: ₦{available.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p> : null}</div>) },
            { id: "why", title: "Reason", valid: !!f.purpose.trim() && !!f.justification.trim(), content: (<>
              <Field id="dr-purpose" label="Purpose"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} required maxLength={500} /></Field>
              <Field id="dr-just" label="Justification"><Textarea value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} required maxLength={2000} /></Field></>) },
            { id: "review", title: "Review", content: (
              <dl aria-label="Request summary"><ReviewRow label="Amount">{`₦${Number(f.amount || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`}</ReviewRow><ReviewRow label="Purpose">{f.purpose}</ReviewRow><ReviewRow label="Justification">{f.justification}</ReviewRow></dl>) },
          ]} />
      </Modal>
    </>
  );
}

export function RequestActions({ id, status, amount, mine, canDecide, canReject, canDisburse, balanceAfter }: {
  id: string; status: string; amount: string; mine: boolean; canDecide: boolean; canReject: boolean; canDisburse: boolean; balanceAfter: string | null;
}) {
  const { run, pending } = useAction();
  const [key] = useState(() => crypto.randomUUID());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [relOpen, setRelOpen] = useState(false);
  const [ref, setRef] = useState("");
  const decidable = status === "SUBMITTED" || status === "UNDER_REVIEW";
  if (mine && (decidable || status === "APPROVED")) return <Badge tone="info">You requested this — someone else must {decidable ? "decide" : "release"} it</Badge>;
  return (
    <div className="flex flex-wrap gap-2">
      {decidable && canDecide && status === "SUBMITTED" ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", `disbursement-requests/${id}/review`), { success: "Marked under review." })}>Start review</Button> : null}
      {decidable && canDecide ? (
        <ConfirmButton label="Approve" title={`Approve ${amount}?`}
          description={`Approving commits ${amount} but does not release cash; release is a separate step. ${balanceAfter ? `Available to commit after approval: ${balanceAfter}.` : ""} The balance is re-checked at the moment you confirm.`}
          onConfirm={() => run(() => apiRequest("POST", `disbursement-requests/${id}/approve`, { idempotencyKey: key }), { success: "Request approved." })} />
      ) : null}
      {decidable && canReject ? <Button size="sm" variant="secondary" onClick={() => setRejectOpen(true)}>Reject</Button> : null}
      {status === "APPROVED" && canDisburse ? <Button size="sm" disabled={pending} onClick={() => setRelOpen(true)}>Record disbursement</Button> : null}

      <Modal open={rejectOpen} onOpenChange={setRejectOpen} title="Reject request" description="A justification is required and is shown to the requester.">
        <div className="space-y-3"><Field id={`rj-${id}`} label="Justification"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending || !reason.trim()} onClick={async () => { const ok = await run(() => apiRequest("POST", `disbursement-requests/${id}/reject`, { reason, idempotencyKey: key + "-r" }), { success: "Request rejected; requester notified." }); if (ok) setRejectOpen(false); }}>Reject request</Button></div></div>
      </Modal>
      <Modal open={relOpen} onOpenChange={setRelOpen} title={`Record disbursement of ${amount}`} description="This posts the ledger debit and marks the request disbursed, together. It cannot be undone; corrections use compensating entries.">
        <div className="space-y-3"><Field id={`rf-${id}`} label="Bank / payment reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={200} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRelOpen(false)}>Cancel</Button>
            <Button disabled={pending || !ref.trim()} onClick={async () => { const ok = await run(() => apiRequest("POST", `disbursement-requests/${id}/disburse`, { reference: ref, idempotencyKey: key + "-d" }), { success: "Disbursement recorded." }); if (ok) setRelOpen(false); }}>Confirm release</Button></div></div>
      </Modal>
    </div>
  );
}

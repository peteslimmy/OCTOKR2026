"use client";

import { useState } from "react";
import { apiRequest, ConfirmButton, Modal, useAction, useOpenOnNew } from "@/components/ui/client";
import { Badge, Button, Card, CardHeader, Input, Label, Select, Textarea, Field } from "@/components/ui/primitives";
import { ReviewRow, StepForm } from "@/components/ui/step-form";

export function NewRequestButton({ available, purposes }: { available: number | null; purposes: string[] }) {
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
              <Field id="dr-purpose" label="Purpose" hint="Put the details in the justification below."><Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} required>
                <option value="">Select a purpose…</option>{purposes.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
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
  if (mine && (decidable || status === "APPROVED")) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">You requested this — someone else must {decidable ? "decide" : "release"} it</Badge>
        {decidable ? <ConfirmButton label="Withdraw" variant="secondary" title="Withdraw this request?" description="The request leaves the approval queue and no money is committed. It stays on record as withdrawn; you can raise a new request later."
          onConfirm={() => run(() => apiRequest("POST", `disbursement-requests/${id}/withdraw`), { success: "Request withdrawn." })} /> : null}
      </div>
    );
  }
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

/** After a rejection: raise a revised request that points back to the rejected one. The rejected request itself is never changed. */
export function ReviseRequestButton({ id, amount, purpose, justification, available, purposes, reason }: {
  id: string; amount: number; purpose: string; justification: string; available: number | null; purposes: string[]; reason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: String(amount), purpose, justification, note: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const options = purposes.includes(purpose) ? purposes : [purpose, ...purposes];
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Revise and resubmit</Button>
      <Modal open={open} onOpenChange={setOpen} title="Revise and resubmit" description="This raises a new request linked to the rejected one. Finance sees both, and what you changed.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", `disbursement-requests/${id}/resubmit`, { amount: Number(f.amount), purpose: f.purpose, justification: f.justification, note: f.note, idempotencyKey: key }), { success: "Revised request sent to Finance." });
          if (ok) { setOpen(false); setKey(crypto.randomUUID()); }
        }}>
          {reason ? <p className="rounded-md bg-surface px-3 py-2 text-sm"><span className="text-xs text-muted">Why it was rejected</span><br />“{reason}”</p> : null}
          <Field id={`rv-note-${id}`} label="What have you changed or clarified?" hint="Finance reads this first."><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required maxLength={1000} /></Field>
          <div><Label htmlFor={`rv-amt-${id}`}>Amount (₦)</Label><Input id={`rv-amt-${id}`} type="number" step="0.01" min="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
            {available !== null ? <p className="mt-1 text-xs text-muted">Available to commit: ₦{available.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p> : null}</div>
          <Field id={`rv-purpose-${id}`} label="Purpose"><Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} required>{options.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
          <Field id={`rv-just-${id}`} label="Justification"><Textarea value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} required maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !f.note.trim() || !(Number(f.amount) > 0)}>{pending ? "Sending…" : "Resubmit"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function PurposeManager({ purposes }: { purposes: { id: string; name: string; active: boolean }[] }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const save = (body: { id?: string; name: string; active?: boolean }, success: string) => run(() => apiRequest("POST", "disbursement-purposes", body), { success });
  return (
    <Card>
      <CardHeader title="Fund request purposes" description="The list people choose from when they request funds. Retiring a purpose keeps past requests intact." />
      <div className="space-y-3 p-5">
        <ul className="divide-y divide-line rounded-lg border border-line">
          {purposes.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className={p.active ? "" : "text-muted line-through"}>{p.name}</span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => save({ id: p.id, name: p.name, active: !p.active }, p.active ? "Purpose retired." : "Purpose restored.")}>{p.active ? "Retire" : "Restore"}</Button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await save({ name }, "Purpose added.")) setName(""); }}>
          <Input aria-label="New purpose" placeholder="New purpose, e.g. Training" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>Add</Button>
        </form>
      </div>
    </Card>
  );
}

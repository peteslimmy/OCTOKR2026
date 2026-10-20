"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction, useOpenOnNew } from "@/components/ui/client";
import { Button, Input, Label, Select, Textarea, Field } from "@/components/ui/primitives";
import { ReviewRow, StepForm } from "@/components/ui/step-form";

export function ViolationTypeButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: "", name: "", criticality: "MEDIUM", defaultFine: "", reason: "" });
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Add violation type</Button>
      <Modal open={open} onOpenChange={setOpen} title="Add violation type" description="Fine amounts are in Nigerian Naira (₦). A different Admin or Super Admin must approve the new type before it can be used.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", "violation-types", { ...f, defaultFine: Number(f.defaultFine) }), { success: "Sent for approval. The type can be used once a different Admin or Super Admin approves it." }); if (ok) { setOpen(false); setF({ code: "", name: "", criticality: "MEDIUM", defaultFine: "", reason: "" }); } }}>
          <div className="grid grid-cols-2 gap-3">
            <Field id="vt-code" label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required maxLength={30} /></Field>
            <div><Label htmlFor="vt-crit">Criticality</Label><Select id="vt-crit" value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((c) => <option key={c}>{c}</option>)}</Select></div>
          </div>
          <Field id="vt-name" label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field id="vt-fine" label="Default fine (₦)"><Input type="number" step="0.01" min="0.01" value={f.defaultFine} onChange={(e) => setF({ ...f, defaultFine: e.target.value })} required /></Field>
          <Field id="vt-reason" label="Reason for the approver"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Send for approval</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function NewViolationButton({ types, employees, sessions }: {
  types: { id: string; code: string; name: string; default_fine: number }[]; employees: { id: string; label: string }[]; sessions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(useOpenOnNew("violation"));
  const [f, setF] = useState({ employeeId: "", governanceSessionId: "", violationTypeId: "", override: "", overrideReason: "", notes: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const type = types.find((t) => t.id === f.violationTypeId);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={types.length === 0} title={types.length === 0 ? "Define a violation type first" : undefined}>New violation</Button>
      <Modal open={open} onOpenChange={setOpen} title="Raise a violation" description="The fine and criticality are taken from the selected type. Overriding the fine needs a reason.">
        <StepForm submitLabel="Record violation" pending={pending} onCancel={() => setOpen(false)}
          onSubmit={async () => {
            const ok = await run(() => apiRequest("POST", "violations", {
              employeeId: f.employeeId, governanceSessionId: f.governanceSessionId || null, violationTypeId: f.violationTypeId,
              fineOverride: f.override ? Number(f.override) : null, overrideReason: f.overrideReason || null, notes: f.notes || null, idempotencyKey: key,
            }), { success: "Violation recorded." });
            if (ok) { setOpen(false); setKey(crypto.randomUUID()); setF({ employeeId: "", governanceSessionId: "", violationTypeId: "", override: "", overrideReason: "", notes: "" }); }
          }}
          steps={[
            { id: "who", title: "Who and what", valid: !!f.employeeId && !!f.violationTypeId, content: (<>
              <div><Label htmlFor="nv-emp">Staff member</Label><Select id="nv-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required><option value="">Select…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>
              <div><Label htmlFor="nv-type">Violation type</Label><Select id="nv-type" value={f.violationTypeId} onChange={(e) => setF({ ...f, violationTypeId: e.target.value })} required><option value="">Select…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
                {type ? <p className="mt-1 text-xs text-muted">Default fine ₦{Number(type.default_fine).toLocaleString("en-NG")}</p> : null}</div></>) },
            { id: "details", title: "Details", content: (<>
              <div><Label htmlFor="nv-ses">Session (optional)</Label><Select id="nv-ses" value={f.governanceSessionId} onChange={(e) => setF({ ...f, governanceSessionId: e.target.value })}><option value="">None</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
                <p className="mt-1 text-xs text-muted">Skipped sessions are not listed: a skipped week cannot generate an absence violation.</p></div>
              <div className="grid grid-cols-2 gap-3">
                <Field id="nv-ov" label="Override fine (₦, optional)"><Input type="number" step="0.01" min="0.01" value={f.override} onChange={(e) => setF({ ...f, override: e.target.value })} /></Field>
                <Field id="nv-or" label="Override reason"><Input value={f.overrideReason} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} required={!!f.override} /></Field>
              </div>
              <Field id="nv-notes" label="Notes (optional)"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} /></Field></>) },
            { id: "review", title: "Review", content: (
              <dl aria-label="Violation summary">
                <ReviewRow label="Staff member">{employees.find((x) => x.id === f.employeeId)?.label}</ReviewRow><ReviewRow label="Type">{type?.name}</ReviewRow>
                <ReviewRow label="Fine">{f.override ? `₦${Number(f.override).toLocaleString("en-NG")} (override)` : type ? `₦${Number(type.default_fine).toLocaleString("en-NG")}` : ""}</ReviewRow>
                <ReviewRow label="Session">{sessions.find((x) => x.id === f.governanceSessionId)?.label}</ReviewRow><ReviewRow label="Notes">{f.notes}</ReviewRow>
              </dl>) },
          ]} />
      </Modal>
    </>
  );
}

export function PayButton({ id, amount }: { id: string; amount: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ method: "PAYMENT", reference: "", paidAt: new Date().toISOString().slice(0, 10) });
  const [key] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record payment</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Record payment of ${amount}`} description="This marks the violation settled and credits the violation fund in one step. It cannot be undone; corrections use compensating entries.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", `violations/${id}/payment`, { ...f, idempotencyKey: key }), { success: "Payment recorded and fund credited." }); if (ok) setOpen(false); }}>
          <div><Label htmlFor={`pm-${id}`}>Method</Label><Select id={`pm-${id}`} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="PAYMENT">Payment</option><option value="SALARY_DEDUCTION">Salary deduction (recorded in payroll)</option></Select></div>
          <Field id={`pr-${id}`} label="Payment reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} required maxLength={200} /></Field>
          <Field id={`pd-${id}`} label="Date paid"><Input type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !f.reference.trim()}>{pending ? "Recording…" : "Record payment"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

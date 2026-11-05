"use client";

import { useState } from "react";
import { apiRequest, Modal, toast, useAction, useOpenOnNew } from "@/components/ui/client";
import { Button, Input, Label, Select, Textarea, Field } from "@/components/ui/primitives";
import { ReviewRow, StepForm } from "@/components/ui/step-form";

export function ViolationTypeButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", criticality: "MEDIUM", defaultFine: "", reason: "" });
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Add violation type</Button>
      <Modal open={open} onOpenChange={setOpen} title="Add violation type" description="Fine amounts are in Nigerian Naira (₦). A different Admin or Super Admin must approve the new type before it can be used.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", "violation-types", { ...f, defaultFine: Number(f.defaultFine) }), { success: "Sent for approval. The type can be used once a different Admin or Super Admin approves it." }); if (ok) { setOpen(false); setF({ name: "", criticality: "MEDIUM", defaultFine: "", reason: "" }); } }}>
          <Field id="vt-name" label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></Field>
          <div><Label htmlFor="vt-crit">Criticality</Label><Select id="vt-crit" value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((c) => <option key={c}>{c}</option>)}</Select></div>
          <Field id="vt-fine" label="Default fine (₦)"><Input type="number" step="0.01" min="0.01" value={f.defaultFine} onChange={(e) => setF({ ...f, defaultFine: e.target.value })} required /></Field>
          <Field id="vt-reason" label="Reason for the approver"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Send for approval</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function NewViolationButton({ types, employees, sessions }: {
  types: { id: string; code: string; name: string; default_fine: number }[]; employees: { id: string; label: string; businessUnit: string; email: string }[]; sessions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(useOpenOnNew("violation"));
  const [f, setF] = useState({ employeeId: "", governanceSessionId: "", violationTypeId: "", override: "", overrideReason: "", notes: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const type = types.find((t) => t.id === f.violationTypeId);
  const emp = employees.find((x) => x.id === f.employeeId);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={types.length === 0} title={types.length === 0 ? "Define a violation type first" : undefined}>Report a violation</Button>
      <Modal open={open} onOpenChange={setOpen} title="Report a violation" description="Choose the staff member, then the violation. The fine and criticality are taken from the selected type. Overriding the fine needs a reason.">
        <StepForm submitLabel="Report violation" pending={pending} onCancel={() => setOpen(false)}
          onSubmit={async () => {
            const ok = await run(() => apiRequest("POST", "violations", {
              employeeId: f.employeeId, governanceSessionId: f.governanceSessionId || null, violationTypeId: f.violationTypeId,
              fineOverride: f.override ? Number(f.override) : null, overrideReason: f.overrideReason || null, notes: f.notes || null, idempotencyKey: key,
            }), { success: "Violation recorded." });
            if (ok) { setOpen(false); setKey(crypto.randomUUID()); setF({ employeeId: "", governanceSessionId: "", violationTypeId: "", override: "", overrideReason: "", notes: "" }); }
          }}
          steps={[
            { id: "who", title: "Who and what", valid: !!f.employeeId && !!f.violationTypeId, content: (<>
              <div><Label htmlFor="nv-emp">Staff member</Label><Select id="nv-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required><option value="">Select…</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
                {emp ? <dl aria-label="Staff details" className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-surface px-3 py-2 text-xs"><dt className="text-muted">Business unit</dt><dd>{emp.businessUnit || "—"}</dd><dt className="text-muted">Email</dt><dd className="break-all">{emp.email || "—"}</dd></dl> : null}</div>
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
                <ReviewRow label="Staff member">{emp ? `${emp.label} (${emp.businessUnit})` : ""}</ReviewRow><ReviewRow label="Type">{type?.name}</ReviewRow>
                <ReviewRow label="Fine">{f.override ? `₦${Number(f.override).toLocaleString("en-NG")} (override)` : type ? `₦${Number(type.default_fine).toLocaleString("en-NG")}` : ""}</ReviewRow>
                <ReviewRow label="Session">{sessions.find((x) => x.id === f.governanceSessionId)?.label}</ReviewRow><ReviewRow label="Notes">{f.notes}</ReviewRow>
              </dl>) },
          ]} />
      </Modal>
    </>
  );
}

export function PayButton({ id, amount, methods }: { id: string; amount: string; methods: { code: string; name: string; is_deduction: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ method: methods[0]?.code ?? "", paidAt: new Date().toISOString().slice(0, 10) });
  const [key] = useState(() => crypto.randomUUID());
  const [year] = useState(() => new Date().getFullYear());
  const { run, pending } = useAction();
  const chosen = methods.find((m) => m.code === f.method);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record payment</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Record payment of ${amount}`} description="This marks the violation settled and credits the violation fund in one step. It cannot be undone; corrections use compensating entries.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => apiRequest<{ reference?: string }>("POST", `violations/${id}/payment`, { ...f, idempotencyKey: key }), { success: "Payment recorded and fund credited." }); if (r) { if (r.value?.reference) toast.info(`Payment reference ${r.value.reference}`); setOpen(false); } }}>
          <div><Label htmlFor={`pm-${id}`}>Method</Label><Select id={`pm-${id}`} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} required>{methods.map((m) => <option key={m.code} value={m.code}>{m.name}{m.is_deduction ? " (recorded in payroll)" : ""}</option>)}</Select></div>
          <p className="rounded-md bg-surface px-3 py-2 text-xs text-muted">The payment reference is generated when you record this. It starts with <span className="font-mono">{f.method || "the method code"}</span>, for example <span className="font-mono">{f.method || "XXX"}-{year}-000001</span>.</p>
          <Field id={`pd-${id}`} label="Date paid"><Input type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} required /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !chosen}>{pending ? "Recording…" : "Record payment"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function VoidButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Void</Button>
      <Modal open={open} onOpenChange={setOpen} title="Void this violation" description="Use this when the staff member contested the violation and it was cleared. No fine is owed and nothing is added to the violation fund. It cannot be undone, and the person who reported it cannot void it.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", `violations/${id}/void`, { reason }), { success: "Violation voided. No fine was added to the fund." }); if (ok) { setOpen(false); setReason(""); } }}>
          <Field id={`vr-${id}`} label="Why was it cleared?"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={2000} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !reason.trim()}>{pending ? "Voiding…" : "Void violation"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

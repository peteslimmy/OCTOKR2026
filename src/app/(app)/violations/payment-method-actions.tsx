"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Field, Input } from "@/components/ui/primitives";

type Method = { id: string; code: string; name: string; is_deduction: boolean; active: boolean; used?: number };

function MethodForm({ method, onDone }: { method?: Method; onDone: () => void }) {
  const [f, setF] = useState({ code: method?.code ?? "", name: method?.name ?? "", isDeduction: method?.is_deduction ?? false, active: method?.active ?? true });
  const { run, pending } = useAction();
  return (
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => apiRequest("POST", "payment-methods", { id: method?.id, ...f }), { success: method ? "Payment method saved." : "Payment method added." }); if (ok) onDone(); }}>
      <Field id="pmt-name" label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} placeholder="Paid out of pocket" /></Field>
      <Field id="pmt-code" label="Code" hint={method ? "The code cannot be changed: it starts every reference already issued." : "Exactly three letters or digits, unique. It starts every payment reference, for example POC-2026-000001."}>
        <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) })} required minLength={3} maxLength={3} disabled={!!method} className="font-mono uppercase" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isDeduction} onChange={(e) => setF({ ...f, isDeduction: e.target.checked })} />Deducted from salary (recorded in payroll)</label>
      {method ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />In use (offered when recording a payment)</label> : null}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit" disabled={pending || !f.name.trim() || f.code.length !== 3}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

export function AddPaymentMethodButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Add payment method</Button>
      <Modal open={open} onOpenChange={setOpen} title="Add a payment method" description="For example paid out of pocket, bank transfer or cash."><MethodForm onDone={() => setOpen(false)} /></Modal>
    </>
  );
}

export function EditPaymentMethodButton({ method }: { method: Method }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Edit ${method.name}`}><MethodForm method={method} onDone={() => setOpen(false)} /></Modal>
    </>
  );
}

/** Deletes a payment method that has never been used. A used one keeps its code on payments and references, so it can only be switched to not in use (Edit). */
export function DeletePaymentMethodButton({ method }: { method: Method }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const router = useRouter();
  const used = method.used ?? 0;
  if (used > 0) {
    return <span className="text-xs text-muted" title="Payments and references already carry this code">Used, so it cannot be deleted. Switch it to not in use (Edit).</span>;
  }
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`Delete ${method.name}`}>Delete</Button>
      <Modal open={open} onOpenChange={setOpen} title={`Delete ${method.name}?`} description={`The method ${method.code} has never been used, so no payment, reference or report is affected. The deletion is recorded in the audit log and cannot be undone; you can add the method again later.`}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
          <Button variant="danger" disabled={pending} onClick={async () => { const ok = await run(() => apiRequest("POST", `payment-methods/${method.id}/delete`, {}), { success: "Payment method deleted." }); if (ok) { setOpen(false); router.refresh(); } }}>{pending ? "Deleting…" : "Delete"}</Button>
        </div>
      </Modal>
    </>
  );
}

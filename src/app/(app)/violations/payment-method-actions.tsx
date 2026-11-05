"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Field, Input } from "@/components/ui/primitives";

type Method = { id: string; code: string; name: string; is_deduction: boolean; active: boolean };

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

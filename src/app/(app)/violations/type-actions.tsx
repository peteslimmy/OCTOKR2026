"use client";

import { useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Button, Field, Input, Label, Select, Textarea } from "@/components/ui/primitives";

export interface TypeRow { id: string; code: string; name: string; criticality: string; default_fine: number; active: boolean }

/** Change a violation type's name, criticality, default fine or whether it can be used. Earlier violations keep the fine they were raised with. */
export function EditTypeButton({ type }: { type: TypeRow }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: type.name, criticality: type.criticality, defaultFine: String(type.default_fine), active: type.active, reason: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const changed = f.name !== type.name || f.criticality !== type.criticality || Number(f.defaultFine) !== Number(type.default_fine) || f.active !== type.active;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Edit<span className="sr-only"> {type.name}</span></Button>
      <Modal open={open} onOpenChange={setOpen} title={`Edit ${type.name}`} description="A change to the fine applies to violations raised from now on; earlier violations keep the fine they were raised with. A Super Admin's change applies at once; anyone else's waits for a different Admin or Super Admin.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => apiRequest("POST", "config-changes", { topic: "VIOLATION_TYPE", target: type.id, reason: f.reason, idempotencyKey: key,
            proposed: { action: "UPDATE", name: f.name, criticality: f.criticality, defaultFine: Number(f.defaultFine), active: f.active } }), { success: "Sent for approval. A different Admin or Super Admin must approve the change." });
          if (ok) { setOpen(false); setKey(crypto.randomUUID()); setF({ ...f, reason: "" }); }
        }}>
          <Field id={`et-name-${type.id}`} label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></Field>
          <div><Label htmlFor={`et-crit-${type.id}`}>Criticality</Label><Select id={`et-crit-${type.id}`} value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</Select></div>
          <Field id={`et-fine-${type.id}`} label="Default fine (₦)"><Input type="number" step="0.01" min="0.01" value={f.defaultFine} onChange={(e) => setF({ ...f, defaultFine: e.target.value })} required /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Can be used when reporting a violation</label>
          <Field id={`et-reason-${type.id}`} label="Reason"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} required rows={2} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || !changed || !f.reason.trim()}>Save change</Button></div>
        </form>
      </Modal>
    </>
  );
}

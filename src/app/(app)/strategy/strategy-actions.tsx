"use client";

import { useState } from "react";
import { apiRequest, ConfirmButton, Modal, useAction } from "@/components/ui/client";
import { Button, Input, Textarea, Field } from "@/components/ui/primitives";

function TextDialog({ open, onOpenChange, title, description, initial, withReason, submitLabel, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; initial?: { title?: string; description?: string | null };
  withReason?: boolean; submitLabel: string; onSubmit: (v: { title: string; description: string; reason: string }) => Promise<unknown>;
}) {
  const [t, setT] = useState(initial?.title ?? "");
  const [d, setD] = useState(initial?.description ?? "");
  const [r, setR] = useState("");
  const { run, pending } = useAction();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => onSubmit({ title: t, description: d, reason: r }), { success: "Saved." }); if (ok !== undefined) { onOpenChange(false); setT(initial?.title ?? ""); setD(initial?.description ?? ""); setR(""); } }}>
        <Field id="td-title" label="Title"><Input value={t} onChange={(e) => setT(e.target.value)} required maxLength={500} /></Field>
        {withReason === undefined || withReason === false ? <Field id="td-desc" label="Description (optional)"><Textarea value={d} onChange={(e) => setD(e.target.value)} maxLength={4000} /></Field> : null}
        {withReason ? <Field id="td-reason" label="Justification (required, audited)"><Textarea value={r} onChange={(e) => setR(e.target.value)} required maxLength={2000} /></Field> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending || !t.trim() || (withReason === true && !r.trim())}>{pending ? "Saving…" : submitLabel}</Button></div>
      </form>
    </Modal>
  );
}

export function CreateTheme({ year }: { year: number }) {
  const [open, setOpen] = useState(false);
  return (<><Button size="sm" onClick={() => setOpen(true)}>Set annual theme</Button>
    <TextDialog open={open} onOpenChange={setOpen} title={`Annual theme ${year}`} description="Exactly one theme exists per year." submitLabel="Save theme" withReason={false}
      onSubmit={(v) => apiRequest("POST", "strategy/annual-themes", { year, theme: v.title })} /></>);
}

export function ChangeTheme({ themeId, current }: { themeId: string; current: string }) {
  const [open, setOpen] = useState(false);
  return (<><Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Change theme (exceptional)</Button>
    <TextDialog open={open} onOpenChange={setOpen} title="Exceptional theme change" description="SuperAdmin only. The old and new theme, your justification and the time are preserved in the audit history." initial={{ title: current }} withReason submitLabel="Change theme"
      onSubmit={(v) => apiRequest("POST", `strategy/annual-themes/${themeId}/change`, { theme: v.title, reason: v.reason })} /></>);
}

export function CreateQuarters({ year }: { year: number }) {
  const { run, pending } = useAction();
  return <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => apiRequest("POST", "strategy/quarters", { year }), { success: `Quarters for ${year} ensured.` })}>Create {year} quarters</Button>;
}

export function ObjectiveForm({ quarterId }: { quarterId: string }) {
  const [open, setOpen] = useState(false);
  return (<><Button onClick={() => setOpen(true)}>Create quarterly objective</Button>
    <TextDialog open={open} onOpenChange={setOpen} title="Quarterly objective" description="One objective per quarter." submitLabel="Create objective"
      onSubmit={(v) => apiRequest("POST", "strategy/objectives", { quarterId, title: v.title, description: v.description || null })} /></>);
}

export function AddKeyResult({ objectiveId, count }: { objectiveId: string; count: number }) {
  const [open, setOpen] = useState(false);
  return (<><Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Add key result ({count}/4)</Button>
    <TextDialog open={open} onOpenChange={setOpen} title="Add key result" description="A quarter has 3–4 key results." submitLabel="Add key result"
      onSubmit={(v) => apiRequest("POST", `strategy/objectives/${objectiveId}/key-results`, { title: v.title, description: v.description || null })} /></>);
}

export function AddSubKr({ krId }: { krId: string }) {
  const [open, setOpen] = useState(false);
  return (<><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>+ Add Sub-KR</Button>
    <TextDialog open={open} onOpenChange={setOpen} title="Add Sub-KR" description="Weekly goals map to exactly one Sub-KR." submitLabel="Add Sub-KR"
      onSubmit={(v) => apiRequest("POST", `strategy/key-results/${krId}/sub-key-results`, { title: v.title, description: v.description || null })} /></>);
}

export function EditText({ kind, id, title, description, label }: { kind: "objectives" | "key-results" | "sub-key-results"; id: string; title: string; description: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  return (<><Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${label}`}>Edit</Button>
    <TextDialog open={open} onOpenChange={setOpen} title={`Edit ${label}`} initial={{ title, description }} submitLabel="Save"
      onSubmit={(v) => apiRequest("PATCH", `strategy/${kind}/${id}`, { title: v.title, description: v.description || null })} /></>);
}

export function ActivateButton({ quarterId, disabled }: { quarterId: string; disabled: boolean }) {
  const { run } = useAction();
  return <ConfirmButton label="Activate quarter" disabled={disabled} title="Activate this quarter?" description="The quarter becomes active and its reporting weeks are scheduled. BU Leads can then create weekly reports against its Sub-KRs."
    onConfirm={() => run(() => apiRequest("POST", `strategy/quarters/${quarterId}/activate`), { success: "Quarter activated." })} />;
}

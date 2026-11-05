"use client";

import { useState, type ReactNode } from "react";
import { Button, Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { Modal, useAction } from "@/components/ui/client";
import type { Person } from "@/lib/session-notes/types";

export function TextF({ id, label, value, onChange, hint, required, type = "text", max, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; required?: boolean; type?: string; max?: number; placeholder?: string;
}) {
  return <Field id={id} label={label} hint={hint} required={required}><Input type={type} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></Field>;
}

export function AreaF({ id, label, value, onChange, hint, required, rows = 3, max }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; required?: boolean; rows?: number; max?: number }) {
  return <Field id={id} label={label} hint={hint} required={required}><Textarea rows={rows} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} /></Field>;
}

export function SelectF({ id, label, value, onChange, options, placeholder, required, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; placeholder?: string; required?: boolean; hint?: string;
}) {
  return (
    <Field id={id} label={label} required={required} hint={hint}>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </NativeSelect>
    </Field>
  );
}

/** Chooses a person; people of the given unit are listed first. Only active people are ever offered. */
export function PersonF({ id, label, people, value, onChange, unit, required, placeholder = "Choose a person", hint }: {
  id: string; label: string; people: Person[]; value: string; onChange: (v: string) => void; unit?: string | null; required?: boolean; placeholder?: string; hint?: string;
}) {
  const sorted = [...people].sort((a, b) => Number(b.business_unit_id === unit) - Number(a.business_unit_id === unit) || a.name.localeCompare(b.name));
  return (
    <SelectF id={id} label={label} value={value} onChange={onChange} required={required} hint={hint} placeholder={placeholder}
      options={sorted.map((p) => [p.id, `${p.name} — ${p.business_unit_name}`] as const)} />
  );
}

/**
 * A button that opens a small form in a dialog. onSubmit runs through the app's action helper (success message, error message with the database's plain-language reason,
 * page refresh); the dialog stays open when it fails, so nothing typed is lost.
 */
export function DialogForm({ label, title, description, submitLabel = "Save", success, onSubmit, canSubmit = true, children, variant = "secondary", size = "sm", onOpen, wide }: {
  label: ReactNode; title: string; description?: string; submitLabel?: string; success?: string; onSubmit: () => Promise<unknown>; canSubmit?: boolean; children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; onOpen?: () => void; wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  return (
    <>
      <Button variant={variant} size={size} onClick={() => { onOpen?.(); setOpen(true); }}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        <form className={wide ? "space-y-3" : "space-y-3"} onSubmit={async (e) => { e.preventDefault(); const r = await run(onSubmit, { success }); if (r) setOpen(false); }}>
          {children}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={variant === "danger" ? "danger" : "primary"} type="submit" disabled={!canSubmit || pending}>{pending ? "Working…" : submitLabel}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

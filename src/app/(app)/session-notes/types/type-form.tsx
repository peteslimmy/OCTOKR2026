"use client";

import { useState } from "react";
import { DialogForm, TextF } from "@/components/session-notes/forms";
import { apiRequest } from "@/components/ui/client";

interface SessionType { id: string; code: string; name: string; description: string | null; sort_order: number; active: boolean }

/** Adds a session type, or changes the name, order and whether it is in use (its code never changes). */
export function TypeForm({ type }: { type?: SessionType }) {
  const [code, setCode] = useState(type?.code ?? "");
  const [name, setName] = useState(type?.name ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [order, setOrder] = useState(String(type?.sort_order ?? 100));
  const [active, setActive] = useState(type?.active ?? true);
  return (
    <DialogForm label={type ? "Change" : "Add a session type"} variant={type ? "ghost" : "primary"} size={type ? "sm" : "md"} title={type ? `Change ${type.name}` : "Add a session type"} submitLabel="Save" success="Saved."
      canSubmit={name.trim().length > 0 && (!!type || /^[A-Z][A-Z0-9_]{1,39}$/.test(code))}
      onSubmit={() => apiRequest("POST", "okr-session-types", { id: type?.id, code: type ? undefined : code, name: name.trim(), description: description.trim() || null, sortOrder: Number(order) || 0, active })}>
      {!type ? <TextF id="st-code" label="Code" value={code} onChange={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} required max={40} hint="Capital letters, digits and underscores. It cannot be changed later." /> : null}
      <TextF id="st-name" label="Name" value={name} onChange={setName} required max={100} />
      <TextF id="st-desc" label="Description" value={description} onChange={setDescription} max={500} />
      <TextF id="st-order" label="Order in lists" type="number" value={order} onChange={setOrder} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use (offered when starting a session)</label>
    </DialogForm>
  );
}

"use client";

import { useMemo, useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Input, NativeSelect, Select, Textarea } from "@/components/ui/primitives";

export interface RoleView { id: string; code: string; name: string; description: string | null; members: number; permissions: string[]; requiresMfa: boolean; isSystem: boolean }
export interface PermissionView { code: string; description: string; protected: boolean; reserved?: boolean; module: string; risk: "low" | "medium" | "high" | "critical" }

const RISK_TONE = { low: "info", medium: "info", high: "warn", critical: "critical" } as const;

/**
 * The permissions as a checklist grouped by module, with a search, a risk label on each and "select all" for a module. Ticking one the person does not
 * hold themselves is not offered (the database refuses it anyway). The summary names what would be added or taken away.
 */
function PermissionPicker({ all, held, value, original, onChange }: { all: PermissionView[]; held: Set<string>; value: string[]; original: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, PermissionView[]>();
    const needle = q.trim().toLowerCase();
    for (const p of all) if (!needle || `${p.code} ${p.description} ${p.module}`.toLowerCase().includes(needle)) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all, q]);
  const added = value.filter((v) => !original.includes(v)), removed = original.filter((v) => !value.includes(v));
  const toggleModule = (perms: PermissionView[], on: boolean) => {
    const codes = perms.filter((p) => held.has(p.code) || value.includes(p.code)).map((p) => p.code);
    onChange(on ? [...new Set([...value, ...codes])] : value.filter((v) => !codes.includes(v)));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search permissions" placeholder="Search permissions…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-64" />
        <span className="text-xs text-muted">{value.length} selected</span>
        {(added.length || removed.length) ? <span className="text-xs"><span className="text-[var(--done-fg)]">+{added.length} added</span> · <span className="text-[var(--notdone-fg)]">−{removed.length} removed</span></span> : null}
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-line p-3" role="group" aria-label="Permissions">
        {groups.length === 0 ? <p className="text-sm text-muted">No permission matches “{q}”.</p> : null}
        {groups.map(([name, perms]) => {
          const selectable = perms.filter((p) => held.has(p.code) || value.includes(p.code));
          const all_ = selectable.length > 0 && selectable.every((p) => value.includes(p.code));
          return (
            <fieldset key={name}>
              <legend className="flex w-full items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
                <span>{name} <span className="font-normal normal-case">({perms.filter((p) => value.includes(p.code)).length}/{perms.length})</span></span>
                <button type="button" className="font-normal normal-case text-brand-700 underline" onClick={() => toggleModule(perms, !all_)}>{all_ ? "Clear all" : "Select all"}</button>
              </legend>
              <ul className="mt-1 space-y-1">
                {perms.map((p) => {
                  const on = value.includes(p.code);
                  const mayAdd = held.has(p.code) || on;                              // an existing permission can stay or be removed; adding needs you to hold it
                  return (
                    <li key={p.code}>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={on} disabled={!mayAdd} onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((x) => x !== p.code))} />
                        <span><span className="font-mono text-xs">{p.code}</span> <Badge tone={RISK_TONE[p.risk]}>{p.risk}</Badge>{p.protected ? <> <Badge tone="warn">Protected</Badge></> : null}{p.reserved ? <> <Badge tone="critical" title="Only a role that can manage roles can hold this">Super Admin tier</Badge></> : null}
                          <span className="block text-xs text-muted">{p.description}{!mayAdd ? " You do not hold this permission, so you cannot give it to a role." : ""}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

type Mode = { kind: "create" } | { kind: "edit"; role: RoleView } | { kind: "delete"; role: RoleView };

export function RoleAdmin({ roles, permissions, mine }: { roles: RoleView[]; permissions: PermissionView[]; mine: string[] }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const held = useMemo(() => new Set(mine), [mine]);
  const [f, setF] = useState({ code: "", name: "", description: "", permissions: [] as string[], requiresMfa: false, reason: "", moveTo: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, pending } = useAction();
  const protectedSet = useMemo(() => new Set(permissions.filter((p) => p.protected).map((p) => p.code)), [permissions]);

  const open = (m: Mode) => {
    setMode(m); setKey(crypto.randomUUID());
    if (m.kind === "create") setF({ code: "", name: "", description: "", permissions: [], requiresMfa: false, reason: "", moveTo: "" });
    else setF({ code: m.role.code, name: m.role.name, description: m.role.description ?? "", permissions: m.role.permissions, requiresMfa: m.role.requiresMfa, reason: "", moveTo: "" });
  };
  const current = mode && mode.kind !== "create" ? mode.role : null;
  const touchesProtected = mode?.kind === "delete" ? (current?.permissions ?? []).some((p) => protectedSet.has(p))
    : (() => {
      const before = new Set(current?.permissions ?? []); const after = new Set(f.permissions);
      return permissions.some((p) => p.protected && before.has(p.code) !== after.has(p.code)) || f.requiresMfa !== (current?.requiresMfa ?? false);
    })();

  const submit = async () => {
    if (!mode) return;
    const proposed = mode.kind === "delete" ? { action: "DELETE", moveTo: f.moveTo || undefined }
      : { action: mode.kind === "create" ? "CREATE" : "UPDATE", code: mode.kind === "create" ? f.code.trim().toUpperCase() : undefined, name: f.name, description: f.description || null, permissions: f.permissions, requiresMfa: f.requiresMfa };
    const target = mode.kind === "create" ? f.code.trim().toUpperCase() : mode.role.id;
    const ok = await run(() => apiRequest("POST", "config-changes", { topic: "ROLE_CHANGE", target, proposed, reason: f.reason, idempotencyKey: key }),
      { success: touchesProtected ? "Sent for approval. This touches protected settings, so a Super Admin must approve it." : "Sent for approval. A different Admin or Super Admin must approve it." });
    if (ok) setMode(null);
  };
  const canSubmit = !pending && f.reason.trim() !== "" && (mode?.kind === "delete" ? (current?.members === 0 || f.moveTo !== "") : f.name.trim() !== "" && (mode?.kind !== "create" || /^[A-Za-z][A-Za-z0-9_]{1,29}$/.test(f.code.trim())));

  return (
    <>
      <div className="flex justify-end px-6 pt-4"><Button size="sm" onClick={() => open({ kind: "create" })}>New role</Button></div>
      <ul className="divide-y divide-line" aria-label="Roles">
        {roles.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
            <div>
              <p className="font-medium">{r.name} <span className="font-mono text-xs text-muted">{r.code}</span></p>
              <p className="text-xs text-muted">{r.description ?? "No description"} · {r.members} {r.members === 1 ? "person" : "people"} · {r.permissions.length} permissions</p>
              <p className="flex flex-wrap gap-1 pt-1">{r.requiresMfa ? <Badge tone="info">Authenticator required</Badge> : null}{r.permissions.some((p) => protectedSet.has(p)) ? <Badge tone="warn">Holds protected permissions</Badge> : null}</p>
            </div>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => open({ kind: "edit", role: r })}>Edit<span className="sr-only"> {r.name}</span></Button>
              <Button size="sm" variant="danger" onClick={() => open({ kind: "delete", role: r })}>Delete<span className="sr-only"> {r.name}</span></Button>
            </span>
          </li>
        ))}
      </ul>
      <Modal open={mode !== null} onOpenChange={(o) => { if (!o) setMode(null); }}
        title={mode?.kind === "create" ? "New role" : mode?.kind === "edit" ? `Edit ${current?.name}` : `Delete ${current?.name}`}
        description={mode?.kind === "delete"
          ? "People who hold this role are moved to the role you choose. The last people able to manage roles can never be removed."
          : "Your request is sent to a different Admin or Super Admin. Nothing changes until it is approved."}>
        <div className="space-y-3">
          {mode?.kind === "delete" ? (
            current && current.members > 0 ? (
              <Field id="role-move" label={`Move the ${current.members} ${current.members === 1 ? "person" : "people"} to`}>
                <Select value={f.moveTo} onChange={(e) => setF({ ...f, moveTo: e.target.value })}><option value="">Choose a role…</option>{roles.filter((r) => r.id !== current.id).map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}</Select>
              </Field>
            ) : <p className="text-sm text-muted">Nobody holds this role.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field id="role-code" label="Code" hint={mode?.kind === "create" ? "Capital letters, digits and underscores" : "The code cannot change"}>
                  <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={mode?.kind !== "create"} maxLength={30} />
                </Field>
                <Field id="role-name" label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} /></Field>
              </div>
              <Field id="role-desc" label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresMfa} onChange={(e) => setF({ ...f, requiresMfa: e.target.checked })} />People with this role must use an authenticator app</label>
              {mode?.kind === "create" ? (
                <Field id="role-clone" label="Start from an existing role (optional)" hint="Copies its permissions, which you can then adjust. Only permissions you hold are copied.">
                  <Select value="" onChange={(e) => { const r = roles.find((x) => x.id === e.target.value); if (r) setF({ ...f, permissions: r.permissions.filter((p) => held.has(p)), requiresMfa: r.requiresMfa }); }}>
                    <option value="">Start empty</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.permissions.length} permissions)</option>)}
                  </Select>
                </Field>
              ) : null}
              <PermissionPicker all={permissions} held={held} value={f.permissions} original={current?.permissions ?? []} onChange={(v) => setF({ ...f, permissions: v })} />
              {mode?.kind === "edit" && current && current.members > 0 ? <p className="text-xs text-muted" role="note">This change affects {current.members} {current.members === 1 ? "person" : "people"} who hold this role.</p> : null}
            </>
          )}
          {touchesProtected ? <p className="text-xs text-muted" role="note">This touches protected permissions or the authenticator requirement, so only a Super Admin can approve it.</p> : null}
          <Field id="role-reason" label="Reason for the approver"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={mode?.kind === "delete" ? "danger" : "primary"} disabled={!canSubmit} onClick={submit}>Send for approval</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Button, Field, Input, NativeSelect, Select, Textarea } from "@/components/ui/primitives";

export interface RoleView { id: string; code: string; name: string; description: string | null; members: number; permissions: string[]; requiresMfa: boolean; isSystem: boolean }
export interface PermissionView { code: string; description: string; protected: boolean; reserved?: boolean }

const group = (code: string) => code.split(".")[0].replace(/_/g, " ");

/** The permissions as a checklist grouped by area. Ticking one the person does not hold themselves is not offered (the database refuses it anyway). */
function PermissionPicker({ all, held, value, onChange }: { all: PermissionView[]; held: Set<string>; value: string[]; onChange: (v: string[]) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, PermissionView[]>();
    for (const p of all) m.set(group(p.code), [...(m.get(group(p.code)) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all]);
  return (
    <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-line p-3" role="group" aria-label="Permissions">
      {groups.map(([name, perms]) => (
        <fieldset key={name}>
          <legend className="text-xs font-semibold tracking-wide text-muted uppercase">{name}</legend>
          <ul className="mt-1 space-y-1">
            {perms.map((p) => {
              const on = value.includes(p.code);
              const mayAdd = held.has(p.code) || on;                              // an existing permission can stay or be removed; adding needs you to hold it
              return (
                <li key={p.code}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={on} disabled={!mayAdd} onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((x) => x !== p.code))} />
                    <span><span className="font-mono text-xs">{p.code}</span>{p.protected ? <Badge tone="warn">Protected</Badge> : null}{p.reserved ? <Badge tone="critical" title="Only a role that can manage roles can hold this">Super Admin tier</Badge> : null}
                      <span className="block text-xs text-muted">{p.description}{!mayAdd ? " You do not hold this permission, so you cannot give it to a role." : ""}</span></span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
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
              <PermissionPicker all={permissions} held={held} value={f.permissions} onChange={(v) => setF({ ...f, permissions: v })} />
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

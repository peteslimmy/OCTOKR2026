"use client";

import { useMemo, useState } from "react";
import { apiRequest, ConfirmButton, useAction } from "@/components/ui/client";
import { Button, Field, Input, Select } from "@/components/ui/primitives";

export interface GrantableOption { code: string; module: string; description: string; risk: string }

/** Give this person one permission directly, for a reason and (optionally) until a date. The database checks conflicts of duties and reserved permissions. */
export function GrantForm({ userId, options }: { userId: string; options: GrantableOption[] }) {
  const { run, pending } = useAction();
  const [permission, setPermission] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const modules = useMemo(() => [...new Set(options.map((o) => o.module))].sort(), [options]);
  const chosen = options.find((o) => o.code === permission);
  const [{ minDate, maxDate }] = useState(() => ({ minDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10), maxDate: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10) }));
  return (
    <form className="space-y-3 px-6 py-4" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => apiRequest("POST", `users/${userId}/grants`, { permission, grant: true, reason, expiresAt: until ? `${until}T23:59:00+01:00` : null }), { success: "Permission granted." });
      if (ok) { setPermission(""); setReason(""); setUntil(""); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="grant-perm" label="Permission" hint={chosen ? chosen.description : "Only permissions the person does not already hold are listed."}>
          <Select value={permission} onChange={(e) => setPermission(e.target.value)} required>
            <option value="">Choose a permission…</option>
            {modules.map((m) => <optgroup key={m} label={m}>{options.filter((o) => o.module === m).map((o) => <option key={o.code} value={o.code}>{o.code}{o.risk === "critical" || o.risk === "high" ? ` · ${o.risk} risk` : ""}</option>)}</optgroup>)}
          </Select>
        </Field>
        <Field id="grant-until" label="Until (optional)" hint="Leave empty for no end date. A temporary grant stops by itself."><Input type="date" min={minDate} max={maxDate} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      </div>
      <Field id="grant-reason" label="Reason" hint="Recorded in the audit trail."><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required /></Field>
      <div className="flex justify-end"><Button type="submit" disabled={pending || !permission || !reason.trim()}>Grant permission</Button></div>
    </form>
  );
}

export function RevokeGrant({ userId, permission }: { userId: string; permission: string }) {
  const { run } = useAction();
  return (
    <ConfirmButton label="Remove" variant="secondary" title="Remove this direct grant?" description={`${permission} is taken away from this person unless one of their roles also gives it.`}
      onConfirm={() => run(() => apiRequest("POST", `users/${userId}/grants`, { permission, grant: false }), { success: "Grant removed." })} />
  );
}

/** Download the matrix as a spreadsheet-safe CSV. */
export function MatrixCsv({ roles, rows }: { roles: string[]; rows: { module: string; code: string; risk: string; has: boolean[] }[] }) {
  const download = () => {
    const esc = (v: string) => (/[",\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);
    const lines = [["Module", "Permission", "Risk", ...roles], ...rows.map((r) => [r.module, r.code, r.risk, ...r.has.map((h) => (h ? "Yes" : ""))])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "roles-and-permissions.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  return <Button size="sm" variant="secondary" onClick={download}>Download as CSV</Button>;
}

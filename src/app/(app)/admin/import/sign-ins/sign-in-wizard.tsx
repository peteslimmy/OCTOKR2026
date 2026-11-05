"use client";

import { Download, UserPlus } from "lucide-react";
import { useState } from "react";
import { apiRequest, apiUpload } from "@/components/ui/client";
import { describeFailure, FailurePanel, type Failure } from "@/components/import-feedback";
import { Badge, Button, Card, CardHeader, DataTable, Field, Input } from "@/components/ui/primitives";

interface Person { row: number; email: string; roles: string[]; name: string; unit: string }
interface Checked { fileName: string; people: Person[]; problems: { row: number; message: string; fix?: string }[]; problemCount: number }
interface Result { row: number; email: string; created: boolean; message: string | null; setupLink: string | null }
interface Done { results: Result[]; created: number }

const csv = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export function SignInWizard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const fail = (e: unknown) => setError(describeFailure(e, "The sign-in import"));

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setChecked(null); setDone(null);
    try { setChecked(await apiUpload<Checked>("sign-in-imports", file)); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function commit() {
    if (!checked) return;
    setBusy(true); setError(null);
    try { setDone(await apiRequest<Done>("POST", "sign-in-imports/commit", { people: checked.people.map((p) => ({ row: p.row, email: p.email, roles: p.roles })) })); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  function download() {
    if (!done) return;
    const lines = ["Email,Result,Set-password link", ...done.results.map((r) => [r.email, r.created ? "Created" : (r.message ?? "Not created"), r.setupLink ?? ""].map(csv).join(","))];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "sign-in-links.csv"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Choose the spreadsheet" description="Two columns: Email and Roles. Roles are role codes or names, separated by commas or semicolons (for example BU_LEAD, or BU Lead; Presenter). The person must already be an active employee without a sign-in." />
        <Field id="si-file" label="Spreadsheet (.xlsx or .csv)"><Input id="si-file" type="file" accept=".xlsx,.csv" disabled={busy || !!done} onChange={(e) => onFile(e.target.files?.[0])} /></Field>
        {busy && !checked ? <p role="status" className="mt-3 text-sm">Reading and checking the file…</p> : null}
        {error ? <FailurePanel f={error} /> : null}
      </Card>

      {checked && checked.problemCount > 0 ? (
        <Card>
          <CardHeader title="Some rows cannot be used" description={`${checked.problemCount} problem${checked.problemCount === 1 ? "" : "s"}. Fix the file and choose it again, or continue with the ${checked.people.length} valid row${checked.people.length === 1 ? "" : "s"} below.`} />
          <DataTable caption="Rows with problems" columns={[{ label: "Spreadsheet row" }, { label: "Problem" }, { label: "What to do" }]}>
            {checked.problems.map((p, i) => <tr key={i}><td className="tabular-nums">{p.row}</td><td>{p.message}</td><td className="text-sm">{p.fix}</td></tr>)}
          </DataTable>
        </Card>
      ) : null}

      {checked && checked.people.length > 0 && !done ? (
        <Card>
          <CardHeader title="2. Create the sign-ins" description="Each person gets the roles below and a one-time link to set a password. Roles that carry administration rights need the permission to manage roles. You need a fresh authenticator code." />
          <DataTable caption="Sign-ins to create" columns={[{ label: "Person" }, { label: "Unit" }, { label: "Roles" }]}>
            {checked.people.map((p) => <tr key={p.row}><td><p className="font-medium">{p.name}</p><p className="text-xs text-muted">{p.email}</p></td><td>{p.unit}</td><td><div className="flex flex-wrap gap-1">{p.roles.map((r) => <Badge key={r} tone="brand">{r}</Badge>)}</div></td></tr>)}
          </DataTable>
          <div className="mt-4"><Button disabled={busy} onClick={commit}><UserPlus className="h-4 w-4" aria-hidden /> {busy ? "Creating…" : `Create ${checked.people.length} sign-in${checked.people.length === 1 ? "" : "s"}`}</Button></div>
        </Card>
      ) : null}

      {done ? (
        <Card>
          <CardHeader title={`${done.created} of ${done.results.length} created`} description="The links are shown only now and are not stored. Download them and send each person their own link; each works once." action={<Button variant="secondary" onClick={download}><Download className="h-4 w-4" aria-hidden /> Download links</Button>} />
          <DataTable caption="Results" columns={[{ label: "Email" }, { label: "Result" }]}>
            {done.results.map((r) => <tr key={r.row}><td>{r.email}</td><td>{r.created ? <Badge tone="done">created</Badge> : <span>{r.message}</span>}</td></tr>)}
          </DataTable>
        </Card>
      ) : null}
    </div>
  );
}

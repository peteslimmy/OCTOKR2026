"use client";

import { CheckCircle2, Upload, FileSpreadsheet, Download } from "lucide-react";
import { useState } from "react";
import { apiRequest, apiUpload, ApiFailure } from "@/components/ui/client";
import { Button, Card, CardHeader, DataTable, Field, Input } from "@/components/ui/primitives";

interface Row { row_no: number; year: number; quarter: number; objective: string; kr_no: number; kr_title: string; sub_no: number; sub_title: string }
interface Checked { fileName: string; sha256: string; rows: Row[]; quarters: string[]; issues: { row: number; message: string }[]; issueCount: number }
interface Done { objectives: number; key_results: number; sub_key_results: number; already_imported?: boolean; quarters: { year: number; quarter: number; status: string }[] }

// Strategy import template CSV
const STRATEGY_TEMPLATE = `Year,Quarter,Objective,KR,KR title,Sub-KR,Sub-KR title
2025,Q1,Launch core product,1,Market readiness,1.1,Define MVP scope
2025,Q1,Launch core product,1,Market readiness,1.2,Complete user testing
2025,Q1,Launch core product,2,Technical excellence,2.1,API stability at 99.9%
2025,Q1,Launch core product,2,Technical excellence,2.2,Zero critical bugs`;

function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function StrategyWizard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const fail = (e: unknown) => setError(e instanceof ApiFailure ? e.message : "Something went wrong. Nothing was changed.");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setChecked(null); setDone(null); setConfirm("");
    try { setChecked(await apiUpload<Checked>("strategy-imports", file)); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function commit() {
    if (!checked) return;
    setBusy(true); setError(null);
    try { setDone(await apiRequest<Done>("POST", "strategy-imports/commit", { rows: checked.rows, fileName: checked.fileName, fileSha256: checked.sha256, confirm })); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const clean = checked && checked.issueCount === 0;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Choose the spreadsheet" description="One row per Sub-KR: Year, Quarter, Objective, KR, KR title, Sub-KR, Sub-KR title. A blank Year, Quarter, Objective, KR or KR title repeats the row above. Each quarter needs one objective, 3 or 4 key results numbered from 1, and at least one Sub-KR under each." />
        <Field id="strat-file" label="Spreadsheet (.xlsx or .csv)"><Input id="strat-file" type="file" accept=".xlsx,.csv" disabled={busy || !!done} onChange={(e) => onFile(e.target.files?.[0])} /></Field>
        <div className="flex flex-wrap items-center gap-3 text-sm mt-2">
          <FileSpreadsheet className="h-4 w-4 text-muted" aria-hidden />
          <span className="text-muted">Columns: Year, Quarter (1-4 or Q1-Q4), Objective, KR (1-4), KR title, Sub-KR, Sub-KR title</span>
          <Button size="sm" variant="secondary" onClick={() => download("strategy-import-template.csv", STRATEGY_TEMPLATE)}>
            <Download className="h-4 w-4" aria-hidden />Download template
          </Button>
        </div>
        {busy && !checked ? <p role="status" className="mt-3 text-sm">Reading and checking the file…</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-lg bg-[var(--critical-bg)] px-3 py-2 text-sm font-medium text-[var(--critical-fg)]">{error}</p> : null}
      </Card>

      {checked && !clean ? (
        <Card>
          <CardHeader title="The file cannot be imported yet" description={`${checked.issueCount} problem${checked.issueCount === 1 ? "" : "s"}. Nothing was saved. Fix the file and choose it again.`} />
          <DataTable caption="Problems" columns={[{ label: "Spreadsheet row" }, { label: "Problem" }]}>
            {checked.issues.map((p, i) => <tr key={i}><td className="tabular-nums">{p.row || "—"}</td><td>{p.message}</td></tr>)}
          </DataTable>
        </Card>
      ) : null}

      {clean && !done ? (
        <Card>
          <CardHeader title="2. Check and import" description={`${checked.rows.length} Sub-KRs for ${checked.quarters.join(", ")} passed every check. A quarter that has ended is stored as locked so its reports can be attached; any other quarter is stored as planned and activated in the normal way. No second approver is needed; it takes your authenticator code and the confirmation below.`} />
          <DataTable caption="What will be imported" columns={[{ label: "Quarter" }, { label: "Objective" }, { label: "KR" }, { label: "Sub-KR" }]}>
            {checked.rows.map((r) => <tr key={r.row_no}><td className="whitespace-nowrap">{r.year} Q{r.quarter}</td><td>{r.objective}</td><td>KR{r.kr_no} {r.kr_title}</td><td>KR{r.kr_no}.{r.sub_no} {r.sub_title}</td></tr>)}
          </DataTable>
          <div className="mt-4"><Field id="strat-confirm" label="Type IMPORT STRATEGY to confirm"><Input id="strat-confirm" value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} /></Field></div>
          <div className="mt-3"><Button disabled={busy || confirm !== "IMPORT STRATEGY"} onClick={commit}><Upload className="h-4 w-4" aria-hidden /> {busy ? "Importing…" : "Import strategy"}</Button></div>
        </Card>
      ) : null}

      {done ? (
        <p role="status" className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4" aria-hidden />
          {done.already_imported ? "This file was already imported; nothing changed. " : "Imported. "}{done.objectives} quarter{done.objectives === 1 ? "" : "s"}, {done.key_results} key results and {done.sub_key_results} Sub-KRs ({done.quarters.map((q) => `${q.year} Q${q.quarter} ${q.status.toLowerCase()}`).join(", ")}).</p>
      ) : null}
    </div>
  );
}

"use client";

import { CheckCircle2, FlaskConical, Upload, FileSpreadsheet, Download } from "lucide-react";
import { useState } from "react";
import { apiRequest, apiUpload, ApiFailure } from "@/components/ui/client";
import { Badge, Button, Card, CardHeader, DataTable, Field, Input } from "@/components/ui/primitives";

interface Problem { row: number; message: string }
interface Uploaded {
  staged: boolean; batchId?: string; rows: number; issueCount?: number; issues?: Problem[]; fileName?: string;
  fileProblems?: Problem[]; fileProblemCount?: number; unknownUnits?: string[];
}
interface Score { year: number; quarter: number; unit: string; unit_name: string; score: number | null; status: string; weeks_counted: number; weeks_without_report: number }
interface Outcome {
  reports: number; goals: number; tasks: number; tasks_done: number; quarters_created: number; weeks_with_rows: number; weeks_without_rows_scored: number;
  placeholders: { objectives: number; key_results: number; sub_key_results: number }; units_backdated: { business_unit_id: string; from: string }[];
  per_quarter: { year: number; quarter: number; weeks: number; reports: number }[]; quarterly_scores: Score[]; rehearsal?: boolean; already_committed?: boolean;
}
const pct = (n: number | null) => (n === null || n === undefined ? "—" : `${Number(n).toFixed(1)}%`);

// History import template CSV (one row per goal with tasks/statuses)
const HISTORY_TEMPLATE = `Year,Week,BU/Depart,SubKR,Goal,Task 1,Status 1,Task 2,Status 2,Task 3,Status 3
2025,1,ENG,1.1,"Improve API latency",Add caching,DONE,Optimize queries,NOT_DONE,Write tests,DONE
2025,1,ENG,1.2,"Reduce error rate",Add retry logic,DONE,Improve monitoring,NOT_DONE,,
2025,2,OPS,2.1,"Automate deployments",Create pipeline,DONE,Add staging,NOT_DONE,,`;

function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function HistoryWizard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [up, setUp] = useState<Uploaded | null>(null);
  const [fillGaps, setFillGaps] = useState(false);
  const [rehearsal, setRehearsal] = useState<Outcome | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [confirm, setConfirm] = useState("");
  const fail = (e: unknown) => setError(e instanceof ApiFailure ? e.message : "Something went wrong. Nothing was changed.");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setUp(null); setRehearsal(null); setResult(null);
    try { setUp(await apiUpload<Uploaded>("history-imports", file)); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function rehearse() {
    if (!up?.batchId) return;
    setBusy(true); setError(null);
    try { setRehearsal(await apiRequest<Outcome>("POST", `history-imports/${up.batchId}/rehearse`, { fillGaps })); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function commit() {
    if (!up?.batchId) return;
    setBusy(true); setError(null);
    try { setResult(await apiRequest<Outcome>("POST", `history-imports/${up.batchId}/commit`, { fillGaps, confirm })); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const clean = up?.staged && up.issueCount === 0;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Choose the spreadsheet" description="One row per goal: Year, Week, BU/Depart, SubKR, Goal, then Task 1 / Status 1, Task 2 / Status 2 and so on. Status is Done or Not Done. Blank Year, Week or BU cells repeat the row above. Only quarters that have ended can be loaded." />
        <Field id="hist-file" label="Spreadsheet (.xlsx or .csv, up to 10 MB and 20,000 rows)">
          <Input id="hist-file" type="file" accept=".xlsx,.csv" disabled={busy || !!result} onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-sm mt-2">
          <FileSpreadsheet className="h-4 w-4 text-muted" aria-hidden />
          <span className="text-muted">Columns: Year, Week, BU/Depart, SubKR (optional), Goal, Task 1, Status 1, Task 2, Status 2… (up to 10 tasks)</span>
          <Button size="sm" variant="secondary" onClick={() => download("history-import-template.csv", HISTORY_TEMPLATE)}>
            <Download className="h-4 w-4" aria-hidden />Download template
          </Button>
        </div>
        {busy && !up ? <p role="status" className="mt-3 text-sm text-ink-600">Reading and checking the file…</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-lg bg-[var(--critical-bg)] px-3 py-2 text-sm font-medium text-[var(--critical-fg)]">{error}</p> : null}
      </Card>

      {up && !up.staged ? (
        <Card>
          <CardHeader title="The file cannot be read yet" description={`${up.fileProblemCount} row${up.fileProblemCount === 1 ? "" : "s"} need fixing in the spreadsheet. Nothing was saved. Fix the file and choose it again.`} />
          {up.unknownUnits?.length ? <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">Business Units not found: {up.unknownUnits.map((u) => <Badge key={u} tone="warn">{u}</Badge>)} Add them under Business Units first, or correct the spelling.</p> : null}
          <ProblemTable problems={up.fileProblems ?? []} total={up.fileProblemCount ?? 0} />
        </Card>
      ) : null}

      {up?.staged && !clean ? (
        <Card>
          <CardHeader title="Some rows cannot be loaded" description={`${up.issueCount} problem${up.issueCount === 1 ? "" : "s"} found by the application's rules. Fix the file and choose it again; nothing was changed.`} />
          <ProblemTable problems={up.issues ?? []} total={up.issueCount ?? 0} />
        </Card>
      ) : null}

      {clean ? (
        <Card>
          <CardHeader title="2. Rehearse" description={`${up.rows} rows from ${up.fileName} passed every check. A rehearsal runs the real import and the real scoring, then undoes everything, so you can see the recomputed scores before anything is written.`} />
          <label className="mb-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={fillGaps} disabled={busy || !!result} onChange={(e) => { setFillGaps(e.target.checked); setRehearsal(null); }} />
            <span>Also score the weeks of these quarters that have no rows. A unit with no report for a week is then recorded as a missed report (a zero), exactly as if it had happened live. Leave this off if the sheet only lists weeks where a report was sent.</span>
          </label>
          <Button disabled={busy || !!result} onClick={rehearse}><FlaskConical className="h-4 w-4" aria-hidden /> {busy ? "Working…" : "Rehearse the import"}</Button>
        </Card>
      ) : null}

      {rehearsal || result ? <OutcomeView outcome={(result ?? rehearsal) as Outcome} final={!!result} /> : null}

      {rehearsal && !result ? (
        <Card>
          <CardHeader title="3. Import" description="This writes the reports, closes the weeks and records the scores in one step. The application never deletes reports, so it cannot be undone from here. Make sure a database backup is recent. No second person approves this; it needs your authenticator code and the confirmation below." />
          <Field id="hist-confirm" label="Type IMPORT HISTORY to confirm"><Input id="hist-confirm" value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} /></Field>
          <div className="mt-3"><Button disabled={busy || confirm !== "IMPORT HISTORY"} onClick={commit}><Upload className="h-4 w-4" aria-hidden /> {busy ? "Importing…" : "Import history"}</Button></div>
        </Card>
      ) : null}
      {result ? <p role="status" className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4" aria-hidden /> Imported. These reports and scores are now part of the record.</p> : null}
    </div>
  );
}

function ProblemTable({ problems, total }: { problems: Problem[]; total: number }) {
  return (
    <>
      <DataTable caption="Rows to fix" columns={[{ label: "Spreadsheet row" }, { label: "Problem" }]}>
        {problems.map((p, i) => <tr key={`${p.row}-${i}`}><td className="tabular-nums">{p.row}</td><td>{p.message}</td></tr>)}
      </DataTable>
      {total > problems.length ? <p className="mt-2 text-sm">Showing the first {problems.length} of {total}.</p> : null}
    </>
  );
}

function OutcomeView({ outcome: o, final }: { outcome: Outcome; final: boolean }) {
  return (
    <Card>
      <CardHeader title={final ? "Imported" : "Rehearsal result (nothing was saved)"} description={`${o.reports} reports, ${o.goals} goals and ${o.tasks} tasks (${o.tasks_done} done) across ${o.weeks_with_rows} weeks${o.weeks_without_rows_scored ? `, plus ${o.weeks_without_rows_scored} weeks with no rows scored as missed` : ""}.`} />
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
        {o.quarters_created ? <li>{o.quarters_created} quarter{o.quarters_created === 1 ? "" : "s"} did not exist and will be created as closed quarters, with placeholder strategy ({o.placeholders.objectives} objective, {o.placeholders.key_results} key results, {o.placeholders.sub_key_results} Sub-KRs) because the real wording was never entered here.</li> : null}
        {o.units_backdated.length ? <li>{o.units_backdated.length} Business Unit{o.units_backdated.length === 1 ? " is" : "s are"} treated as existing from its first week in the file, so earlier weeks do not count against it.</li> : null}
        <li>Imported reports are recorded as submitted and reviewed. No notification, email or webhook is sent.</li>
      </ul>
      <DataTable caption="Recomputed quarterly scores" columns={[{ label: "Quarter" }, { label: "Unit" }, { label: "Score" }, { label: "Weeks counted" }, { label: "Weeks without a report" }, { label: "State" }]}>
        {o.quarterly_scores.map((s) => (
          <tr key={`${s.year}-${s.quarter}-${s.unit}`}>
            <td className="whitespace-nowrap">{s.year} Q{s.quarter}</td><td>{s.unit_name}</td><td className="tabular-nums">{pct(s.score)}</td>
            <td className="tabular-nums">{s.weeks_counted}</td><td className="tabular-nums">{s.weeks_without_report}</td><td>{s.status}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}

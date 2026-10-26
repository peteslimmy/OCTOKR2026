"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { apiRequest, apiUpload, ApiFailure } from "@/components/ui/client";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Label, NativeSelect, Select, DataTable } from "@/components/ui/primitives";
import { ENTITIES, applyMappingFor, mappingProblemsFor, type EntityId, type Mapping } from "@/lib/import/entities";
import { errorReportCsv, type Policy, type RowResult, type ValidationSummary } from "@/lib/import/employees";

type ImportRow = Record<string, string>;

type Step = "upload" | "map" | "review" | "confirm" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Choose file" }, { id: "map", label: "Match columns" }, { id: "review", label: "Check and fix" },
  { id: "confirm", label: "Confirm" }, { id: "done", label: "Result" },
];

interface Parsed { fileName: string; sha256: string; kind: string; headers: string[]; rows: string[][]; mapping: Mapping }
interface Validation { results: RowResult[]; summary: ValidationSummary; alreadyImported: { committed_at: string; file_name: string } | null }
interface CommitResult { batchId: string; rowCount: number; created: number; updated: number; unchanged: number; skipped: number; replayed: boolean; rows: { row: number; email: string; outcome: string; detail: string | null }[] }
type Filter = "ALL" | "ERRORS" | "CONFLICTS" | "WARNINGS" | "READY";
const PAGE = 50;

function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
const actionTone = { CREATE: "done", UPDATE: "info", UNCHANGED: "undefined", SKIP: "undefined", BLOCKED: "critical" } as const;
const actionText = { CREATE: "Will add", UPDATE: "Will update", UNCHANGED: "No change", SKIP: "Will skip", BLOCKED: "Blocked" } as const;
const sevTone = { ERROR: "critical", CONFLICT: "warn", WARNING: "info" } as const;
const sevText = { ERROR: "Error", CONFLICT: "Conflict", WARNING: "Notice" } as const;

export function ImportWizard({ entity }: { entity: EntityId }) {
  const cfg = ENTITIES[entity];
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [policy, setPolicy] = useState<Policy>("SKIP_EXISTING");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<ImportRow | null>(null);
  const [key, setKey] = useState("");
  const [result, setResult] = useState<CommitResult | null>(null);
  const seq = useRef(0);
  const status = useRef<HTMLParagraphElement>(null);

  const fail = (e: unknown) => setError(e instanceof ApiFailure ? e.message : "Something went wrong. Nothing was changed.");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const out = await apiUpload<Parsed>(`imports/${entity}/parse`, file);
      setParsed(out); setMapping(out.mapping); setStep("map");
    } catch (e) { fail(e); }
    setBusy(false);
  }

  async function runValidation(next: ImportRow[], p: Policy) {
    const mine = ++seq.current;
    setBusy(true); setError(null);
    try {
      const out = await apiRequest<Validation>("POST", `imports/${entity}/validate`, { rows: next, policy: p, fileSha256: parsed?.sha256 });
      if (mine === seq.current) setValidation(out);
    } catch (e) { if (mine === seq.current) fail(e); }
    if (mine === seq.current) setBusy(false);
  }

  async function toReview() {
    if (!parsed || !mapping) return;
    const next = applyMappingFor(cfg.fields, parsed.rows, mapping);
    setRows(next); setPage(0); setFilter("ALL"); setEditing(null); setStep("review");
    await runValidation(next, policy);
  }

  async function applyEdit() {
    if (editing === null || !draft) return;
    const next = rows.map((r, i) => (i === editing ? draft : r));
    setRows(next); setEditing(null); setDraft(null);
    await runValidation(next, policy);
    status.current?.focus();
  }

  async function changePolicy(p: Policy) {
    setPolicy(p);
    await runValidation(rows, p);
  }

  async function commit() {
    if (!parsed || !validation?.summary.canCommit) return;
    setBusy(true); setError(null);
    try {
      const out = await apiRequest<CommitResult>("POST", `imports/${entity}/commit`, { rows, policy, idempotencyKey: key, fileName: parsed.fileName, fileSha256: parsed.sha256 });
      setResult(out); setStep("done");
    } catch (e) {
      fail(e);
      if (e instanceof ApiFailure && e.code === "IMPORT_INVALID") { setStep("review"); await runValidation(rows, policy); }
    }
    setBusy(false);
  }

  function reset() {
    setStep("upload"); setParsed(null); setMapping(null); setRows([]); setValidation(null); setResult(null); setError(null); setEditing(null); setDraft(null); setFilter("ALL"); setPage(0);
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const all = validation?.results ?? [];
  const shown = all.filter((r) =>
    filter === "ALL" ? true : filter === "ERRORS" ? r.issues.some((i) => i.severity === "ERROR") : filter === "CONFLICTS" ? r.issues.some((i) => i.severity === "CONFLICT")
      : filter === "WARNINGS" ? r.issues.some((i) => i.severity === "WARNING") : r.action !== "BLOCKED");
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const visible = shown.slice(page * PAGE, page * PAGE + PAGE);
  const s = validation?.summary;

  return (
    <div className="space-y-6">
      <nav aria-label="Import steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((st, i) => (
            <li key={st.id} aria-current={st.id === step ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${st.id === step ? "border-brand-700 bg-brand-100 text-brand-800 font-medium" : i < stepIndex ? "border-line bg-panel text-ink" : "border-line bg-surface text-muted"}`}>
              <span aria-hidden className="font-mono text-xs">{i + 1}</span>{st.label}{i < stepIndex ? <span className="sr-only"> (done)</span> : null}
            </li>
          ))}
        </ol>
      </nav>

      <p ref={status} tabIndex={-1} className="sr-only" role="status">{busy ? "Working…" : validation ? `${validation.summary.blocked} rows blocked, ${validation.summary.total - validation.summary.blocked} ready.` : ""}</p>
      {error ? <div role="alert" className="rounded-lg border border-[var(--critical-fg)] bg-[var(--critical-bg)] px-4 py-3 text-sm text-[var(--critical-fg)]">{error}</div> : null}

      {step === "upload" ? (
        <Card>
          <CardHeader title="Choose a file" description={`A .csv or .xlsx file with one ${cfg.noun.one} per row. Up to 2 MB and 2000 rows. The file is read as data only: formulas and macros are never run.`} />
          <div className="space-y-4 p-6">
            <div>
              <Label htmlFor="import-file">{entity === "employees" ? "Employee file" : "Business Unit file"}</Label>
              <input id="import-file" type="file" accept=".csv,.xlsx" disabled={busy}
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
                className="block w-full cursor-pointer rounded-lg border border-line bg-panel p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white" />
            </div>
            {busy ? <p className="text-sm text-muted">Reading the file…</p> : null}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-muted" aria-hidden />
              <span className="text-muted">{cfg.columnsHint}</span>
              <Button size="sm" variant="secondary" onClick={() => download(`${entity}-import-template.csv`, cfg.template)}>
                <Download className="h-4 w-4" aria-hidden />Download template
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === "map" && parsed && mapping ? (
        <Card>
          <CardHeader title="Match your columns" description={`${parsed.fileName} · ${parsed.rows.length} data row${parsed.rows.length === 1 ? "" : "s"}. We matched what we could from the column names; check each one.`} />
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {cfg.fields.map((fs) => (
                <Field key={fs.key} id={`map-${fs.key}`} label={fs.required ? fs.label : `${fs.label} (optional)`} required={fs.required}
                  hint={mapping[fs.key] !== null ? `Example: ${parsed.rows.slice(0, 3).map((r) => r[mapping[fs.key] as number] ?? "").filter(Boolean).join(" · ") || "(empty)"}` : undefined}>
                  <Select value={mapping[fs.key] === null ? "" : String(mapping[fs.key])}
                    onChange={(e) => setMapping({ ...mapping, [fs.key]: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">{fs.required ? "Choose a column…" : "Not in my file"}</option>
                    {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            {mappingProblemsFor(cfg.fields, mapping).length ? <ul className="list-disc pl-5 text-sm text-[var(--critical-fg)]">{mappingProblemsFor(cfg.fields, mapping).map((p) => <li key={p}>{p}</li>)}</ul> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={reset}>Choose a different file</Button>
              <Button disabled={busy || mappingProblemsFor(cfg.fields, mapping).length > 0} onClick={() => void toReview()}>Check my data</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title={`If a ${cfg.noun.one} in the file already exists`} description="Choose what should happen. The preview below updates straight away." />
            <fieldset className="grid gap-3 p-6 md:grid-cols-3">
              <legend className="sr-only">Conflict policy</legend>
              {(Object.keys(cfg.policies) as Policy[]).map((p) => (
                <label key={p} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${policy === p ? "border-brand-700 bg-brand-50" : "border-line"}`}>
                  <input type="radio" name="policy" checked={policy === p} onChange={() => void changePolicy(p)} disabled={busy} className="mt-1" />
                  <span><span className="block font-medium">{cfg.policies[p].title}</span><span className="text-muted">{cfg.policies[p].text}</span></span>
                </label>
              ))}
            </fieldset>
          </Card>

          {s ? (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Summary">
              {[["Rows", s.total], ["Will add", s.create], ["Will update", s.update], ["Skip or no change", s.skip + s.unchanged], ["Blocked by errors", s.blocked]].map(([label, n]) => (
                <li key={label as string} className="rounded-lg border border-line bg-panel p-3"><p className="text-xs text-muted">{label}</p><p className="text-2xl font-semibold tabular-nums">{n}</p></li>
              ))}
            </ul>
          ) : null}

          <Card>
            <CardHeader title="Check and fix" description="Fix a row here, or fix the file and upload it again. Fixing a row re-checks the whole file."
              action={<div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runValidation(rows, policy)}>Check again</Button>
                <Button size="sm" variant="secondary" disabled={!s || s.errors + s.conflicts === 0} onClick={() => download(`${entity}-import-problems.csv`, errorReportCsv(all, cfg.labels, cfg.idField))}><Download className="h-4 w-4" aria-hidden />Error report</Button>
              </div>} />
            <div className="flex flex-wrap gap-2 border-b border-line px-6 py-3" role="group" aria-label="Show rows">
              {([["ALL", "All"], ["ERRORS", "Errors"], ["CONFLICTS", "Conflicts"], ["WARNINGS", "Notices"], ["READY", "Ready"]] as [Filter, string][]).map(([f, label]) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); setPage(0); }}
                  className={`rounded-full border px-3 py-1 text-sm ${filter === f ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`}>{label}</button>
              ))}
            </div>
            {validation?.alreadyImported ? (
              <p className="flex items-start gap-2 border-b border-line bg-[var(--warn-bg)] px-6 py-3 text-sm text-[var(--warn-fg)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                This exact file was already imported on {new Date(validation.alreadyImported.committed_at).toLocaleString("en-GB")}. Importing it again is safe, but it will usually change nothing.</p>
            ) : null}
            {!validation ? <p className="px-6 py-8 text-sm text-muted">Checking your data…</p> : shown.length === 0 ? <EmptyState title="No rows match this filter" /> : (
              <DataTable caption="Rows in the file with what will happen to each" columns={[{ label: "Row" }, { label: entity === "employees" ? "Person" : "Business Unit" }, { label: "What will happen" }, { label: "Notes" }, { label: "Actions", srOnly: true }]}>
                    {visible.map((r) => (
                      <tr key={r.row} className="border-b border-line align-top">
                        {editing === r.row - 1 && draft ? (
                          <td colSpan={5} className="px-4 py-3">
                            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void applyEdit(); }}>
                              {cfg.fields.map((fs) => (
                                <Field key={fs.key} id={`edit-${fs.key}`} label={fs.label} error={r.issues.find((i) => i.field === fs.key && i.severity === "ERROR")?.message ?? null}>
                                  <Input value={draft[fs.key] ?? ""} onChange={(e) => setDraft({ ...draft, [fs.key]: e.target.value })} />
                                </Field>
                              ))}
                              <div className="flex gap-2 md:col-span-4"><Button type="submit" size="sm" disabled={busy}>Save and check again</Button><Button size="sm" variant="secondary" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button></div>
                            </form>
                          </td>
                        ) : (
                          <>
                            <td className="tabular-nums text-muted">{r.row}</td>
                            <td className="pr-3"><span className="block font-medium break-all">{cfg.describe(r.values).title}</span><span className="text-muted">{cfg.describe(r.values).subtitle}</span></td>
                            <td className="pr-3"><Badge tone={actionTone[r.action]}>{actionText[r.action]}</Badge><span className="mt-1 block text-xs text-muted">{r.explanation}</span></td>
                            <td className="pr-3">
                              {r.issues.length === 0 ? <span className="text-muted">—</span> : (
                                <ul className="space-y-1">{r.issues.map((i, k) => <li key={k} className="flex items-start gap-2"><Badge tone={sevTone[i.severity]}>{sevText[i.severity]}</Badge><span>{i.field !== "row" ? `${cfg.labels[i.field] ?? i.field}: ` : ""}{i.message}</span></li>)}</ul>
                              )}
                            </td>
                            <td><Button size="sm" variant="secondary" disabled={busy} onClick={() => { setEditing(r.row - 1); setDraft({ ...rows[r.row - 1] }); }}>Edit<span className="sr-only"> row {r.row}</span></Button></td>
                          </>
                        )}
                      </tr>
                    ))}
                  </DataTable>
            )}
            {pages > 1 ? (
              <div className="flex items-center justify-between gap-2 px-6 py-3 text-sm">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="text-muted">Page {page + 1} of {pages}</span>
                <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            ) : null}
          </Card>

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep("map")}>Back</Button>
            <Button disabled={busy || !s?.canCommit} onClick={() => { setKey(crypto.randomUUID()); setStep("confirm"); }}>
              {s?.canCommit ? "Continue to confirm" : s ? `Fix ${s.blocked} blocked row${s.blocked === 1 ? "" : "s"} to continue` : "Checking…"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "confirm" && parsed && s ? (
        <Card>
          <CardHeader title="Confirm the import" description="Nothing has been saved yet. When you confirm, every row is checked again and then all of them are saved together, or none." />
          <div className="space-y-4 p-6 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-muted">File</dt><dd className="font-medium break-all">{parsed.fileName}</dd><dd className="font-mono text-xs text-muted">SHA-256 {parsed.sha256.slice(0, 12)}…</dd></div>
              <div><dt className="text-muted">If one already exists</dt><dd className="font-medium">{cfg.policies[policy].title}</dd></div>
            </dl>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[["Will be added", s.create], ["Will be updated", s.update], ["Skipped", s.skip], ["No change", s.unchanged]].map(([label, n]) => (
                <li key={label as string} className="rounded-lg border border-line bg-panel p-3"><p className="text-xs text-muted">{label}</p><p className="text-2xl font-semibold tabular-nums">{n}</p></li>
              ))}
            </ul>
            {s.warnings > 0 ? <p className="text-muted">{s.warnings} notice{s.warnings === 1 ? "" : "s"} (for example moves, status changes or trimmed spaces) were shown in the previous step.</p> : null}
            <p className="text-muted">{cfg.confirmNote}</p>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setStep("review")}>Back</Button>
              <Button disabled={busy || !s.canCommit} onClick={() => void commit()}>{busy ? "Importing…" : `Import ${s.create + s.update} ${s.create + s.update === 1 ? cfg.noun.one : cfg.noun.many}`}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === "done" && result ? (
        <Card>
          <CardHeader title="Import finished" description={result.replayed ? "This import had already been completed. Nothing was done twice." : "All rows were saved together."} />
          <div className="space-y-4 p-6 text-sm">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-[var(--done-fg)]" aria-hidden />{result.created} added, {result.updated} updated, {result.unchanged} unchanged, {result.skipped} skipped.</p>
            <DataTable caption="Outcome for each row" columns={[{ label: "Row" }, { label: cfg.labels[cfg.idField] }, { label: "Outcome" }, { label: "Detail" }]}>{result.rows.slice(0, 200).map((r) => (
                  <tr key={r.row} className="border-b border-line"><td className="tabular-nums text-muted">{r.row}</td><td className="break-all">{r.email}</td>
                    <td><Badge tone={r.outcome === "CREATED" ? "done" : r.outcome === "UPDATED" ? "info" : "undefined"}>{r.outcome.charAt(0) + r.outcome.slice(1).toLowerCase()}</Badge></td><td className="text-muted">{r.detail ?? "—"}</td></tr>
                ))}</DataTable>
            {result.rows.length > 200 ? <p className="text-muted">Showing the first 200 rows. Download the results for all {result.rows.length}.</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => download(`${entity}-import-results.csv`, [`Row,${cfg.labels[cfg.idField]},Outcome,Detail`, ...result.rows.map((r) => [String(r.row), r.email, r.outcome, r.detail ?? ""].map(csvCell).join(","))].join("\r\n") + "\r\n")}><Download className="h-4 w-4" aria-hidden />Download results</Button>
              <Button variant="secondary" onClick={reset}><Upload className="h-4 w-4" aria-hidden />Import another file</Button>
              <Link href="/admin" className="inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-medium text-brand-700 underline">Back to Administration</Link>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

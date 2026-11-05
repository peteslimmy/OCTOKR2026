"use client";

import { Download } from "lucide-react";
import { Badge, Button, Card, CardHeader, DataTable } from "@/components/ui/primitives";
import { ApiFailure } from "@/components/ui/client";

export interface Problem { row: number; message: string; code?: string; column?: string; cell?: string; found?: string; fix?: string; context?: string }
export interface Group { code: string; title: string; count: number; rows: number[]; fix: string }
export interface Failure { title: string; problem: string; fix: string; technical?: string; reference?: string }

/** Turns whatever went wrong (a refusal with details, a lost connection, a proxy limit, a server fault) into what happened and what to do. */
export function describeFailure(e: unknown, step: string): Failure {
  if (e instanceof ApiFailure) {
    const d = e.details as { problem?: string; fix?: string; technical?: string } | string | undefined;
    const ref = e.correlationId;
    if (d && typeof d === "object" && d.problem) return { title: e.message, problem: d.problem, fix: d.fix ?? "Fix the cause above and try again.", technical: d.technical, reference: ref };
    if (e.status === 413 || e.code === "IMPORT_TOO_LARGE") return { title: "The file is too large", problem: "The file is larger than the 10 MB the import accepts (or larger than the server allows in one upload).", fix: "Split the sheet into smaller files, for example one quarter per file, and upload them one at a time.", reference: ref };
    if (e.status === 504 || e.status === 502 || e.status === 408) return { title: `${step} took too long`, problem: "The server did not answer in time, usually because the file is big.", fix: "Nothing was changed. Try again; if it repeats, split the file into smaller files (for example one quarter each).", reference: ref };
    if (Array.isArray(d)) {
      const rows = (d as { row?: number; message?: string; fix?: string }[]).filter((x) => x && typeof x === "object" && x.message).slice(0, 6);
      if (rows.length) return { title: e.message, problem: rows.map((x) => `${x.row ? `Row ${x.row}: ` : ""}${x.message}`).join(" · "), fix: rows[0].fix ?? "Correct these rows in the file (the review table shows every one with what to do) and try again. Nothing was changed.", reference: ref };
    }
    if (e.code === "HISTORY_ALREADY_IMPORTED") return { title: "This file was already imported", problem: typeof d === "string" ? `This exact file was already imported (${d.replace(/^this exact file was imported on /, "on ")}).` : "This exact file was already imported.", fix: "Nothing needs doing: its reports are already in the application. If you changed some rows, upload the changed file; if you only want to see the result, open the quarterly scores.", reference: ref };
    if (e.code === "HISTORY_HAS_ISSUES") return { title: "Some rows cannot be loaded", problem: typeof d === "string" ? d : "Some rows break the application's rules.", fix: "Nothing was changed. Fix the rows listed after reading the file again, then upload the corrected file.", reference: ref };
    if (e.code === "HISTORY_BATCH_STATE") return { title: "This upload is not in the right step", problem: typeof d === "string" ? `The upload cannot do that now: ${d}.` : "The upload is not in the right step for that.", fix: "Choose the file again to start a fresh check.", reference: ref };
    if (e.code === "STEP_UP_REQUIRED" || e.code === "MFA_REQUIRED") return { title: "Confirm with your authenticator", problem: "A fresh authenticator or email code is needed before history can be written.", fix: "Enter the code when asked, then press Import history again. Nothing was changed.", reference: ref };
    if (e.code === "PERMISSION_DENIED" || e.status === 403) return { title: "You may not do this", problem: "Your account does not hold the permission to import history (only the Super Admin tier does).", fix: "Sign in as the Super Admin, or ask them to run the import.", reference: ref };
    if (e.status === 401) return { title: "You have been signed out", problem: "Your session ended while the file was being processed.", fix: "Sign in again and choose the file again. Nothing was changed.", reference: ref };
    if (e.code === "INTERNAL_ERROR" || e.status >= 500) return { title: `${step} failed on our side`, problem: "The server hit an unexpected fault while processing the file. Your file is not at fault necessarily.", fix: "Nothing was changed. Try once more. If it fails again, split the file into smaller parts (one quarter each) to find the part that fails, and send the reference below to support.", reference: ref };
    return { title: e.message || `${step} failed`, problem: typeof d === "string" && d ? d : e.message, fix: "Check the message above, correct the file or the step it names, and try again. Nothing was changed.", reference: ref };
  }
  return { title: "The upload did not reach the server", problem: "The connection was lost or the request was blocked before the server answered (a network drop, a VPN or a very large file).", fix: "Check your connection and try again. If the file is large, split it into smaller files (one quarter each). Nothing was changed.", technical: e instanceof Error ? e.message : undefined };
}

export function FailurePanel({ f }: { f: Failure }) {
  return (
    <div role="alert" className="mt-3 space-y-2 rounded-lg border border-[var(--critical-fg)]/30 bg-[var(--critical-bg)] px-4 py-3 text-sm text-ink" data-testid="import-failure">
      <p className="font-semibold text-[var(--critical-fg)]">{f.title}</p>
      <p><span className="font-medium">What happened: </span>{f.problem}</p>
      <p><span className="font-medium">What to do: </span>{f.fix}</p>
      {f.technical || f.reference ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Technical detail for support</summary>
          {f.reference ? <p className="mt-1">Reference: <span className="font-mono">{f.reference}</span></p> : null}
          {f.technical ? <p className="mt-1 break-words font-mono">{f.technical}</p> : null}
        </details>
      ) : null}
    </div>
  );
}

const csvCell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
function downloadReport(problems: Problem[], fileName: string) {
  const head = ["Spreadsheet row", "Cell", "Column", "Found", "Problem", "What to do", "Where"];
  const lines = [head.map(csvCell).join(","), ...problems.map((p) => [p.row, p.cell ?? "", p.column ?? "", p.found ?? "", p.message, p.fix ?? "", p.context ?? ""].map(csvCell).join(","))];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${fileName.replace(/\.[^.]+$/, "")}-problems.csv`; a.click();
  URL.revokeObjectURL(url);
}

/** What is wrong, in short (one line per kind of problem and what to do about it), then every row with its exact cell, what was found and its own fix. */
export function ProblemsView({ title, intro, problems, total, groups, fileName }: { title: string; intro: string; problems: Problem[]; total: number; groups?: Group[]; fileName: string }) {
  return (
    <Card data-testid="import-problems">
      <CardHeader title={title} description={intro} action={<Button size="sm" variant="secondary" onClick={() => downloadReport(problems, fileName)}><Download className="h-4 w-4" aria-hidden />Download the problem list</Button>} />
      <div className="space-y-5 px-6 pb-6">
        {groups?.length ? <section aria-label="Summary of what to fix">
          <h3 className="mb-2 text-sm font-semibold text-ink">What to fix, in order of how many rows it affects</h3>
          <ol className="space-y-3 text-sm">
            {(groups ?? []).map((g) => (
              <li key={g.code} className="rounded-lg border border-line p-3">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">{g.title} <Badge tone="warn">{g.count} row{g.count === 1 ? "" : "s"}</Badge></p>
                <p className="mt-1 text-xs text-muted">Rows {g.rows.join(", ")}{g.count > g.rows.length ? ` and ${g.count - g.rows.length} more` : ""}</p>
                <p className="mt-1"><span className="font-medium">What to do: </span>{g.fix}</p>
              </li>
            ))}
          </ol>
        </section> : null}
        <section aria-label="Every row to fix">
          <h3 className="mb-2 text-sm font-semibold text-ink">Every row to fix</h3>
          <DataTable caption="Rows to fix" maxHeight="28rem" columns={[{ label: "Row" }, { label: "Cell" }, { label: "Found" }, { label: "What is wrong" }, { label: "What to do" }]}>
            {problems.map((p, i) => (
              <tr key={`${p.row}-${p.code}-${i}`}>
                <td className="tabular-nums">{p.row}</td>
                <td className="whitespace-nowrap">{p.cell ? <><span className="font-mono">{p.cell}</span>{p.column ? <p className="text-xs text-muted">{p.column}</p> : null}</> : <span className="text-muted">—</span>}</td>
                <td className="max-w-[14rem] break-words">{p.found ? <span className="font-mono text-xs">{p.found}</span> : <span className="text-muted">{p.found === "" ? "(empty)" : "—"}</span>}</td>
                <td>{p.message}{p.context ? <p className="text-xs text-muted">{p.context}</p> : null}</td>
                <td className="text-sm">{p.fix}</td>
              </tr>
            ))}
          </DataTable>
          {total > problems.length ? <p className="mt-2 text-sm">Showing the first {problems.length} of {total}. Fix these and upload again to see the rest, or download the list.</p> : null}
        </section>
      </div>
    </Card>
  );
}

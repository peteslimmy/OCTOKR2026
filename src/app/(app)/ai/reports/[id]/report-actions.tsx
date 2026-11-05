"use client";

import { Download, Printer, Sparkles } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "@/components/ui/client";
import { Banner } from "@/components/ui/primitives";

const btn = "inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm font-medium hover:bg-surface disabled:opacity-50";

/** Print, export and the optional written explanation. The report itself never depends on any of them. */
export function ReportActions({ id, query, canExport, canExplain }: { id: string; query: string; canExport: boolean; canExplain: boolean }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  async function explain() {
    setBusy(true); setOut(null);
    try {
      const q = new URLSearchParams(query);
      const r = await apiRequest<{ ok: boolean; text?: string; message?: string }>("POST", `ai/reports/${id}/commentary`, { ...(q.get("quarter") ? { quarter: q.get("quarter") } : {}), ...(q.get("unit") ? { unit: q.get("unit") } : {}) });
      setOut({ ok: r.ok, text: r.ok ? r.text ?? "" : r.message ?? "No explanation this time." });
    } catch (e) { setOut({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />Print or save as PDF</button>
        {canExport ? <a className={btn} href={`/api/v1/ai/reports/${id}?format=csv${query ? `&${query}` : ""}`}><Download className="h-4 w-4" aria-hidden />Export CSV</a> : null}
        {canExplain ? <button type="button" className={btn} disabled={busy} onClick={() => void explain()}><Sparkles className="h-4 w-4" aria-hidden />{busy ? "Writing…" : "Explain the changes (AI)"}</button> : null}
      </div>
      {out ? (out.ok ? <Banner tone="info" title="Written explanation (AI)">{out.text}<span className="mt-1 block text-xs text-muted">Every figure in it was checked against the report. The report above is the record.</span></Banner> : <Banner tone="warn" title="No written explanation">{out.text}</Banner>) : null}
    </div>
  );
}

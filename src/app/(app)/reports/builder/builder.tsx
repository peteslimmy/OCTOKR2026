"use client";

import { useEffect, useMemo, useState } from "react";
import { ResultTable } from "@/components/reports/report-view";
import { apiRequest, useAction, ApiFailure } from "@/components/ui/client";
import { Button, Card, CardHeader, Input, Label, Select, Field } from "@/components/ui/primitives";
import type { ReportResult } from "@/lib/reports/types";

interface Opt { id: string; title: string; category: string; params: string[]; description: string }

/** Chooses an approved report, filters, columns and sort; previews the real result; saves the definition (never data). */
export function Builder({ reports, quarters, bus, canExport }: { reports: Opt[]; quarters: { id: string; label: string }[]; bus: { id: string; name: string }[]; canExport: boolean }) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [quarterId, setQuarterId] = useState("");
  const [buId, setBuId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fetched, setFetched] = useState<{ key: string; result: ReportResult | null; err: string | null } | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [name, setName] = useState("");
  const { run, pending } = useAction();
  const opt = reports.find((r) => r.id === reportId);

  const qs = useMemo(() => {
    const u = new URLSearchParams();
    if (quarterId && opt?.params.includes("quarter")) u.set("quarterId", quarterId);
    if (buId && opt?.params.includes("bu")) u.set("buId", buId);
    if (opt?.params.includes("period")) { if (from) u.set("from", from); if (to) u.set("to", to); }
    return u;
  }, [quarterId, buId, from, to, opt]);

  const key = `${reportId}?${qs.toString()}`;
  useEffect(() => {
    if (!reportId) return;
    let live = true;
    apiRequest<ReportResult>("GET", `reports/${key}`)
      .then((r) => { if (live) setFetched({ key, result: r, err: null }); })
      .catch((e: ApiFailure) => { if (live) setFetched({ key, result: null, err: e.message }); });
    return () => { live = false; };
  }, [reportId, key]);
  const loading = fetched?.key !== key;
  const result = fetched?.key === key ? fetched.result : null;
  const err = fetched?.key === key ? fetched.err : null;

  const view = useMemo(() => {
    if (!result) return null;
    const cols = chosen ? result.columns.filter((c) => chosen.includes(c.key)) : result.columns;
    let rows = result.rows;
    if (sort) rows = [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === "asc" ? c : -c;
    });
    return { ...result, columns: cols.length ? cols : result.columns, rows: rows.slice(0, 50) };
  }, [result, chosen, sort]);

  const colsParam = chosen && chosen.length ? chosen.join(",") : undefined;
  const exportHref = (f: string) => { const u = new URLSearchParams(qs); u.set("format", f); if (colsParam) u.set("cols", colsParam); return `/api/v1/reports/${reportId}/export?${u.toString()}`; };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <CardHeader title="1. Choose" />
        <div className="space-y-4 px-6 py-4 text-sm">
          <div><Label htmlFor="b-report">Report</Label>
            <Select id="b-report" value={reportId} onChange={(e) => { setReportId(e.target.value); setChosen(null); setSort(null); }}>{reports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select>
            {opt ? <p className="mt-1 text-xs text-muted">{opt.description}</p> : null}</div>
          {opt?.params.includes("quarter") ? <div><Label htmlFor="b-q">Quarter</Label><Select id="b-q" value={quarterId} onChange={(e) => setQuarterId(e.target.value)}><option value="">Current quarter</option>{quarters.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}</Select></div> : null}
          {opt?.params.includes("bu") && bus.length > 1 ? <div><Label htmlFor="b-bu">Business Unit</Label><Select id="b-bu" value={buId} onChange={(e) => setBuId(e.target.value)}><option value="">All Business Units</option>{bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div> : null}
          {opt?.params.includes("period") ? <div className="grid grid-cols-2 gap-2"><Field id="b-from" label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field id="b-to" label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div> : null}
          {result ? (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">2. Columns</legend>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {result.columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2"><input type="checkbox" checked={!chosen || chosen.includes(c.key)}
                    onChange={(e) => { const cur = chosen ?? result.columns.map((x) => x.key); setChosen(e.target.checked ? [...cur, c.key] : cur.filter((k) => k !== c.key)); }} />{c.label}</label>))}
              </div>
              <div className="mt-3"><Label htmlFor="b-sort">3. Sort by</Label>
                <Select id="b-sort" value={sort ? `${sort.key}:${sort.dir}` : ""} onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort(key ? { key, dir: dir as "asc" | "desc" } : null); }}>
                  <option value="">Report order</option>
                  {result.columns.filter((c) => c.type !== "link").flatMap((c) => [<option key={`${c.key}d`} value={`${c.key}:desc`}>{c.label} (high to low)</option>, <option key={`${c.key}a`} value={`${c.key}:asc`}>{c.label} (low to high)</option>])}
                </Select></div>
            </fieldset>
          ) : null}
          <div className="space-y-2 border-t border-line pt-4">
            <Label htmlFor="b-name">4. Save as</Label>
            <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Quarterly compliance for the board" />
            <Button disabled={pending || !name.trim() || !result} onClick={() => run(() => apiRequest("POST", "saved-reports", {
              name, reportId, params: Object.fromEntries(qs.entries()), columns: chosen, sortBy: sort, sharedWith: [] }), { success: "View saved.", refresh: false })}>Save view</Button>
          </div>
        </div>
      </Card>
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Preview" description={result ? `${result.periodLabel} · ${result.scopeLabel} · first 50 of ${result.rows.length} rows` : "Choose a report"}
            action={canExport && result ? <div className="flex gap-2">{["csv", "xlsx", "pdf"].map((f) => <a key={f} href={exportHref(f)} className="rounded-lg border border-line px-3 py-1 text-sm hover:bg-surface" download>{f.toUpperCase()}</a>)}</div> : undefined} />
          {loading ? <p className="px-6 py-8 text-sm text-muted" role="status">Loading the report…</p> : null}
          {err ? <p role="alert" className="px-6 py-8 text-sm text-[var(--critical-fg)]">{err}</p> : null}
          {!loading && view ? (view.rows.length ? <ResultTable result={view} rows={view.rows} /> : <p className="px-6 py-8 text-sm text-muted">No data for this selection.</p>) : null}
        </Card>
        {result?.notes.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
      </div>
    </div>
  );
}

import Link from "next/link";
import { wat } from "@/components/status";
import { Badge, Card, CardHeader, EmptyState, type Tone } from "@/components/ui/primitives";
import { metricById } from "@/lib/reports/metrics";
import type { ReportColumn, ReportResult, SummaryItem } from "@/lib/reports/types";
import { Chart } from "./charts";

const TONE: [RegExp, Tone][] = [
  [/non-compliant|missing|no report|critical|high|declining|attention|overdue|not reviewed|not enough/i, "critical"],
  [/compliant|scored|reviewed|final|improving|ok\b|finalised|score amended|steady/i, "done"],
  [/provisional|medium|warning|watch|projection|authorised|submitted|not finalised|holiday/i, "warn"],
];
const toneOf = (v: string): Tone => TONE.find(([re]) => re.test(v))?.[1] ?? "undefined";

export function formatCell(c: ReportColumn, v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="text-muted" aria-label="no value">—</span>;
  switch (c.type) {
    case "percent": return <span className="tabular-nums">{Number(v).toFixed(1)}%</span>;
    case "money": return <span className="tabular-nums">₦{Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    case "number": return <span className="tabular-nums">{Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(1)}</span>;
    case "date": return <span>{String(v).slice(0, 10)}</span>;
    case "datetime": return <span>{wat(String(v))}</span>;
    case "status": return <Badge tone={toneOf(String(v))}>{String(v)}</Badge>;
    case "link": return <Link href={String(v)} className="text-brand-700 underline">Open</Link>;
    default: return <span>{String(v)}</span>;
  }
}

const SUMMARY_TONE = { good: "border-l-[var(--done-fg)]", warn: "border-l-[var(--warn-fg)]", bad: "border-l-[var(--critical-fg)]", neutral: "border-l-line" } as const;

export function SummaryTiles({ items }: { items: SummaryItem[] }) {
  if (!items.length) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((s) => {
        const m = s.metricId ? metricById(s.metricId) : null;
        return (
          <div key={s.label} className={`rounded-lg border border-line border-l-4 bg-panel px-4 py-3 ${SUMMARY_TONE[s.tone ?? "neutral"]}`}>
            <dt className="text-xs text-muted">{s.label}{m?.status === "PENDING_APPROVAL" ? <span className="ml-1 rounded bg-[var(--warn-bg)] px-1 text-[10px] text-[var(--warn-fg)]">pending approval</span> : null}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{s.value === null || s.value === undefined ? "—" : typeof s.value === "number" ? (Number.isInteger(s.value) ? s.value : s.value.toFixed(1)) : s.value}{s.unit && s.value !== null ? <span className="ml-1 text-sm font-normal text-muted">{s.unit}</span> : null}</dd>
            {s.note ? <dd className="mt-1 text-xs text-muted">{s.note}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

export function ResultTable({ result, rows, sortKey, sortDir, sortHref }: {
  result: ReportResult; rows: Record<string, unknown>[]; sortKey?: string; sortDir?: "asc" | "desc"; sortHref?: (key: string, dir: "asc" | "desc") => string;
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${result.title} results table`}>
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{result.title}, {result.periodLabel}, {result.scopeLabel}</caption>
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {result.columns.map((c) => {
              const m = c.metricId ? metricById(c.metricId) : null;
              const active = sortKey === c.key;
              return (
                <th key={c.key} scope="col" className="px-4 py-2 font-medium whitespace-nowrap" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                  {sortHref && c.type !== "link" ? (
                    <Link href={sortHref(c.key, active && sortDir === "desc" ? "asc" : "desc")} className="hover:text-ink" title={m ? `${m.name}: ${m.formula}` : undefined}>{c.label}{active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</Link>
                  ) : <span title={m ? `${m.name}: ${m.formula}` : undefined}>{c.label}</span>}
                  {c.hint ? <span className="block text-[11px] font-normal">{c.hint}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {result.columns.map((c, j) => (j === 0 ? <th key={c.key} scope="row" className="px-4 py-2 text-left font-medium">{formatCell(c, r[c.key])}</th> : <td key={c.key} className="px-4 py-2 align-top">{formatCell(c, r[c.key])}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Notes({ result }: { result: ReportResult }) {
  return result.notes.length ? (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted" aria-label="Notes and limitations">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
  ) : null;
}

export function MetricExplainer({ ids }: { ids: string[] }) {
  const defs = ids.map(metricById).filter((m) => !!m);
  if (!defs.length) return null;
  return (
    <Card>
      <CardHeader title="How these figures are calculated" description="Every figure uses the definition below. Definitions marked pending approval are proposals." />
      <div className="divide-y divide-line">
        {defs.map((m) => m && (
          <details key={m.id} className="px-6 py-3 text-sm">
            <summary className="cursor-pointer font-medium">{m.name} <Badge tone={m.status === "OFFICIAL" ? "done" : m.status === "DERIVED" ? "info" : "warn"}>{m.status === "PENDING_APPROVAL" ? "pending approval" : m.status.toLowerCase()}</Badge></summary>
            <dl className="mt-2 grid gap-1 text-muted sm:grid-cols-[150px_1fr]">
              <dt>Definition</dt><dd className="text-ink">{m.definition}</dd>
              <dt>Formula</dt><dd className="text-ink">{m.formula}</dd>
              {m.numerator ? <><dt>Numerator</dt><dd className="text-ink">{m.numerator}</dd></> : null}
              {m.denominator ? <><dt>Denominator</dt><dd className="text-ink">{m.denominator}</dd></> : null}
              <dt>Unit</dt><dd className="text-ink">{m.unit}</dd><dt>Source</dt><dd className="text-ink">{m.source}</dd>
              <dt>Missing data</dt><dd className="text-ink">{m.nullRules}</dd>
              <dt>Caveats</dt><dd className="text-ink">{m.caveats.join(" ")}</dd>
            </dl>
          </details>
        ))}
      </div>
    </Card>
  );
}

export function ResultBody({ result, rows, sortKey, sortDir, sortHref }: { result: ReportResult; rows?: Record<string, unknown>[]; sortKey?: string; sortDir?: "asc" | "desc"; sortHref?: (k: string, d: "asc" | "desc") => string }) {
  if (result.dataStatus === "NO_DATA" && !result.rows.length) {
    return <Card><EmptyState title="No data for this selection">{result.notes[0] ?? "Nothing has been recorded for the chosen period and scope yet. Reports never show placeholder numbers."}</EmptyState></Card>;
  }
  return (
    <div className="space-y-6">
      <SummaryTiles items={result.summary} />
      {result.charts.length ? <Card><div className="grid gap-8 p-6 lg:grid-cols-1">{result.charts.map((c) => <Chart key={c.id} spec={c} level={2} />)}</div></Card> : null}
      <Card>
        <CardHeader title="Detail" description={`${result.rows.length} row${result.rows.length === 1 ? "" : "s"} · ${result.periodLabel} · ${result.scopeLabel}`} />
        <ResultTable result={result} rows={rows ?? result.rows} sortKey={sortKey} sortDir={sortDir} sortHref={sortHref} />
      </Card>
      <Notes result={result} />
    </div>
  );
}

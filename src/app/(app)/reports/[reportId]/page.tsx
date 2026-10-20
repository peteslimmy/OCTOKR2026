import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ReportFilters, paramString } from "@/components/reports/filters";
import { MetricExplainer, ResultBody } from "@/components/reports/report-view";
import { Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { listBusinessUnits, listQuarters } from "@/lib/data";
import { authoriseReport, readParams } from "@/lib/reports/access";
import { reportById } from "@/lib/reports/catalogue";
import { runReport } from "@/lib/reports/run";
import { pickColumns } from "@/lib/reports/sanitize";
import { ReportActions } from "./report-actions";

const PAGE_SIZE = 25;

export async function generateMetadata({ params }: PageProps<"/reports/[reportId]">): Promise<Metadata> {
  const { reportId } = await params;
  return { title: reportById(reportId)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[reportId]">) {
  const actor = await requireActor();
  const { reportId } = await params;
  const sp = await searchParams;
  const def = reportById(reportId);
  if (!def || !actor.permissions.has("reports.view") || (def.requires.length && !def.requires.some((p) => actor.permissions.has(p)))) {
    return <Card><EmptyState title="This report is not available" action={<Link href="/reports" className="text-sm text-brand-700 underline">Back to Reports</Link>}>It may not exist, or your role may not include it.</EmptyState></Card>;
  }
  authoriseReport(actor, def);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const rp = readParams(new URLSearchParams(Object.entries({ quarterId: str("quarterId"), buId: str("buId"), from: str("from"), to: str("to") }).filter(([, v]) => v) as [string, string][]));
  const [full, quarters, bus] = await Promise.all([runReport(def, rp, actor), listQuarters(), listBusinessUnits()]);
  const colsParam = str("cols");
  const result = { ...full, columns: pickColumns(full.columns, colsParam) };

  // sorting and paging are applied to the already-scoped rows, server side
  const sortKey = str("sort") && result.columns.some((c) => c.key === str("sort")) ? str("sort") : undefined;
  const sortDir = str("dir") === "asc" ? "asc" : "desc";
  const sorted = sortKey ? [...result.rows].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  }) : result.rows;
  const page = Math.max(1, Number(str("page")) || 1);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const base = `/reports/${def.id}`;
  const qs = (extra: Record<string, string>) => paramString(rp, { ...(sortKey ? { sort: sortKey, dir: sortDir } : {}), ...(colsParam ? { cols: colsParam } : {}), ...extra });
  const exportHref = (f: string) => `/api/v1/reports/${def.id}/export${paramString(rp, { format: f, ...(colsParam ? { cols: colsParam } : {}) })}`;
  const canExport = actor.permissions.has("reports.export");
  const canSnapshot = def.organisationWide && actor.permissions.has("reports.snapshot") && actor.permissions.has("weekly_report.view_all");

  return (
    <>
      <PageHeader title={def.title} description={def.description}
        actions={<>
          <Link href="/reports" className={buttonClass("secondary", "sm")}>All reports</Link>
          {canExport ? ["csv", "xlsx", "pdf"].map((f) => (
            <a key={f} href={exportHref(f)} className={buttonClass("secondary", "sm")} download><Download className="h-4 w-4" aria-hidden />{f.toUpperCase()}</a>)) : null}
        </>} />
      <div className="space-y-6">
        <Card className="space-y-3 p-4">
          <ReportFilters action={base} def={def} params={rp} quarters={quarters} bus={actor.permissions.has("weekly_report.view_all") ? bus.filter((b) => b.status === "ACTIVE" && b.reports_weekly) : undefined} />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{result.periodLabel}</span><span>· {result.scopeLabel}</span><span>· data as of {result.generatedAt.slice(0, 16).replace("T", " ")} (server time)</span>
            {result.dataStatus === "PARTIAL" ? <Badge tone="warn">Partial data: see notes</Badge> : null}
            {result.dataStatus === "NO_DATA" ? <Badge tone="locked">No data</Badge> : <Badge tone="info">Live: recalculated on every view</Badge>}
          </p>
          <ReportActions reportId={def.id} params={rp} title={def.title} canSnapshot={canSnapshot} canSave={actor.permissions.has("reports.build")} />
        </Card>

        <ResultBody result={result} rows={slice} sortKey={sortKey} sortDir={sortDir} sortHref={(k, d) => `${base}${qs({ sort: k, dir: d, page: "1" })}`} />

        {pages > 1 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
            <span className="text-muted">Page {page} of {pages} · {sorted.length} rows</span>
            <span className="flex gap-2">
              {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={`${base}${qs({ page: String(page - 1) })}`}>Previous</Link> : null}
              {page < pages ? <Link className={buttonClass("secondary", "sm")} href={`${base}${qs({ page: String(page + 1) })}`}>Next</Link> : null}
            </span>
          </nav>
        ) : null}
        <MetricExplainer ids={def.metricIds} />
      </div>
    </>
  );
}

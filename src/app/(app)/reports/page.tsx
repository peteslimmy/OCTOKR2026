import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileBarChart, Lightbulb, Wrench } from "lucide-react";
import { Chart } from "@/components/reports/charts";
import { ReportFilters, paramString } from "@/components/reports/filters";
import { ResultTable, SummaryTiles } from "@/components/reports/report-view";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { listQuarters } from "@/lib/data";
import { availableReports, authoriseReport, readParams } from "@/lib/reports/access";
import { BLOCKED_REPORTS, REPORTS, reportById } from "@/lib/reports/catalogue";
import { runInsights } from "@/lib/reports/insights-run";
import { runReport } from "@/lib/reports/run";
import type { ReportCategory } from "@/lib/reports/types";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsOverview({ searchParams }: PageProps<"/reports">) {
  const actor = await requireActor();
  if (!actor.permissions.has("reports.view")) return <Card><EmptyState title="Reports are not available for your role" /></Card>;
  const sp = await searchParams;
  const params = readParams(new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))));
  const orgWide = actor.permissions.has("weekly_report.view_all");
  const [quarters, avail] = await Promise.all([listQuarters(), Promise.resolve(availableReports(actor, REPORTS))]);

  const lead = authoriseReport(actor, reportById(orgWide ? "org-performance-summary" : "weekly-compliance"));
  const [headline, scorecard, outstanding, insights] = await Promise.all([
    runReport(lead, params, actor),
    runReport(authoriseReport(actor, reportById("bu-scorecard")), params, actor),
    runReport(authoriseReport(actor, reportById("governance-outstanding")), params, actor),
    runInsights(actor, params.quarterId),
  ]);
  const byCategory = new Map<ReportCategory, typeof avail>();
  for (const r of avail) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const top = insights.findings.slice(0, 5);

  return (
    <>
      <PageHeader title="Reports" description="Performance, reporting discipline, governance and finance, calculated from the same official scores the rest of the application uses."
        actions={<>
          <Link href="/reports/insights" className={buttonClass("secondary", "sm")}><Lightbulb className="h-4 w-4" aria-hidden />Insights</Link>
          <Link href="/reports/builder" className={buttonClass("secondary", "sm")}><Wrench className="h-4 w-4" aria-hidden />Report builder</Link>
          <Link href="/reports/saved" className={buttonClass("secondary", "sm")}>Saved and snapshots</Link>
          <Link href="/reports/metrics" className={buttonClass("secondary", "sm")}>Metric definitions</Link>
        </>} />
      <div className="space-y-6">
        <Card className="p-4"><ReportFilters action="/reports" params={params} quarters={quarters} bus={undefined} /></Card>
        <p className="text-sm text-muted">{headline.periodLabel} · {headline.scopeLabel} · data as of {headline.generatedAt.slice(0, 16).replace("T", " ")} (server time). Filters apply to every figure on this page.</p>

        <section aria-labelledby="h-perf" className="space-y-4">
          <h2 id="h-perf" className="text-lg font-semibold">{orgWide ? "Performance" : "Your unit"}</h2>
          <SummaryTiles items={headline.summary} />
          {headline.charts[0] ? <Card><div className="p-6"><Chart spec={headline.charts[0]} /></div></Card> : null}
        </section>

        <Card>
          <CardHeader title="Business Unit comparison" description="Rank is read with its movement: a position alone does not show whether a BU is improving."
            action={<Link href={`/reports/bu-scorecard${paramString(params)}`} className="text-sm text-brand-700 underline">Open the full scorecard</Link>} />
          {scorecard.rows.length ? <ResultTable result={scorecard} rows={scorecard.rows.slice(0, 8)} /> : <EmptyState title="No scores yet">Scores appear once the first reporting week is finalised.</EmptyState>}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Needs attention" description={`${insights.disclosure}`} action={<Link href="/reports/insights" className="text-sm text-brand-700 underline">All insights</Link>} />
            {top.length ? (
              <ul className="divide-y divide-line">
                {top.map((f) => (
                  <li key={f.id} className="px-6 py-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{f.title} <Badge tone={f.severity === "ATTENTION" ? "critical" : f.severity === "WATCH" ? "warn" : "info"}>{f.severity === "ATTENTION" ? "Attention" : f.severity === "WATCH" ? "Watch" : "Info"}</Badge></p>
                    <p className="mt-1 text-muted">{f.statement}</p>
                    <Link href={`/reports/${f.reportId}`} className="text-brand-700 underline">See the evidence</Link>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="Nothing flagged">No finding met the evidence thresholds for this period.</EmptyState>}
          </Card>
          <Card>
            <CardHeader title="Waiting for a decision" description="Approvals, exceptions and reviews you can see, oldest first."
              action={<Link href="/reports/governance-outstanding" className="text-sm text-brand-700 underline">Open the full list</Link>} />
            <div className="p-6"><SummaryTiles items={outstanding.summary.slice(0, 2)} /></div>
            {outstanding.rows.length ? (
              <ul className="divide-y divide-line border-t border-line">
                {outstanding.rows.slice(0, 5).map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
                    <span><Badge tone={r.priority === "HIGH" ? "critical" : r.priority === "MEDIUM" ? "warn" : "undefined"}>{String(r.priority)}</Badge> <span className="ml-2">{String(r.item)}</span> <span className="text-muted">· {String(r.age_days)} d</span></span>
                    <Link href={String(r.open)} className="text-brand-700 underline">Open</Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>

        <section aria-labelledby="h-cat" className="space-y-4">
          <h2 id="h-cat" className="text-lg font-semibold">Report catalogue</h2>
          {[...byCategory].map(([cat, list]) => (
            <Card key={cat}>
              <CardHeader title={cat} />
              <ul className="divide-y divide-line">
                {list.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-3 text-sm">
                    <div className="min-w-0 max-w-2xl">
                      <Link href={`/reports/${r.id}`} className="font-medium text-brand-700 underline">{r.title}</Link>
                      <p className="text-muted">{r.description}</p>
                      <p className="mt-1 text-xs text-muted">For {r.audience}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Download className="h-3.5 w-3.5" aria-hidden />{r.outputs.filter((o) => ["CSV", "XLSX", "PDF"].includes(o)).join(" · ")}{r.outputs.includes("SNAPSHOT") ? <Badge tone="info">Snapshot</Badge> : null}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <Card>
            <CardHeader title="Not available yet" description="Requested or expected reports that cannot be produced truthfully from the data the application holds today." />
            <ul className="divide-y divide-line">
              {BLOCKED_REPORTS.map((b) => (
                <li key={b.title} className="px-6 py-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium"><FileBarChart className="h-4 w-4 text-muted" aria-hidden />{b.title}<Badge tone="locked">Blocked</Badge></p>
                  <p className="mt-1 text-muted">{b.reason}</p>
                  <p className="text-xs text-muted">Needs: {b.needs}</p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </>
  );
}

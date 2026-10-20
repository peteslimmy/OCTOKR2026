import type { Metadata } from "next";
import Link from "next/link";
import { ReportFilters } from "@/components/reports/filters";
import { Badge, Banner, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { listQuarters } from "@/lib/data";
import { readParams } from "@/lib/reports/access";
import { runInsights } from "@/lib/reports/insights-run";
import { Assistant } from "./assistant";

export const metadata: Metadata = { title: "Report insights" };

const SEV = { ATTENTION: ["critical", "Attention"], WATCH: ["warn", "Watch"], INFO: ["info", "Info"] } as const;
const KIND = { OBSERVATION: "Observation", ANOMALY: "Statistical anomaly", RECOMMENDATION: "Recommendation" } as const;

export default async function InsightsPage({ searchParams }: PageProps<"/reports/insights">) {
  const actor = await requireActor();
  if (!actor.permissions.has("reports.view")) return <Card><EmptyState title="Reports are not available for your role" /></Card>;
  const sp = await searchParams;
  const params = readParams(new URLSearchParams(typeof sp.quarterId === "string" ? [["quarterId", sp.quarterId]] : []));
  const [insights, quarters] = await Promise.all([runInsights(actor, params.quarterId), listQuarters()]);
  return (
    <>
      <PageHeader title="Insights and questions" description="Findings that rest on measured evidence you can open and check, and a question box that takes you to the right approved report."
        actions={<Link href="/reports" className={buttonClass("secondary", "sm")}>All reports</Link>} />
      <div className="space-y-6">
        <Banner tone="info" title="How these insights are produced">{insights.disclosure}</Banner>
        <Card className="p-4"><ReportFilters action="/reports/insights" params={params} quarters={quarters} /></Card>
        <Assistant />
        <Card>
          <CardHeader title={`Findings for ${insights.periodLabel}`} description={`${insights.scope} · generated ${insights.generatedAt.slice(0, 16).replace("T", " ")} (server time) by ${insights.generatedBy}; no AI model`} />
          {insights.findings.length === 0 ? (
            <EmptyState title="Nothing met the evidence thresholds">Findings need enough scored weeks and a clear, measurable change. An empty list is a result, not a failure.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {insights.findings.map((f) => {
                const [tone, label] = SEV[f.severity];
                return (
                  <li key={f.id} className="space-y-2 px-6 py-4 text-sm">
                    <p className="flex flex-wrap items-center gap-2 text-base font-medium">{f.title} <Badge tone={tone}>{label}</Badge> <Badge tone="undefined">{KIND[f.kind]}</Badge></p>
                    <p>{f.statement}</p>
                    <dl className="grid gap-1 sm:grid-cols-[minmax(0,260px)_1fr] text-muted">
                      {f.evidence.map((e, i) => (<><dt key={`k${i}`}>{e.label}{e.period ? ` (${e.period})` : ""}</dt><dd key={`v${i}`} className="text-ink">{e.value}{e.baseline ? <span className="text-muted"> · {e.baseline}</span> : null}</dd></>))}
                    </dl>
                    <p className="text-xs text-muted">Limits: {f.limitations.join(" ")}</p>
                    <Link href={`/reports/${f.reportId}${insights.quarterId ? `?quarterId=${insights.quarterId}` : ""}`} className="inline-block text-brand-700 underline">Open the supporting report</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

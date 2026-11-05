import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { buildPredictions } from "@/lib/ai/predictions";
import { liveReportData } from "@/lib/ai/live-report-data";
import { aiModuleStatus } from "@/lib/ai/status";
import { AiTabs } from "../ai-tabs";
import { Notice } from "../notice";

export const metadata: Metadata = { title: "Executive intelligence · 4COREPAL" };
const pc = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "n/a" : `${n.toFixed(d)}%`);
const sg = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(0)}`);
const OUT: Record<string, { label: string; tone: "done" | "warn" | "critical" | "undefined" }> = { ON_TRACK: { label: "On track", tone: "done" }, AT_RISK: { label: "At risk", tone: "warn" }, OFF_TRACK: { label: "Off track", tone: "critical" }, NO_DATA: { label: "Not enough data", tone: "undefined" } };
const CONCERN: Record<number, { label: string; tone: "done" | "warn" | "critical" | "undefined" }> = { 3: { label: "Act now", tone: "critical" }, 2: { label: "Watch", tone: "warn" }, 1: { label: "Fine", tone: "done" }, 0: { label: "Cannot say yet", tone: "undefined" } };

function Tile({ label, value, note, href }: { label: string; value: string | number; note?: string; href?: string }) {
  const inner = <><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}</>;
  return href ? <Link href={href} className="block rounded-xl border border-line bg-panel p-4 hover:bg-surface">{inner}</Link> : <div className="rounded-xl border border-line bg-panel p-4">{inner}</div>;
}

export default async function ExecutivePage() {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.insights.org") || !can(actor, "dashboard.executive.view")) return <Notice><EmptyState title="The executive centre is for executives and administrators" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on" /></Notice>;
  const data = liveReportData();
  const q = await data.quarter();
  if (!q) return <Notice><EmptyState title="No quarter configured" /></Notice>;
  const [r, n, cov, cases, plans] = await Promise.all([data.orgReport(q.id), data.counts(), data.coverage(q.id), data.cases(), data.plans()]);
  if (!r) return <Notice><EmptyState title="No weekly data for this quarter yet" /></Notice>;
  const x = r.report, o = x.org;
  const preds = buildPredictions(x, cov);
  const open = cases.filter((c) => c.status !== "RESOLVED" && c.status !== "CLOSED");
  const reviewed = plans.filter((p) => p.effectiveness);
  return (
    <>
      <PageHeader title="Executive intelligence" description={`${r.quarterLabel}. One place for how the organisation is doing, what is at risk, what is waiting on you, and what the forecasts say. The figures come from the same engine as the Management brief, so they reconcile with it.`}
        actions={<Link href="/ai/reports" className="text-sm underline">Reports</Link>} />
      <AiTabs current="executive" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <div className="space-y-6">
        <Banner tone={o.counts.OFF_TRACK ? "critical" : o.belowTarget ? "warn" : "done"} title={o.verdict} />

        <section aria-labelledby="h-org"><h2 id="h-org" className="mb-2 text-lg font-semibold">Organisational health</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Actual to date" value={pc(o.actualToDate)} note="A missed week counts as zero" /><Tile label="Forecast at quarter end" value={pc(o.projectedUnweighted)} note={`Target ${o.target}%. Weighted by goals ${pc(o.projectedWeighted)}`} />
            <Tile label="This week against last" value={o.weekDelta === null ? "n/a" : `${sg(o.weekDelta)} pts`} note={o.latestWeek ? `Week ${o.latestWeek} ${pc(o.thisWeek)}, week ${o.previousWeek} ${pc(o.lastWeek)}` : undefined} /><Tile label="Units on track / at risk / off track" value={`${o.counts.ON_TRACK} / ${o.counts.AT_RISK} / ${o.counts.OFF_TRACK}`} note={`${o.belowTarget} below target`} />
          </div>
        </section>

        <Card>
          <CardHeader title="Unit comparison" description="Best forecast first." />
          <DataTable caption="Units compared" columns={[{ label: "Unit" }, { label: "Outlook" }, { label: "To date", align: "right" }, { label: "Last week", align: "right" }, { label: "Change", align: "right" }, { label: "Forecast", align: "right" }, { label: "Confidence" }]} maxHeight="30rem">
            {[...x.units].sort((a, b) => (b.projected ?? -1) - (a.projected ?? -1)).map((u) => (
              <tr key={u.id}><td className="font-medium">{u.name}</td><td><Badge tone={OUT[u.outlook].tone}>{OUT[u.outlook].label}</Badge></td><td className="text-right tabular-nums">{pc(u.scoreToDate)}</td><td className="text-right tabular-nums">{pc(u.last)}</td>
                <td className="text-right tabular-nums">{sg(u.delta)}</td><td className="text-right font-medium tabular-nums">{pc(u.projected)}</td><td className="text-xs text-muted">{u.confidence}</td></tr>
            ))}
          </DataTable>
        </Card>

        <section aria-labelledby="h-exec"><h2 id="h-exec" className="mb-2 text-lg font-semibold">Execution</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Tasks not done (last 8 weeks)" value={n.unresolvedTasks} href="/ai/reports/outstanding-activities" /><Tile label="Remark requests waiting" value={n.remarkRequests.open ?? 0} note={`${n.remarkRequests.overdue ?? 0} overdue`} href="/ai/remarks" />
            <Tile label="Monthly reviews waiting" value={n.closureRequests.open ?? 0} note={`${n.awaitingClosureConfirmation} answers await confirmation`} href="/ai/closure" /><Tile label="Corrective plans in progress" value={n.plans.inProgress ?? 0} note={`${n.plans.proposed ?? 0} drafted or proposed`} href="/ai/cases" />
          </div>
        </section>

        <section aria-labelledby="h-mgmt"><h2 id="h-mgmt" className="mb-2 text-lg font-semibold">Needs executive attention</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Open cases" value={n.cases.open ?? 0} note={`${n.cases.highOpen ?? 0} high or critical`} href="/ai/cases" /><Tile label="Escalated to you" value={n.cases.escalated ?? 0} note={`${n.cases.overdueResponse ?? 0} past their response date`} href="/ai/cases" />
            <Tile label="Proposals to decide" value={n.approvalsPending} href={can(actor, "ai.approval.decide") ? "/ai/approvals" : undefined} /><Tile label="Messages unanswered 3+ days" value={n.communications.unanswered3Days ?? 0} href={can(actor, "ai.communication.view") ? "/ai/communications" : undefined} />
          </div>
          <p className="mt-3 text-sm">{o.needsIntervention.length ? <>Units needing direct attention: <span className="font-medium">{o.needsIntervention.join(", ")}</span>.</> : "No unit needs direct executive intervention on the figures."}</p>
        </section>

        <Card>
          <CardHeader title="Predictions" description="What is expected, for which period, on what history and what assumptions. Estimates, not promises. The most worrying first." />
          {preds.length === 0 ? <EmptyState title="Nothing to forecast yet" /> : (
            <ul className="divide-y divide-line">
              {preds.slice(0, 12).map((p) => (
                <li key={p.id} className="space-y-1.5 px-6 py-4 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.subject}</span><Badge tone={CONCERN[p.concern].tone}>{CONCERN[p.concern].label}</Badge><Badge tone="warn">Forecast</Badge><span className="text-xs text-muted">{p.period}, confidence {p.confidence}</span></p>
                  <p>{p.outcome}</p>
                  <details className="text-xs text-muted"><summary className="cursor-pointer text-brand-700 underline">Evidence, assumptions and what moves it</summary>
                    <div className="mt-2 grid gap-3 md:grid-cols-3"><div><p className="font-medium text-ink">Evidence</p><ul className="list-disc pl-4">{p.evidence.map((e) => <li key={e}>{e}</li>)}</ul></div><div><p className="font-medium text-ink">Assumptions</p><ul className="list-disc pl-4">{p.assumptions.map((e) => <li key={e}>{e}</li>)}</ul></div><div><p className="font-medium text-ink">Factors</p><ul className="list-disc pl-4">{p.factors.map((e) => <li key={e}>{e}</li>)}</ul></div></div></details>
                  <p><Badge tone="brand">Recommendation</Badge> <span className="ml-1">{p.recommendation}</span></p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Biggest risks" description="Proposed scale: the application has no approved risk policy." />
            {x.topRisks.length === 0 ? <EmptyState title="No significant risk identified" /> : <ul className="divide-y divide-line">{x.topRisks.map((k) => <li key={k.id} className="px-6 py-3 text-sm"><p className="font-medium">{k.title} <Badge tone={k.band === "Low" ? "done" : k.band === "Moderate" ? "info" : k.band === "High" ? "warn" : "critical"}>{k.band} {k.residual}</Badge></p><p className="text-xs text-muted">{k.units.join(", ")}</p></li>)}</ul>}
          </Card>
          <Card>
            <CardHeader title="Open cases" description="Most serious first." />
            {open.length === 0 ? <EmptyState title="No open case" /> : <ul className="divide-y divide-line">{[...open].sort((a, b) => ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(a.severity) - ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(b.severity)).slice(0, 6).map((c) => <li key={c.reference} className="px-6 py-3 text-sm"><p><Badge tone={c.severity === "CRITICAL" || c.severity === "HIGH" ? "critical" : c.severity === "MEDIUM" ? "warn" : "info"}>{c.severity.toLowerCase()}</Badge> <span className="ml-1 font-medium">{c.title}</span></p><p className="text-xs text-muted">{c.reference}{c.unit ? `, ${c.unit}` : ""}</p></li>)}</ul>}
          </Card>
        </div>

        <Card>
          <CardHeader title="Did the interventions work?" description="Judged on the units' scores after a plan started, never on actions being ticked done." />
          <p className="px-6 py-4 text-sm">{reviewed.length ? `${reviewed.length} plan${reviewed.length === 1 ? "" : "s"} reviewed: ${n.plans.improved ?? 0} improved, ${n.plans.noChange ?? 0} no change, ${n.plans.worse ?? 0} worse, ${n.plans.insufficientData ?? 0} without enough data to say.` : "No plan has reached its review date yet."}</p>
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { NavSelect } from "@/components/ui/nav-select";
import { ScoreText, watDate } from "@/components/status";
import { Badge, Banner, Card, CardHeader, EmptyState, PageHeader, DataTable } from "@/components/ui/primitives";
import { ExecutiveCommentary } from "@/components/executive-oversight/commentary";
import { can, requireActor } from "@/lib/auth/actor";
import { defaultQuarter, type Quarter, latestQuarterSnapshot, listBusinessUnits, listQuarters, weeksOfQuarter } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { MetricCard } from "@/components/ui/metric-card";
import { byUnit, byWeek, totals } from "@/lib/analytics";
import { getDashboardCells } from "@/lib/data/analytics";
import { listSessions } from "@/lib/data/governance";
import { PerformanceChart, type WeekPoint } from "./performance-chart";

export const metadata: Metadata = { title: "Performance" };

const STATE_LABEL: Record<string, { label: string; tone: "done" | "warn" | "critical" | "info" | "undefined" }> = {
  REVIEWED: { label: "Reviewed", tone: "done" },
  AWAITING_REVIEW: { label: "Awaiting review", tone: "warn" },
  MISSING_ZERO: { label: "No report → 0.00", tone: "critical" },
  PENDING: { label: "Not finalised yet", tone: "undefined" },
};

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const quarters = await listQuarters();
  const quarter = quarters.find((q) => q.id === sp.quarter) ?? (await defaultQuarter());
  if (!quarter) return <Card><EmptyState title="No quarter configured" /></Card>;
  const bus = (await listBusinessUnits()).filter((b) => b.reports_weekly);
  const all = can(actor, "weekly_report.view_all");
  const buId = all ? (typeof sp.bu === "string" ? sp.bu : bus.find((b) => b.status === "ACTIVE")?.id) : actor.buId;
  if (!buId) return <Card><EmptyState title="No Business Unit selected" /></Card>;
  const [snap, weeks, cells, sessionRows] = await Promise.all([
    latestQuarterSnapshot(quarter.id, buId), weeksOfQuarter(quarter.id), getDashboardCells(quarter.id).catch(() => []), listSessions(120).catch(() => []),
  ]);
  const sessionByWeek = new Map(sessionRows.map((x) => [x.reporting_week_id, x.outcome]));
  // every figure below is folded from the same stored weekly rows the dashboard uses; nothing is recalculated
  const mine = cells.filter((c) => c.businessUnitId === buId && new Date(c.weekStart) <= new Date());
  const scoredWeeks = mine.filter((c) => !c.holiday).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const t = totals(mine);
  const orgT = totals(cells.filter((c) => new Date(c.weekStart) <= new Date()));
  const ranking = byUnit(cells.filter((c) => new Date(c.weekStart) <= new Date())).filter((u) => u.reportsWeekly && u.avgScore !== null);
  const rank = ranking.findIndex((u) => u.id === buId) + 1;
  const withScore = scoredWeeks.filter((c) => c.score !== null);
  const best = withScore.reduce<typeof withScore[number] | null>((m, c) => (m === null || (c.score ?? 0) > (m.score ?? 0) ? c : m), null);
  const worst = withScore.reduce<typeof withScore[number] | null>((m, c) => (m === null || (c.score ?? 0) < (m.score ?? 0) ? c : m), null);
  const last4 = withScore.slice(-4).map((c) => c.score as number), prev4 = withScore.slice(-8, -4).map((c) => c.score as number);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const momentum = mean(last4) !== null && mean(prev4) !== null ? (mean(last4) as number) - (mean(prev4) as number) : null;
  const fullMarks = withScore.filter((c) => (c.score ?? 0) >= 100).length;
  const zeroWeeks = withScore.filter((c) => (c.score ?? 0) === 0).length;
  const weekLabel = (c: { weekNumber: number; weekStart: string }) => `W${c.weekNumber} · ${watDate(c.weekStart)}`;
  const chartData: WeekPoint[] = byWeek(mine).filter((w) => !w.holiday).map((w) => ({ week: w.label, score: w.avgScore, tasks: w.completion, goals: w.goalsTotal ? (w.goalsDone / w.goalsTotal) * 100 : null }));
  const holidays = weeks.filter((w) => w.reporting_state === "ORGANIZATION_HOLIDAY");
  const buName = bus.find((b) => b.id === buId)?.name ?? "Business Unit";


  return (
    <>
      <PageHeader title="Performance" description={`Quarterly execution for Q${quarter.quarter_number} ${quarter.year}. Every number below traces to a stored weekly snapshot.`}
        actions={<ExecutiveCommentary module="BU_PERFORMANCE" subjectType="BUSINESS_UNIT" subjectId={buId} subjectLabel={`${buName} · Q${quarter.quarter_number} ${quarter.year} performance`} businessUnitId={buId} quarterId={quarter.id} />} />
      <div className="mb-4 flex flex-wrap items-center gap-4" role="group" aria-label="Filters">
        <NavSelect id="performance-quarter" label="Quarter" value={quarter.id} hrefBase={`/performance?${all ? `bu=${buId}&` : ""}quarter=`}
          options={[...quarters].sort((x, y) => y.year - x.year || y.quarter_number - x.quarter_number).map((q) => ({ value: q.id, group: String(q.year), label: `Q${q.quarter_number} ${q.year} · ${q.status.toLowerCase()}` }))} />
      {all ? (
        <>
          <NavSelect id="performance-unit" label="Unit" value={buId} hrefBase={`/performance?quarter=${quarter.id}&bu=`}
            options={[...bus].filter((b) => b.status === "ACTIVE").sort((x, y) => x.name.localeCompare(y.name))
              .map((b) => ({ value: b.id, label: b.name, group: b.unit_type === "DEPARTMENT" ? "Departments" : "Business Units" }))} />
        </>
      ) : null}
      </div>
      <Suspense key={`${quarter.id}-${buId}`} fallback={<PerformanceSkeleton />}>
        <PerformanceBody quarter={quarter} buId={buId} buName={buName} />
      </Suspense>
    </>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading performance">
      <div className="shimmer h-44 rounded-xl" aria-hidden />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>{Array.from({ length: 8 }, (_, i) => <div key={i} className="shimmer h-24 rounded-xl" />)}</div>
      <div className="shimmer h-72 rounded-xl" aria-hidden />
    </div>
  );
}

// The slow part (scores, week-by-week rows, sessions, the metrics) loads inside its own boundary, so changing the quarter or unit
// reloads only this section while the header and filters stay put.
async function PerformanceBody({ quarter, buId, buName }: { quarter: Quarter; buId: string; buName: string }) {
  const [snap, weeks, cells, sessionRows] = await Promise.all([
    latestQuarterSnapshot(quarter.id, buId), weeksOfQuarter(quarter.id), getDashboardCells(quarter.id).catch(() => []), listSessions(120).catch(() => []),
  ]);
  const sessionByWeek = new Map(sessionRows.map((x) => [x.reporting_week_id, x.outcome]));
  // every figure below is folded from the same stored weekly rows the dashboard uses; nothing is recalculated
  const mine = cells.filter((c) => c.businessUnitId === buId && new Date(c.weekStart) <= new Date());
  const scoredWeeks = mine.filter((c) => !c.holiday).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const t = totals(mine);
  const orgT = totals(cells.filter((c) => new Date(c.weekStart) <= new Date()));
  const ranking = byUnit(cells.filter((c) => new Date(c.weekStart) <= new Date())).filter((u) => u.reportsWeekly && u.avgScore !== null);
  const rank = ranking.findIndex((u) => u.id === buId) + 1;
  const withScore = scoredWeeks.filter((c) => c.score !== null);
  const best = withScore.reduce<typeof withScore[number] | null>((m, c) => (m === null || (c.score ?? 0) > (m.score ?? 0) ? c : m), null);
  const worst = withScore.reduce<typeof withScore[number] | null>((m, c) => (m === null || (c.score ?? 0) < (m.score ?? 0) ? c : m), null);
  const last4 = withScore.slice(-4).map((c) => c.score as number), prev4 = withScore.slice(-8, -4).map((c) => c.score as number);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const momentum = mean(last4) !== null && mean(prev4) !== null ? (mean(last4) as number) - (mean(prev4) as number) : null;
  const fullMarks = withScore.filter((c) => (c.score ?? 0) >= 100).length;
  const zeroWeeks = withScore.filter((c) => (c.score ?? 0) === 0).length;
  const weekLabel = (c: { weekNumber: number; weekStart: string }) => `W${c.weekNumber} · ${watDate(c.weekStart)}`;
  const chartData: WeekPoint[] = byWeek(mine).filter((w) => !w.holiday).map((w) => ({ week: w.label, score: w.avgScore, tasks: w.completion, goals: w.goalsTotal ? (w.goalsDone / w.goalsTotal) * 100 : null }));
  const holidays = weeks.filter((w) => w.reporting_state === "ORGANIZATION_HOLIDAY");

  return (
    <>
      <Card>
        <CardHeader title={`${buName} — quarterly execution score`}
          description="Arithmetic mean over every non-holiday reporting week. Missing reports count as 0.00 and never shrink the denominator."
          action={snap ? <Badge tone={snap.calculation_status === "FINAL" ? "done" : "warn"}>{snap.calculation_status === "FINAL" ? "Final" : "Provisional"} · version {snap.version_number}</Badge> : undefined} />
        {!snap ? <EmptyState title="No score calculated yet">The first quarterly snapshot is created when a reporting week is finalised.</EmptyState> : (
          <div className="space-y-4 px-6 py-4">
            <div className="flex flex-wrap items-end gap-6">
              <p className="text-4xl font-semibold"><ScoreText value={snap.score} /></p>
              <dl className="grid grid-cols-3 gap-6 text-sm">
                <div><dt className="text-muted">Reportable weeks</dt><dd className="text-xl font-semibold tabular-nums">{snap.denominator_count}</dd></div>
                <div><dt className="text-muted">Missing reports</dt><dd className="text-xl font-semibold tabular-nums">{snap.missing_report_zero_count}</dd></div>
                <div><dt className="text-muted">Holiday weeks excluded</dt><dd className="text-xl font-semibold tabular-nums">{snap.excluded_holiday_count}</dd></div>
              </dl>
            </div>
            {snap.score === null ? <Banner tone="info" title="N/A">{snap.score_reason}: every week in this quarter is an organisation holiday.</Banner> : null}
            {snap.calculation_status === "PROVISIONAL" ? <Banner tone="warn" title="Provisional score">Weeks not yet finalised count as 0.00 until their final lock, and the quarter stays provisional until every submitted report has been reviewed.</Banner> : null}
            <DataTable caption="Weekly contributions to the quarterly score" columns={[{ label: "Week starting" }, { label: "State" }, { label: "Session" }, { label: "Contribution", align: "right" }]}>
                  {snap.week_contributions.map((c) => {
                    const st = STATE_LABEL[c.state] ?? STATE_LABEL.PENDING;
                    return (
                      <tr key={c.week_id} className="border-b border-line last:border-0">
                        <td>{watDate(c.week_start_at)}</td>
                        <td><Badge tone={st.tone}>{st.label}</Badge></td>
                        <td>{(() => { const o = c.session_skipped ? "SKIPPED" : sessionByWeek.get(c.week_id);
                          return o === "SKIPPED" ? <Badge tone="warn">SKIPPED · reporting still required</Badge> : o === "HELD" ? <Badge tone="done">Held</Badge> : <span className="text-muted">No session recorded</span>; })()}</td>
                        <td className="text-right tabular-nums">{formatPercent(c.value)}</td>
                      </tr>
                    );
                  })}
                  {holidays.map((h) => (
                    <tr key={h.id} className="border-b border-line last:border-0 text-muted">
                      <td>{watDate(h.week_start_at)}</td>
                      <td><Badge tone="info">Organization holiday</Badge></td><td>—</td><td className="text-right">excluded</td>
                    </tr>
                  ))}
                </DataTable>
          </div>
        )}
      </Card>

      {mine.length > 0 ? (
        <div className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold">{buName} — performance metrics</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Rank among units" value={rank > 0 ? `${rank} of ${ranking.length}` : "—"} note="By average weekly score this quarter"
              definition="Where this unit stands among all reporting units, ranked by the average of its weekly scores. Read it with the momentum figure: a rank alone does not show direction." />
            <MetricCard label="Average weekly score" value={t.avgScore} kind="percent" note={orgT.avgScore !== null ? `Organisation average ${formatPercent(orgT.avgScore)}` : undefined}
              definition="The mean of this unit's scored weeks. Compared with the average of all units." />
            <MetricCard label="Momentum" value={momentum === null ? "—" : `${momentum >= 0 ? "+" : ""}${momentum.toFixed(1)} pts`} note="Last 4 scored weeks vs the 4 before"
              definition="The change in average weekly score between the latest four scored weeks and the four before them. Positive means improving." />
            <MetricCard label="Weeks scored" value={t.scoredWeeks} note={`${mine.filter((c) => c.holiday).length} holiday week(s) left out`}
              definition="Reporting weeks in this quarter, so far, that carry a score." />
            <MetricCard label="Best week" value={best?.score != null ? formatPercent(best.score) : "—"} note={best ? weekLabel(best) : undefined} />
            <MetricCard label="Weakest week" value={worst?.score != null ? formatPercent(worst.score) : "—"} note={worst ? weekLabel(worst) : undefined} />
            <MetricCard label="Full-mark weeks" value={fullMarks} note={`${zeroWeeks} week(s) scored 0`} definition="Weeks where every goal was done, and weeks where none was." />
            <MetricCard label="On-time submissions" value={t.onTimeRate} kind="percent" note={`${t.onTimeWeeks} of ${t.reportableWeeks} reportable weeks`}
              definition="Reports submitted before the content lock, as a share of reportable weeks." />
            <MetricCard label="Goals done" value={t.goalsTotal ? (t.goalsDone / t.goalsTotal) * 100 : null} kind="percent" note={`${t.goalsDone} of ${t.goalsTotal} goals`}
              definition="Goals whose tasks were all done, across the weeks so far." />
            <MetricCard label="Tasks done" value={t.completion} kind="percent" note={`${t.tasksDone} done · ${t.tasksNotDone} not done · ${t.tasksUndefined} not marked`}
              definition="Tasks marked done, across the weeks so far." />
            <MetricCard label="Missing reports" value={t.missingWeeks} note="Weeks with no report at final lock" />
            <MetricCard label="Tasks per goal" value={t.goalsTotal ? (t.tasksTotal / t.goalsTotal).toFixed(1) : "—"} note={`${t.goalsTotal} goals · ${t.tasksTotal} tasks`}
              definition="How many tasks each goal is broken into, on average." />
          </div>
          {chartData.length > 1 ? (
            <Card>
              <CardHeader title="Weekly score, tasks and goals" description="One point per scored week for this unit." />
              <div className="px-6 py-4"><PerformanceChart data={chartData} /></div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

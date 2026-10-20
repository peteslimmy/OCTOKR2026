import type { Metadata } from "next";
import Link from "next/link";
import { ScoreText, watDate } from "@/components/status";
import { Badge, Banner, Card, CardHeader, EmptyState, PageHeader, DataTable } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { currentQuarter, latestQuarterSnapshot, listBusinessUnits, weeksOfQuarter } from "@/lib/data";
import { formatPercent } from "@/lib/format";

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
  const quarter = await currentQuarter();
  if (!quarter) return <Card><EmptyState title="No quarter configured" /></Card>;
  const bus = await listBusinessUnits();
  const all = can(actor, "weekly_report.view_all");
  const buId = all ? (typeof sp.bu === "string" ? sp.bu : bus.find((b) => b.status === "ACTIVE")?.id) : actor.buId;
  if (!buId) return <Card><EmptyState title="No Business Unit selected" /></Card>;
  const [snap, weeks] = await Promise.all([latestQuarterSnapshot(quarter.id, buId), weeksOfQuarter(quarter.id)]);
  const holidays = weeks.filter((w) => w.reporting_state === "ORGANIZATION_HOLIDAY");
  const buName = bus.find((b) => b.id === buId)?.name ?? "Business Unit";

  return (
    <>
      <PageHeader title="Performance" description={`Quarterly execution for Q${quarter.quarter_number} ${quarter.year}. Every number below traces to a stored weekly snapshot.`} />
      {all ? (
        <div className="mb-4 flex flex-wrap gap-2" role="navigation" aria-label="Business units">
          {bus.filter((b) => b.status === "ACTIVE").map((b) => (
            <Link key={b.id} href={`/performance?bu=${b.id}`} aria-current={b.id === buId ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${b.id === buId ? "border-brand-700 bg-brand-100 text-brand-800" : "border-line bg-panel"}`}>{b.name}</Link>
          ))}
        </div>
      ) : null}
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
                        <td>{c.session_skipped ? <Badge tone="warn">SKIPPED · reporting still required</Badge> : <span className="text-muted">—</span>}</td>
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
    </>
  );
}

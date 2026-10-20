import type { Metadata } from "next";
import Link from "next/link";
import { ComplianceBadge, PhaseBadge, ScoreText, SubmissionBadge, wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader, DataTable } from "@/components/ui/primitives";
import { requireActor, can } from "@/lib/auth/actor";
import { activeWeeks, getReportView, recentFinalWeeks, reportIdFor } from "@/lib/data";
import { listLateExceptions } from "@/lib/data/governance";
import { StartReportButton } from "./start-report-button";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { getLockSchedule } from "@/lib/data/config";
import { contentLockPhrase, finalLockPhrase } from "@/lib/domain/schedule";

export const metadata: Metadata = { title: "Weekly Execution" };

export default async function WeeklyPage() {
  const actor = await requireActor();
  const schedule = await getLockSchedule();
  if (!actor.buId || !can(actor, "weekly_report.view_own_bu")) {
    return <Card><EmptyState title="No Business Unit report">Weekly reports belong to a Business Unit. Presenters and executives can review every BU under Presentation and Performance.</EmptyState></Card>;
  }
  const [live, past] = await Promise.all([activeWeeks(), recentFinalWeeks(8)]);
  const build = async (weeks: typeof live) =>
    Promise.all(weeks.map(async (w) => {
      const id = await reportIdFor(actor.buId!, w.id);
      return { week: w, id, view: id ? await getReportView(id) : null };
    }));
  const [liveRows, pastRows] = await Promise.all([build(live), build(past)]);
  const canCreate = can(actor, "weekly_report.create");
  const lateOpen = (await listLateExceptions()).filter((e) => e.business_unit_id === actor.buId && e.status === "AUTHORISED");

  return (
    <>
      <PageHeader title="Weekly Execution" description={`${actor.buName}: one shared report per reporting week. Goals and tasks are editable until ${contentLockPhrase(schedule.active)} WAT; tasks are executed until ${finalLockPhrase(schedule.active)} WAT.`} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Live reporting weeks" />
          {liveRows.length === 0 ? <EmptyState title="No reporting week is open">The next week opens on Monday at 00:00 WAT.</EmptyState> : (
            <ul className="divide-y divide-line">
              {liveRows.map(({ week, id, view }) => (
                <li key={week.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div className="space-y-1">
                    <p className="font-medium">{formatWeekLabel(week)}</p>
                    <p className="text-sm text-muted">Content lock {wat(week.content_lock_at)} · Final lock {wat(week.final_lock_at)}</p>
                    <div className="flex flex-wrap gap-2">
                      {week.reporting_state === "ORGANIZATION_HOLIDAY" ? <Badge tone="info">Organization holiday · report not required</Badge> : null}
                      {view ? <><PhaseBadge phase={view.phase} /><SubmissionBadge status={view.report.submission_status} /></> : week.reporting_state === "NORMAL" ? <Badge tone="warn">Not started</Badge> : null}
                    </div>
                  </div>
                  {week.reporting_state === "NORMAL" ? (id ? <Link className={buttonClass("primary", "sm")} href={`/weekly/${id}`}>Open report</Link>
                    : week.phase === "OPEN" && canCreate ? <StartReportButton weekId={week.id} /> : <Badge tone="critical">No report filed</Badge>) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {lateOpen.length > 0 ? (
          <Card>
            <CardHeader title="Authorised late reports" description="An Admin authorised you to file these missing reports late. They are reviewed before any score is amended." />
            <ul className="divide-y divide-line">
              {lateOpen.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div className="space-y-1">
                    <p className="font-medium">{formatWeekLabel(e)}</p>
                    <p className="text-sm text-muted">Reason: {e.reason}</p>
                  </div>
                  {e.weekly_report_id ? <Link className={buttonClass("primary", "sm")} href={`/weekly/${e.weekly_report_id}`}>Open late report</Link>
                    : canCreate ? <StartReportButton weekId={e.reporting_week_id} /> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Finalised weeks" description="Immutable historical records." />
          {pastRows.length === 0 ? <EmptyState title="Nothing finalised yet">Finalised weeks appear here after their final lock.</EmptyState> : (
            <DataTable caption="Finalised weekly reports" columns={[{ label: "Week" }, { label: "Submission" }, { label: "Compliance" }, { label: "Score", align: "right" }, { label: "Open", srOnly: true }]}>
                  {pastRows.map(({ week, id, view }) => (
                    <tr key={week.id} className="border-b border-line last:border-0">
                      <td>{formatWeekLabel(week)}{week.reporting_state === "ORGANIZATION_HOLIDAY" ? " · holiday" : ""}</td>
                      <td>{week.reporting_state === "ORGANIZATION_HOLIDAY" ? <Badge tone="info">Not required</Badge> : <SubmissionBadge status={view?.report.submission_status ?? "NOT_SUBMITTED"} />}</td>
                      <td><ComplianceBadge status={view?.compliance?.status ?? (week.reporting_state === "NORMAL" ? "NON_COMPLIANT" : null)} /></td>
                      <td className="text-right"><ScoreText value={view?.snapshot?.final_score ?? (week.reporting_state === "NORMAL" ? 0 : null)} /></td>
                      <td className="text-right">{id ? <Link className="text-brand-700 underline" href={`/weekly/${id}`}>View</Link> : null}</td>
                    </tr>
                  ))}
                </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}

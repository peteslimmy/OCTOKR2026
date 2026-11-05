import type { Metadata } from "next";
import Link from "next/link";
import { PhaseBadge, SubmissionBadge, wat } from "@/components/status";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireActor, can } from "@/lib/auth/actor";
import { activeWeeks, getReportView, latestQuarterSnapshot, listQuarters, reportIdFor, serverNow } from "@/lib/data";
import { listLateExceptions } from "@/lib/data/governance";
import { NavSelect } from "@/components/ui/nav-select";
import { BuIntelligenceSection } from "@/components/insights/intelligence";
import { WeeklyTrend } from "@/components/weekly/weekly-trend";
import { getBuWeekTrend, getDashboardCells } from "@/lib/data/analytics";
import { WeeklyTimeline } from "./weekly-timeline";
import { defaultQuarter } from "@/lib/data";
import { listBusinessUnits } from "@/lib/data";
import { AddWeeklyReportButton, StartReportButton } from "./start-report-button";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { getLockSchedule } from "@/lib/data/config";
import { contentLockPhrase, finalLockPhrase } from "@/lib/domain/schedule";

export const metadata: Metadata = { title: "Weekly Execution" };

export default async function WeeklyPage({ searchParams }: PageProps<"/weekly">) {
  const sp = await searchParams;
  const actor = await requireActor();
  const schedule = await getLockSchedule();
  // a Super Admin works on behalf of a unit they choose; everyone else works their own unit
  const filesForAny = can(actor, "weekly_report.file_for_any_bu");
  const reporting = filesForAny ? (await listBusinessUnits()).filter((b) => b.reports_weekly && b.status === "ACTIVE").sort((x, y) => x.name.localeCompare(y.name)) : [];
  const chosen = filesForAny ? (reporting.find((b) => b.id === sp.bu) ?? reporting[0] ?? null) : null;
  const buId = filesForAny ? chosen?.id ?? null : actor.buId;
  const buName = filesForAny ? chosen?.name ?? null : actor.buName;
  if (!buId || !(can(actor, "weekly_report.view_own_bu") || filesForAny)) {
    return <Card><EmptyState title="Your account has no weekly report to fill">Weekly reports belong to a Business Unit that files them, and the person who adds the goals and tasks is that unit&apos;s Business Unit Lead. {actor.buName ? `Your unit (${actor.buName}) does not file weekly reports. ` : ""}Presenters and executives can review every unit under Presentation and Performance.</EmptyState></Card>;
  }
  const [live, nowIso] = await Promise.all([activeWeeks(), serverNow()]);
  const build = async (weeks: typeof live) =>
    Promise.all(weeks.map(async (w) => {
      const id = await reportIdFor(buId, w.id);
      return { week: w, id, view: id ? await getReportView(id) : null };
    }));
  const liveRows = await build(live);
  const trendQuarter = live[0]?.quarter_id ?? (await defaultQuarter())?.id;
  const trend = trendQuarter ? await getBuWeekTrend(buId, trendQuarter).catch(() => []) : [];
  const quarterCells = trendQuarter ? (await getDashboardCells(trendQuarter).catch(() => [])).filter((c) => c.businessUnitId === buId) : [];
  const quarterRow = trendQuarter ? (await listQuarters()).find((q) => q.id === trendQuarter) : undefined;
  const quarterSnap = trendQuarter ? await latestQuarterSnapshot(trendQuarter, buId).catch(() => null) : null;
  const canCreate = can(actor, "weekly_report.create");
  // weeks this unit can begin right now, and, when there are none, the plain reason why
  const startable = liveRows.filter(({ week, id }) => week.reporting_state === "NORMAL" && week.phase === "OPEN" && !id).map(({ week }) => ({ id: week.id, label: formatWeekLabel(week) }));
  const why = liveRows.length === 0 ? "No reporting week is open yet. The next one opens on its opening time; an Admin can change that under Calendar & holidays."
    : liveRows.every(({ week }) => week.reporting_state === "ORGANIZATION_HOLIDAY") ? "This week is an organisation holiday, so no report is due."
    : liveRows.some(({ id, week }) => id && week.reporting_state === "NORMAL") ? "This week's report is already started. Open it below to add goals and tasks."
    : "The open week is locked. An Admin can suspend the locks under Calendar & holidays.";
  const lateOpen = (await listLateExceptions()).filter((e) => e.business_unit_id === buId && e.status === "AUTHORISED");

  return (
    <>
      <PageHeader title="Weekly Execution" actions={canCreate ? <AddWeeklyReportButton weeks={startable} whyNot={why} businessUnitId={filesForAny ? buId : undefined} /> : undefined} description={`${buName}: one shared report per reporting week. Goals and tasks are editable until ${contentLockPhrase(schedule.active)} WAT; tasks are executed until ${finalLockPhrase(schedule.active)} WAT.`} />
      <div className="space-y-6">
        {filesForAny ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <NavSelect id="weekly-unit" label="Working on behalf of" value={buId} hrefBase="/weekly?bu=" options={reporting.map((b) => ({ value: b.id, label: b.name }))} />
              <p className="text-sm text-muted">Goals, tasks and submission you make here are filed for {buName} and recorded in the audit trail under your name.</p>
            </div>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={`${buName} — week by week`} description="The share of goals done compared with the share of tasks done, week after week this quarter." />
          <WeeklyTrend data={trend} />
        </Card>
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
                    : week.phase === "OPEN" && canCreate ? <StartReportButton weekId={week.id} businessUnitId={filesForAny ? buId : undefined} /> : <Badge tone="critical">No report filed</Badge>) : null}
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
                    : canCreate ? <StartReportButton weekId={e.reporting_week_id} businessUnitId={filesForAny ? buId : undefined} /> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <WeeklyTimeline cells={quarterCells} nowIso={nowIso} quarterLabel={quarterRow ? `Q${quarterRow.quarter_number} ${quarterRow.year}` : "This quarter"} quarterScore={quarterSnap?.score === null || quarterSnap?.score === undefined ? null : Number(quarterSnap.score)} quarterFinal={quarterSnap?.calculation_status === "FINAL"} />
        <BuIntelligenceSection buId={buId} buName={buName ?? "Your unit"} quarterId={trendQuarter} />
      </div>
    </>
  );
}

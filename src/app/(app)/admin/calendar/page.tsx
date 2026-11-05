import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { currentQuarter, serverNow, weeksOfQuarter } from "@/lib/data";
import { listHolidayAmendments, listHolidayRequests } from "@/lib/data/governance";
import { wat } from "@/components/status";
import { getLockSchedule } from "@/lib/data/config";
import { LockScheduleForm } from "../lock-schedule-form";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { HolidayAmendmentButton, HolidayForm, HolidayRequests, WeekLockSwitch, WeekOpeningEditor } from "../admin-actions";

export const metadata: Metadata = { title: "Calendar & holidays" };

export default async function CalendarPage() {
  const actor = await requireActor();
  const quarter = await currentQuarter();
  const manage = can(actor, "reporting.period.holiday.manage");
  const amendHoliday = can(actor, "quarter.score.amend");
  const suspendLocks = can(actor, "reporting.locks.suspend");
  const manageWeeks = can(actor, "reporting.week.manage");
  if (!manage && !amendHoliday && !suspendLocks && !manageWeeks) return <Card><div className="p-6 text-sm">The calendar is not available for your role.</div></Card>;
  const schedule = manageWeeks ? await getLockSchedule() : null;
  const weeks = quarter ? await weeksOfQuarter(quarter.id) : [];
  const amendWeeks = weeks;
  const now = await serverNow();
  const amendments = amendHoliday ? await listHolidayAmendments() : [];
  const holidayRequests = amendHoliday ? await listHolidayRequests() : [];
  return (
    <>
      <PageHeader title="Calendar & holidays" description="Declare organisation holidays and correct past weeks. A holiday means no report is due and the week is left out of quarterly scores." />
      <div className="space-y-6">
        {can(actor, "reporting.period.holiday.manage") ? (
          <Card>
            <CardHeader title="Organization Holiday" description="Declare whole reporting weeks as an organisation-wide closure: no BU report is due, reminders and missing-report penalties are suppressed, and the weeks are excluded from the quarterly score. This is not the same as skipping an OKR session." />
            <div className="px-6 py-4">
              {weeks.length === 0 ? <EmptyState title="No reporting weeks">Activate a quarter first.</EmptyState> : (
                <HolidayForm weeks={weeks.map((w) => ({ id: w.id, label: formatWeekLabel(w), holiday: w.reporting_state === "ORGANIZATION_HOLIDAY", locked: w.status === "FINAL_LOCKED" || new Date(w.final_lock_at) <= new Date(now) }))} />
              )}
            </div>
          </Card>
        ) : null}

        {schedule ? (
          <Card>
            <CardHeader title="Reporting window and locks" description="The policy for every week: when reporting opens, when goals and tasks lock and when the week is scored. When the policy changes, new weeks follow it, and you can apply it to existing weeks that have not final-locked." />
            <LockScheduleForm active={schedule.active} history={schedule.history} firstAffected={schedule.first_affected_week} canChange reapplicable={schedule.weeks_reapplicable ?? 0} />
          </Card>
        ) : null}

        {suspendLocks || manageWeeks ? (
          <Card>
            <CardHeader title="Exceptions for a single week" description="Give one week its own opening time, or switch its content lock and final lock off so Business Unit Leads can create or finish their weekly reports by hand, then switch them back on. A week that has already been finalised cannot be reopened, and an organisation-holiday week still needs no report." />
            <ul className="divide-y divide-line">
              {weeks.filter((w) => w.status !== "FINAL_LOCKED" && w.week_start_at <= new Date(new Date(now).getTime() + 14 * 864e5).toISOString()).map((w) => {
                const label = formatWeekLabel(w);
                const off = !!w.locks_suspended_at;
                return (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                    <span className="flex flex-wrap items-center gap-2">{label}
                      {off ? <Badge tone="warn">Locks suspended</Badge> : new Date(w.final_lock_at) <= new Date(now) ? <Badge tone="locked">Locked by the clock</Badge> : new Date(w.content_lock_at) <= new Date(now) ? <Badge tone="locked">Content locked</Badge> : new Date(w.week_start_at) > new Date(now) ? <Badge tone="info">Not open yet</Badge> : <Badge tone="done">Open</Badge>}
                      {w.reporting_state === "ORGANIZATION_HOLIDAY" ? <Badge tone="warn">Organization holiday · no report is due</Badge> : null}
                      {off && w.locks_suspended_reason ? <span className="text-muted">· {w.locks_suspended_reason}</span> : null}
                      <span className="w-full text-xs text-muted">Reporting opens {wat(w.opens_at_override ?? w.week_start_at)} WAT{w.opens_at_override ? " (adjusted)" : " (default)"}
                        {w.reporting_state === "ORGANIZATION_HOLIDAY" ? " · Business Units will not see a report to fill while this week is a holiday. Reverse the holiday under Holiday amendments first." : ""}</span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      {manageWeeks ? <WeekOpeningEditor weekId={w.id} weekLabel={label} opensAt={w.opens_at_override ?? w.week_start_at} overridden={!!w.opens_at_override} /> : null}
                      {suspendLocks ? <WeekLockSwitch weekId={w.id} weekLabel={label} suspended={off} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {amendHoliday ? (
          <Card>
            <CardHeader title="Holiday amendments" description="Controlled changes to past weeks: declare a locked or already-reported week a holiday, or reverse a holiday. A week that has final-locked needs a request and a second Admin to approve it. Each change creates new versioned quarterly scores; nothing earlier is rewritten." />
            <ul className="divide-y divide-line">
              {amendWeeks.filter((w) => w.reporting_state === "ORGANIZATION_HOLIDAY" || w.status === "FINAL_LOCKED" || new Date(w.final_lock_at) <= new Date(now)).map((w) => {
                const label = formatWeekLabel(w);
                const hol = w.reporting_state === "ORGANIZATION_HOLIDAY";
                return (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                    <span>{label} {hol ? <Badge tone="info">Organization holiday</Badge> : <Badge tone="locked">Final locked</Badge>}</span>
                    <HolidayAmendmentButton weekId={w.id} weekLabel={label} direction={hol ? "REVERSE" : "DECLARE"} request={w.status === "FINAL_LOCKED"} />
                  </li>
                );
              })}
            </ul>
            {amendments.length > 0 ? (
              <div className="border-t border-line px-6 py-4 text-sm">
                <h3 className="mb-2 font-medium">History</h3>
                <ul className="space-y-2">
                  {amendments.map((a) => (
                    <li key={a.id}>
                      <span className="font-medium">{a.direction === "DECLARE" ? "Holiday applied" : "Holiday reversed"}</span> · {formatWeekLabel(a)} · {a.actor ?? "Admin"} ·{" "}
                      {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(a.created_at))}
                      {a.quarter_locked ? " · quarter locked (not reopened)" : ""}
                      <span className="block text-muted">Reason: {a.reason} · {a.impact.length} BU score version(s) created{a.backfilled_zero_count ? ` · ${a.backfilled_zero_count} missing-report zero(s) recorded` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}

        {amendHoliday ? (
          <Card>
            <CardHeader title="Holiday amendment requests" description="Changes to a closed week are made in two steps by two different people: one Admin asks, another approves. Approving applies the change at once." />
            <HolidayRequests me={actor.id} requests={holidayRequests.map((r) => ({
              id: r.id, status: r.status, direction: r.direction, reason: r.reason, label: formatWeekLabel(r), requestedBy: r.requested_by, requestedById: r.requested_by_id,
              decidedBy: r.decided_by, comment: r.decision_comment, when: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(r.created_at)),
            }))} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

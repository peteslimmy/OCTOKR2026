import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { currentQuarter, serverNow, weeksOfQuarter } from "@/lib/data";
import { listHolidayAmendments, listHolidayRequests } from "@/lib/data/governance";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { HolidayAmendmentButton, HolidayForm, HolidayRequests } from "../admin-actions";

export const metadata: Metadata = { title: "Calendar & holidays" };

export default async function CalendarPage() {
  const actor = await requireActor();
  const quarter = await currentQuarter();
  const manage = can(actor, "reporting.period.holiday.manage");
  const amendHoliday = can(actor, "quarter.score.amend");
  if (!manage && !amendHoliday) return <Card><div className="p-6 text-sm">The calendar is not available for your role.</div></Card>;
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

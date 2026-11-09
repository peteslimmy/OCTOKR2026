import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireActor } from "@/lib/auth/actor";
import { BUSINESS_ZONE } from "@/lib/domain/time";
import { nextDueAt, type Frequency } from "@/lib/report-email/periods";
import { listPeople, loadSchedules, shieldRuns, shieldSchedules } from "@/lib/report-email/service";
import { adminClient } from "@/lib/supabase/admin";
import { EmailReports, type RunView, type ScheduleView } from "./email-reports";

export const metadata: Metadata = { title: "Automated email reports" };

export default async function EmailReportsPage() {
  const actor = await requireActor();
  const manage = actor.permissions.has("report_email.manage");
  const history = actor.permissions.has("report_email.history");
  if (!manage && !history) return <Card><EmptyState title="Automated email reports are not available for your role" /></Card>;
  const now = DateTime.now().setZone(BUSINESS_ZONE);
  const [schedules, people, runs] = await Promise.all([
    loadSchedules().then((rows) => shieldSchedules(rows, actor)),
    manage ? listPeople(actor) : Promise.resolve([]),
    history
      ? adminClient().from("report_email_runs")
          .select("id, schedule_id, period_key, trigger, status, subject, created_at, report_email_schedules(name), report_email_deliveries(id, email, status, error, attempts)")
          .order("created_at", { ascending: false }).limit(30).then(async (r) => (await shieldRuns((r.data ?? []) as unknown as (RunView & { report_email_deliveries: { email: string }[] })[], actor)) as unknown as RunView[])
      : Promise.resolve([] as RunView[]),
  ]);
  const view: ScheduleView[] = schedules.map((s) => ({
    id: s.id, name: s.name, frequency: s.frequency, sendWeekday: s.send_weekday, sendDay: s.send_day, sendTime: String(s.send_time).slice(0, 5),
    recipientIds: s.recipient_ids, sections: s.sections, isActive: s.is_active,
    nextSendAt: s.is_active ? nextDueAt({ ...s, frequency: s.frequency as Frequency }, now).toFormat("ccc d LLL yyyy, HH:mm") + " WAT" : null,
  }));
  return (
    <>
      <PageHeader title="Automated email reports"
        description="Weekly, monthly, quarterly and annual summaries of Business Unit results, emailed to the people you choose. Each period is sent once; figures come from the scores already published."
        actions={<Link href="/reports" className={buttonClass("secondary", "sm")}>All reports</Link>} />
      <EmailReports schedules={view} people={people} runs={runs} canManage={manage} canSend={actor.permissions.has("report_email.send")} canHistory={history} />
    </>
  );
}

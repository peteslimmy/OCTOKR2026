import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { getLockSchedule, getRetention } from "@/lib/data/config";
import { contentLockPhrase } from "@/lib/domain/schedule";
import { getEmailSummary } from "@/lib/data/governance";
import { resolveEmail } from "@/lib/integrations/runtime";
import { currentPenaltyRate } from "@/lib/data";
import { LockScheduleForm } from "../lock-schedule-form";
import { RetentionForm } from "../retention-form";
import { ReminderSettings } from "../reminder-settings";
import { PenaltyRateForm } from "../admin-actions";
import { listAllowedDomains } from "@/lib/data/governance";
import { EmailDomains } from "./email-domains";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireActor();
  const [rate, schedule] = await Promise.all([currentPenaltyRate(), getLockSchedule()]);
  const domains = actor.roles.includes("SUPER_ADMIN") ? (await listAllowedDomains().catch(() => [])).map((d) => d.domain) : null;
  const retention = can(actor, "retention.configure") ? await getRetention() : null;
  const mailNow = await resolveEmail().catch(() => ({ transport: null }));
  const emailSummary = can(actor, "reminders.configure") ? await getEmailSummary() : null;
  return (
    <>
      <PageHeader title="Settings" description="Scoring penalty, lock times, reminders and data retention. Changes to governance settings are approved by a different person." />
      <div className="space-y-6">
        {domains ? (
          <Card>
            <CardHeader title="Approved email domains" description="Only people whose email is on one of these domains can be added or sign in. The Super Admin account is the one exception and may use any address." />
            <EmailDomains domains={domains} />
          </Card>
        ) : null}
        {can(actor, "integrity_penalty.configure") ? (
          <Card>
            <CardHeader title="Integrity penalty rate" description="Applied as a percentage of a BU's original weekly base score when a DONE task is corrected to NOT_DONE. Multiple applied penalties are summed, then applied once. Past scores never change when this rate changes." />
            <div className="px-6 py-4"><PenaltyRateForm current={rate} /></div>
          </Card>
        ) : null}

        {can(actor, "reporting.week.manage") ? (
          <Card>
            <CardHeader title="Reporting window and locks" description="When reporting opens, when goals and tasks lock and when a week is scored. A change applies to weeks generated afterwards; existing weeks move only when you apply the policy to them." />
            <LockScheduleForm active={schedule.active} history={schedule.history} firstAffected={schedule.first_affected_week} canChange reapplicable={schedule.weeks_reapplicable ?? 0} />
          </Card>
        ) : null}
        {retention ? (
          <Card>
            <CardHeader title="Data retention" description="Read notifications and finished emails are removed after the periods below. Audit records, scores, ledger entries and every other record of what happened are never removed." />
            <RetentionForm current={{ enabled: retention.enabled, months: retention.read_notifications_months, days: retention.email_days }} />
          </Card>
        ) : null}
        {emailSummary ? (
          <Card>
            <CardHeader title="Reminders and email" description="When Business Unit Leads are reminded to submit, how often, and whether email is leaving the system. Holiday weeks are never reminded about." />
            <ReminderSettings settings={{ remindersEnabled: emailSummary.settings.reminders_enabled, reminderHours: emailSummary.settings.reminder_hours, maxPerWeek: emailSummary.settings.max_reminders_per_week, emailEnabled: emailSummary.settings.email_enabled }}
              counts={emailSummary.counts} problems={emailSummary.recent_problems} transport={mailNow.transport?.name ?? "none"} lockText={contentLockPhrase(schedule.active)} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

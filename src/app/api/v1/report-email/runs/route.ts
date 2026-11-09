import { api, fail } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { shieldRuns } from "@/lib/report-email/service";

/** Delivery history: the latest runs with the outcome for each recipient. Error text is the transport's own and holds no report data. */
export const GET = api({}, async ({ actor }) => {
  if (!actor.permissions.has("report_email.history")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const { data, error } = await adminClient().from("report_email_runs")
    .select("id, schedule_id, period_key, period_start, period_end, trigger, status, subject, created_at, completed_at, report_email_schedules(name), report_email_deliveries(id, email, status, error, attempts, sent_at)")
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return shieldRuns(data ?? [], actor);
});

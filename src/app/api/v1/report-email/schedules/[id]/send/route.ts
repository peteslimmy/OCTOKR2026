import { api, fail } from "@/lib/api/handler";
import type { Frequency } from "@/lib/report-email/periods";
import { sendBody } from "@/lib/report-email/schema";
import { loadSchedule, resolvePeriod, startAndSend } from "@/lib/report-email/service";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends a schedule's summary now, for the latest finished period or one the person names. A period already sent for this schedule is refused. */
export const POST = api({ body: sendBody }, async ({ body, actor, params, rpc }) => {
  if (!actor.permissions.has("report_email.send")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  if (!uuid.test(params.id)) throw fail("NOT_FOUND", 404, "That schedule was not found.");
  const schedule = await loadSchedule(params.id);
  if (!schedule) throw fail("NOT_FOUND", 404, "That schedule was not found.");
  const period = resolvePeriod(schedule.frequency as Frequency, body.periodKey);
  if (period === "INVALID") throw fail("VALIDATION_ERROR", 422, "That period does not match this schedule's frequency.");
  if (period === "NOT_ENDED") throw fail("VALIDATION_ERROR", 422, "That period has not finished yet.");
  const out = await startAndSend({ schedule, period, trigger: "MANUAL", actor: actor.id, rpc });
  return { runId: out.runId, status: out.status, sent: out.sent, failed: out.failed, recipients: out.recipients, period: period.label };
});

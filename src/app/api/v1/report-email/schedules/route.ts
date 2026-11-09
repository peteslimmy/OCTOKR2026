import { DateTime } from "luxon";
import { api, fail } from "@/lib/api/handler";
import { BUSINESS_ZONE } from "@/lib/domain/time";
import { nextDueAt, type Frequency } from "@/lib/report-email/periods";
import { scheduleBody } from "@/lib/report-email/schema";
import { loadSchedules, shieldSchedules } from "@/lib/report-email/service";

/** Schedules, each with the next time it will send. */
export const GET = api({}, async ({ actor }) => {
  if (!actor.permissions.has("report_email.manage") && !actor.permissions.has("report_email.history")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const now = DateTime.now().setZone(BUSINESS_ZONE);
  return (await shieldSchedules(await loadSchedules(), actor)).map((s) => ({ ...s, nextSendAt: s.is_active ? nextDueAt({ ...s, frequency: s.frequency as Frequency }, now).toUTC().toISO() : null }));
});

export const POST = api({ body: scheduleBody }, async ({ body, actor, rpc }) => {
  const id = await rpc<string>("save_report_email_schedule", {
    p_actor: actor.id, p_id: null, p_name: body.name, p_frequency: body.frequency, p_send_weekday: body.sendWeekday, p_send_day: body.sendDay,
    p_send_time: body.sendTime, p_recipient_ids: body.recipientIds, p_sections: body.sections, p_active: body.isActive,
  });
  return { id };
});

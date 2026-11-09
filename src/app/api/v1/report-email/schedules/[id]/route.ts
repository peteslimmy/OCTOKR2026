import { api, fail } from "@/lib/api/handler";
import { scheduleBody } from "@/lib/report-email/schema";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PUT = api({ body: scheduleBody }, async ({ body, actor, params, rpc }) => {
  if (!uuid.test(params.id)) throw fail("NOT_FOUND", 404, "That schedule was not found.");
  await rpc("save_report_email_schedule", {
    p_actor: actor.id, p_id: params.id, p_name: body.name, p_frequency: body.frequency, p_send_weekday: body.sendWeekday, p_send_day: body.sendDay,
    p_send_time: body.sendTime, p_recipient_ids: body.recipientIds, p_sections: body.sections, p_active: body.isActive,
  });
  return { id: params.id };
});

export const DELETE = api({}, async ({ actor, params, rpc }) => {
  if (!uuid.test(params.id)) throw fail("NOT_FOUND", 404, "That schedule was not found.");
  await rpc("delete_report_email_schedule", { p_actor: actor.id, p_id: params.id });
  return { deleted: true };
});

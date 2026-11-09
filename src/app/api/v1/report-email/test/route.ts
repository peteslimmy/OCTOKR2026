import { api, fail } from "@/lib/api/handler";
import type { Frequency } from "@/lib/report-email/periods";
import type { Section } from "@/lib/report-email/render";
import { previewBody } from "@/lib/report-email/schema";
import { buildFor, renderFor, resolvePeriod, sendOne } from "@/lib/report-email/service";

/** Sends the summary to the signed-in person only, never to a schedule's recipients. */
export const POST = api({ body: previewBody }, async ({ body, actor, rpc }) => {
  if (!actor.permissions.has("report_email.manage")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const period = resolvePeriod(body.frequency as Frequency, body.periodKey);
  if (period === "INVALID" || period === "NOT_ENDED") throw fail("VALIDATION_ERROR", 422, "That period is not available for a test.");
  const r = await renderFor(await buildFor(period), { name: body.name || "Report summary", sections: body.sections as Section[] }, { testNotice: true });
  const res = await sendOne(actor.email, { ...r, subject: `[Test] ${r.subject}` });
  if (res !== "SENT") throw fail("EMAIL_NOT_SENT", 502, `The test email could not be sent: ${res.error}.`);
  await rpc("record_report_email_test", { p_actor: actor.id, p_schedule: null, p_kind: "TEST", p_period_key: period.key });
  return { sentTo: actor.email, periodLabel: period.label };
});

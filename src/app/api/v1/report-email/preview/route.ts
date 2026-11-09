import { api, fail } from "@/lib/api/handler";
import type { Frequency } from "@/lib/report-email/periods";
import type { Section } from "@/lib/report-email/render";
import { previewBody } from "@/lib/report-email/schema";
import { buildFor, renderFor, resolvePeriod } from "@/lib/report-email/service";

/** The email exactly as it would be sent, for the latest finished period (or a named one). Nothing is sent or stored. */
export const POST = api({ body: previewBody }, async ({ body, actor, rpc }) => {
  if (!actor.permissions.has("report_email.manage")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const period = resolvePeriod(body.frequency as Frequency, body.periodKey);
  if (period === "INVALID" || period === "NOT_ENDED") throw fail("VALIDATION_ERROR", 422, "That period is not available for a preview.");
  const summary = await buildFor(period);
  const r = await renderFor(summary, { name: body.name || "Report summary", sections: body.sections as Section[] });
  await rpc("record_report_email_test", { p_actor: actor.id, p_schedule: null, p_kind: "PREVIEW", p_period_key: period.key });
  return { subject: r.subject, html: r.html, text: r.text, periodLabel: period.label, empty: summary.empty };
});

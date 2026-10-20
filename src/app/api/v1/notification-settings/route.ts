import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";
import { requestConfigChange } from "@/lib/api/config-request";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/** Reminder and email settings, plus how the email channel is doing (counts and recent problems, never message bodies). */
export const GET = api({}, async ({ actor }) => {
  requirePerm(actor, "reminders.configure");
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_email_summary");
  if (error) throw dbError(error, "email summary");
  return data;
});

export const PUT = api(
  { stepUp: true, body: z.object({
    remindersEnabled: z.boolean(), reminderHours: z.array(z.number().int().min(1).max(72)).min(1).max(4), maxRemindersPerWeek: z.number().int().min(1).max(5), emailEnabled: z.boolean(), reason: z.string().trim().min(1).max(2000),
  }) },
  async (ctx) => {
    requirePerm(ctx.actor, "reminders.configure");
    const { reason, ...proposed } = ctx.body;
    return requestConfigChange(ctx, "REMINDER_SETTINGS", null, proposed, reason);          // approved by a different person (ADR-068)
  },
);

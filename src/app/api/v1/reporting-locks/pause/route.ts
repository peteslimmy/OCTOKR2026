import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * Super Admin: switch the content locks off for the whole organisation (a temporary pause) or back on (migration 20261112000001).
 * A pause holds every open week open, in the same way as suspending one week's locks, until it is switched back on or its optional resume time (at most 30 days away)
 * is reached. The final lock is never paused. Needs a recent second factor and a reason; the database checks the permission and audits every change.
 */
export const POST = api(
  { stepUp: true, body: z.object({ paused: z.boolean(), reason: z.string().trim().min(1).max(2000), resumeAt: z.string().datetime({ offset: true }).nullable().optional() }) },
  async ({ actor, body, rpc }) => rpc("set_reporting_locks_paused", { p_actor: actor.id, p_paused: body.paused, p_reason: body.reason, p_resume_at: body.paused ? (body.resumeAt ?? null) : null }),
);

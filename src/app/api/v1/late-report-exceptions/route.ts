import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listLateExceptions } from "@/lib/data/governance";

/** Scoped by RLS: BU Leads see their own BU's exceptions; score-amend holders and reviewers see all. */
export const GET = api({}, async () => listLateExceptions());

/** Authorise a late report. Requires `quarter.score.amend`; the database re-checks permission, state and idempotency. */
export const POST = api(
  { body: z.object({
    businessUnitId: z.string().uuid(), reportingWeekId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100),
  }) },
  async ({ actor, body, rpc }) => rpc("authorise_late_report_exception", {
    p_actor: actor.id, p_business_unit_id: body.businessUnitId, p_week_id: body.reportingWeekId, p_reason: body.reason, p_idempotency_key: body.idempotencyKey,
  }),
);

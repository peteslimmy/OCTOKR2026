import { z } from "zod";
import { api } from "@/lib/api/handler";

const STATUSES = ["UNDER_INVESTIGATION", "AWAITING_RESPONSE", "INTERVENTION_REQUIRED", "CORRECTIVE_ACTION_IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"] as const;

/** POST /api/v1/ai/cases/{id}/status { status, note? } — a case manager moves a case along. Resolving needs a written resolution; closing follows resolving. */
export const POST = api({ body: z.object({ status: z.enum(STATUSES), note: z.string().max(8000).optional() }) }, async ({ actor, body, params, rpc }) =>
  rpc("ai_case_update", { p_actor: actor.id, p_case: params.id, p_status: body.status, p_note: body.note ?? null }));

import { z } from "zod";
import { api } from "@/lib/api/handler";

const OPTIONS = ["COMPLETED_NOT_RECORDED", "IN_PROGRESS", "PARTIALLY_COMPLETED", "STEPPED_DOWN", "NO_LONGER_REQUIRED", "DEFERRED", "BLOCKED", "SCOPE_CHANGED"] as const;

/** POST /api/v1/ai/closure/{requestId} { items: [{ goalId, option, explanation?, evidenceNote? }] } — a unit's answers to the monthly review. All or none; own unit only. */
export const POST = api({
  body: z.object({ items: z.array(z.object({ goalId: z.string().uuid(), option: z.enum(OPTIONS), explanation: z.string().max(4000).optional(), evidenceNote: z.string().max(2000).optional() }).strict()).min(1).max(100) }),
}, async ({ actor, body, params, rpc }) =>
  rpc("ai_submit_dispositions", { p_actor: actor.id, p_request: params.id, p_items: body.items.map((i) => ({ goalId: i.goalId, option: i.option, explanation: i.explanation ?? "", evidenceNote: i.evidenceNote ?? "" })) }));

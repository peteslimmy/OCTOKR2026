import { z } from "zod";
import { api } from "@/lib/api/handler";

const REASONS = ["EXECUTION", "RESOURCES", "DEPENDENCY", "AWAITING_DECISION", "PRIORITY_CHANGE", "UNREALISTIC_TIMELINE", "TECHNICAL", "COMPLETED_NOT_RECORDED", "OTHER"] as const;

/** POST /api/v1/ai/remarks/{requestId} { items: [{ taskId, reasonCode, remark? }] } — a unit's remarks on the tasks it did not finish. All or none; only a person of that unit. */
export const POST = api({
  body: z.object({ items: z.array(z.object({ taskId: z.string().uuid(), reasonCode: z.enum(REASONS), remark: z.string().max(2000).optional() }).strict()).min(1).max(200) }),
}, async ({ actor, body, params, rpc }) =>
  rpc("ai_submit_remarks", { p_actor: actor.id, p_request: params.id, p_items: body.items.map((i) => ({ taskId: i.taskId, reasonCode: i.reasonCode, remark: i.remark ?? "" })) }));

import { z } from "zod";
import { api } from "@/lib/api/handler";

const SEVERITY = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/** POST /api/v1/ai/admin/escalation { severity, step, audience, afterHours } — sets one escalation step. Every severity must keep a step that reaches the executives. */
export const POST = api({ stepUp: true, body: z.object({ severity: SEVERITY, step: z.number().int().min(1).max(5), audience: z.enum(["BU_LEAD", "AFFECTED_BU_LEADS", "EXECUTIVES"]), afterHours: z.number().int().min(0).max(720) }) }, async ({ actor, body, rpc }) => {
  await rpc("ai_set_escalation", { p_actor: actor.id, p_severity: body.severity, p_step: body.step, p_audience: body.audience, p_after_hours: body.afterHours });
  return body;
});

/** DELETE /api/v1/ai/admin/escalation { severity, step } — removes one step, unless it would leave the severity without a step or without one that reaches the executives. */
export const DELETE = api({ stepUp: true, body: z.object({ severity: SEVERITY, step: z.number().int().min(1).max(5) }) }, async ({ actor, body, rpc }) => {
  await rpc("ai_delete_escalation", { p_actor: actor.id, p_severity: body.severity, p_step: body.step });
  return body;
});

import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api(
  {
    body: z.object({
      taskId: z.string().uuid(),
      targetStatus: z.enum(["DONE", "NOT_DONE"]),
      reason: z.string().trim().max(2000),
      penaltyDecision: z.enum(["APPLY", "WAIVE"]).nullish(),
      waiverReason: z.string().trim().max(2000).nullish(),
      confirm: z.literal(true),
      idempotencyKey: z.string().min(8).max(100),
    }),
  },
  async ({ actor, body, rpc }) =>
    rpc("create_integrity_correction", {
      p_actor: actor.id, p_task_id: body.taskId, p_target_status: body.targetStatus, p_reason: body.reason,
      p_penalty_decision: body.penaltyDecision ?? null, p_waiver_reason: body.waiverReason ?? null, p_idempotency_key: body.idempotencyKey,
    }),
);

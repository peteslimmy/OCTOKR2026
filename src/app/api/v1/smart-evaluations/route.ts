import { z } from "zod";
import { api } from "@/lib/api/handler";
import { evaluateForGoal } from "@/lib/api/goals";

/** Preview only: nothing is persisted. SMART warnings are guidance and never block saving (BR-GOAL-003). */
export const POST = api(
  {
    body: z.object({
      goalType: z.enum(["KR_ALIGNED", "STRETCH"]),
      subKeyResultId: z.string().uuid().nullish(),
      title: z.string().trim().max(500),
      description: z.string().trim().max(4000).nullish(),
      tasks: z.array(z.string().trim().max(1000)).max(50).optional(),   // sent by older screens and ignored: only the goal is checked
    }),
  },
  async ({ body }) => evaluateForGoal(body),
);

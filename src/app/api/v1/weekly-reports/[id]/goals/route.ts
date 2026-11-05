import { z } from "zod";
import { api } from "@/lib/api/handler";
import { evaluateForGoal, goalFields } from "@/lib/api/goals";

export const POST = api(
  { body: z.object({ ...goalFields, tasks: z.array(z.object({ description: z.string().trim().min(1).max(1000) }).strict()).min(1).max(50) }) },
  async ({ actor, body, params, rpc }) => {
    const evaluation = await evaluateForGoal(body);
    return rpc("create_goal", {
      p_actor: actor.id, p_report_id: params.id, p_goal_type: body.goalType, p_sub_kr_id: body.subKeyResultId ?? null,
      p_title: body.title, p_description: body.description ?? null, p_tasks: body.tasks, p_evaluation: evaluation,
      p_expected_version: body.expectedVersion ?? null, p_bu_goal_id: body.buGoalId ?? null,
    });
  },
);

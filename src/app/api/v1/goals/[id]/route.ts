import { z } from "zod";
import { api } from "@/lib/api/handler";
import { evaluateForGoal, goalFields } from "@/lib/api/goals";
import { userClient } from "@/lib/supabase/server";

export const PATCH = api({ body: z.object(goalFields) }, async ({ actor, body, params, rpc }) => {
  // the SMART check reads the goal only; its tasks are not part of it
  const evaluation = await evaluateForGoal(body);
  return rpc("update_goal", {
    p_actor: actor.id, p_goal_id: params.id, p_goal_type: body.goalType, p_sub_kr_id: body.subKeyResultId ?? null,
    p_title: body.title, p_description: body.description ?? null, p_evaluation: evaluation, p_expected_version: body.expectedVersion ?? null, p_bu_goal_id: body.buGoalId ?? null,
  });
});

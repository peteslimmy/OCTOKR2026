import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { evaluateForGoal, goalFields } from "@/lib/api/goals";
import { userClient } from "@/lib/supabase/server";

export const PATCH = api({ body: z.object(goalFields) }, async ({ actor, body, params, rpc }) => {
  const sb = await userClient();
  const { data: tasks, error } = await sb.from("tasks").select("description").eq("smart_goal_id", params.id).is("deleted_at", null);
  if (error) throw fail("VALIDATION_ERROR", 422, "Goal not found.");
  const evaluation = await evaluateForGoal({ ...body, taskDescriptions: (tasks ?? []).map((t) => t.description as string) });
  return rpc("update_goal", {
    p_actor: actor.id, p_goal_id: params.id, p_goal_type: body.goalType, p_sub_kr_id: body.subKeyResultId ?? null,
    p_title: body.title, p_description: body.description ?? null, p_evaluation: evaluation, p_expected_version: body.expectedVersion ?? null,
  });
});

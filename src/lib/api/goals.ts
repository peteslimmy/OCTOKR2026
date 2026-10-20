import "server-only";
import { z } from "zod";
import { evaluateSmart, type SmartEvaluation } from "@/lib/domain/smart";
import { userClient } from "@/lib/supabase/server";

export const goalFields = {
  goalType: z.enum(["KR_ALIGNED", "STRETCH"]),
  subKeyResultId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(4000).nullish(),
  expectedVersion: z.number().int().nullish(),
};

/** Server-side SMART evaluation: the client never supplies scores (ADR-035/039). */
export async function evaluateForGoal(input: {
  goalType: "KR_ALIGNED" | "STRETCH";
  subKeyResultId?: string | null;
  title: string;
  description?: string | null;
  taskDescriptions: string[];
}): Promise<SmartEvaluation> {
  let subKrTitle: string | null = null;
  if (input.goalType === "KR_ALIGNED" && input.subKeyResultId) {
    const sb = await userClient();
    const { data } = await sb.from("sub_key_results").select("title").eq("id", input.subKeyResultId).maybeSingle();
    subKrTitle = (data as { title: string } | null)?.title ?? null;
  }
  return evaluateSmart({
    title: input.title,
    description: input.description,
    taskDescriptions: input.taskDescriptions,
    subKrTitle,
    goalType: input.goalType,
  });
}

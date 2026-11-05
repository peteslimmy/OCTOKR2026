import type { z } from "zod";
import type { saveRecommendation } from "./schemas";

/** The arguments of save_eo_recommendation. The author is the signed-in person (actorId), never a value from the body. */
export function saveArgs(actorId: string, id: string | null, b: z.infer<typeof saveRecommendation>) {
  return {
    p_actor: actorId, p_id: id, p_expected_version: b.expectedVersion ?? null, p_title: b.title, p_detail: b.detail, p_background: b.background ?? null, p_reason: b.reason ?? null, p_outcome: b.expectedOutcome ?? null,
    p_direction: b.proposedDirection ?? null, p_priority: b.priority, p_category: b.category ?? null, p_module: b.module, p_subject_type: b.subjectType ?? null, p_subject_id: b.subjectId ?? null, p_quarter: b.quarterId ?? null,
    p_week: b.reportingWeekId ?? null, p_owner_role: b.recommendedOwnerRole ?? null, p_owner_user: b.recommendedOwnerUser ?? null, p_response_requested: b.responseRequested, p_response_due: b.responseDue ?? null,
    p_targets: b.targets, p_links: b.links, p_publish: b.publish, p_key: b.requestKey ?? null,
  };
}

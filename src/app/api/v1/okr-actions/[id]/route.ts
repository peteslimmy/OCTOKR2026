import { z } from "zod";
import { api } from "@/lib/api/handler";
import { ACTION_STATUSES } from "@/lib/session-notes/constants";
import { reason, requestKey, uuid, version } from "@/lib/session-notes/schemas";

/**
 * PATCH /api/v1/okr-actions/{id} — report progress and/or change status (the assignee, the BU Lead of the responsible unit, whoever set it, or an assigner).
 * Blocking needs the reason; completing needs the remarks (and the evidence, where the action asks for it). contextSessionId records which session the update was made in.
 */
export const PATCH = api({
  body: z.object({
    expectedVersion: version, status: z.enum(ACTION_STATUSES).optional(), progress: z.string().trim().max(5000).nullish(), blockedReason: z.string().trim().max(2000).nullish(),
    completionRemarks: z.string().trim().max(5000).nullish(), contextSessionId: uuid.nullish(), reason: reason.optional(), key: requestKey.optional(),
  }),
}, async ({ actor, body, params, rpc }) => rpc("update_okr_action", {
  p_actor: actor.id, p_action: params.id, p_expected_version: body.expectedVersion, p_status: body.status ?? null, p_progress: body.progress ?? null, p_blocked_reason: body.blockedReason ?? null,
  p_completion_remarks: body.completionRemarks ?? null, p_context_session: body.contextSessionId ?? null, p_reason: body.reason ?? null, p_key: body.key ?? null,
}));

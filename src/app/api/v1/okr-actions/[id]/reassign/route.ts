import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason, uuid, version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-actions/{id}/reassign { assigneeId, reason, expectedVersion? } — session_actions.assign; the reason and both people are kept in the history. */
export const POST = api({ body: z.object({ assigneeId: uuid, reason, expectedVersion: version.optional(), contextSessionId: uuid.nullish() }) },
  async ({ actor, body, params, rpc }) => rpc("reassign_okr_action", { p_actor: actor.id, p_action: params.id, p_new_assignee: body.assigneeId, p_reason: body.reason, p_expected_version: body.expectedVersion ?? null, p_context_session: body.contextSessionId ?? null }));

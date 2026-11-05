import { z } from "zod";
import { api } from "@/lib/api/handler";
import { isoDate, reason, uuid, version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-actions/{id}/extend { dueDate, reason, expectedVersion? } — a later deadline, only with a justification (session_actions.assign). */
export const POST = api({ body: z.object({ dueDate: isoDate, reason, expectedVersion: version.optional(), contextSessionId: uuid.nullish() }) },
  async ({ actor, body, params, rpc }) => rpc("extend_okr_action", { p_actor: actor.id, p_action: params.id, p_new_due: body.dueDate, p_reason: body.reason, p_expected_version: body.expectedVersion ?? null, p_context_session: body.contextSessionId ?? null }));

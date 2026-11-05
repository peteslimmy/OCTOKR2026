import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason, uuid } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-actions/{id}/escalate { reason } — flag an open action to the executives (session_actions.assign). Once per action. */
export const POST = api({ body: z.object({ reason, contextSessionId: uuid.nullish() }) },
  async ({ actor, body, params, rpc }) => rpc("escalate_okr_action", { p_actor: actor.id, p_action: params.id, p_reason: body.reason, p_context_session: body.contextSessionId ?? null }));

import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason, requestKey, version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-sessions/{id}/transition { to: IN_PROGRESS | COMPLETED | ARCHIVED | RESTORED, reason?, expectedVersion?, key } — lifecycle. Reopening and archiving give the reason; archiving reports the actions still open. */
export const POST = api({ body: z.object({ to: z.enum(["IN_PROGRESS", "COMPLETED", "ARCHIVED", "RESTORED"]), reason: reason.optional(), expectedVersion: version.optional(), key: requestKey }) },
  async ({ actor, body, params, rpc }) => rpc("transition_okr_session", { p_actor: actor.id, p_session: params.id, p_to: body.to, p_reason: body.reason ?? null, p_expected_version: body.expectedVersion ?? null, p_key: body.key }));

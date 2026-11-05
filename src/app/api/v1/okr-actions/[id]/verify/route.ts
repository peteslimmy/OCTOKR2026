import { z } from "zod";
import { api } from "@/lib/api/handler";
import { version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-actions/{id}/verify { outcome: VERIFIED | REJECTED, remarks?, expectedVersion? } — session_actions.verify; never the person who recorded the completion. */
export const POST = api({ body: z.object({ outcome: z.enum(["VERIFIED", "REJECTED"]), remarks: z.string().trim().max(3000).nullish(), expectedVersion: version.optional() }) },
  async ({ actor, body, params, rpc }) => rpc("verify_okr_action", { p_actor: actor.id, p_action: params.id, p_outcome: body.outcome, p_remarks: body.remarks ?? null, p_expected_version: body.expectedVersion ?? null }));

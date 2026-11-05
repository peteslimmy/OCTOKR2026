import { z } from "zod";
import { api } from "@/lib/api/handler";
import { version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-minutes/{id}/review { outcome: APPROVE | RETURN, remarks?, expectedVersion } — session_notes.finalise. */
export const POST = api({ body: z.object({ outcome: z.enum(["APPROVE", "RETURN"]), remarks: z.string().trim().max(3000).nullish(), expectedVersion: version }) },
  async ({ actor, body, params, rpc }) => rpc("review_okr_minutes", { p_actor: actor.id, p_minutes: params.id, p_outcome: body.outcome, p_remarks: body.remarks ?? null, p_expected_version: body.expectedVersion }));

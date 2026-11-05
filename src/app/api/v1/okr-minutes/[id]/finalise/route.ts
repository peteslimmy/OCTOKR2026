import { z } from "zod";
import { api } from "@/lib/api/handler";
import { requestKey, version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-minutes/{id}/finalise { expectedVersion, key } — freeze the reviewed minutes with a snapshot and a content hash (session_notes.finalise; the session must be completed). Later changes need a new revision. */
export const POST = api({ stepUp: true, body: z.object({ expectedVersion: version, key: requestKey }) },
  async ({ actor, body, params, rpc }) => rpc("finalise_okr_minutes", { p_actor: actor.id, p_minutes: params.id, p_expected_version: body.expectedVersion, p_key: body.key }));

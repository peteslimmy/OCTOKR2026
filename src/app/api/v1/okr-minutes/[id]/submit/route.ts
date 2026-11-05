import { z } from "zod";
import { api } from "@/lib/api/handler";
import { version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-minutes/{id}/submit { expectedVersion } — send the draft for review; the people who can finalise are notified. */
export const POST = api({ body: z.object({ expectedVersion: version }) },
  async ({ actor, body, params, rpc }) => rpc("submit_okr_minutes", { p_actor: actor.id, p_minutes: params.id, p_expected_version: body.expectedVersion }));

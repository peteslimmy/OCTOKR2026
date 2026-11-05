import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-notes/{id}/archive { restore?, reason } — a note is archived (hidden from the minutes, kept with its versions), never deleted; restore reverses it. */
export const POST = api({ body: z.object({ restore: z.boolean().default(false), reason }) },
  async ({ actor, body, params, rpc }) => rpc("archive_okr_note", { p_actor: actor.id, p_note: params.id, p_restore: body.restore, p_reason: body.reason }));

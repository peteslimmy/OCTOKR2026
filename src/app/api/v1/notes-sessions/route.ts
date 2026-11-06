import { z } from "zod";
import { api } from "@/lib/api/handler";
import { uuid } from "@/lib/session-notes/schemas";

/** POST /api/v1/notes-sessions — open (or find) the one organisation-wide minutes page of a weekly session: { session_id, note_id }. Repeatable. */
export const POST = api({ body: z.object({ weekId: uuid }) },
  async ({ actor, body, rpc }) => rpc("get_or_create_notes_session", { p_actor: actor.id, p_week: body.weekId }));

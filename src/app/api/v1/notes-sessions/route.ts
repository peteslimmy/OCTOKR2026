import { z } from "zod";
import { api } from "@/lib/api/handler";
import { uuid } from "@/lib/session-notes/schemas";

/**
 * POST /api/v1/notes-sessions — open (or find) a notes page of a weekly session: { session_id, note_id }. Repeatable: it never makes a second page.
 *   { weekId }        the OFFICIAL Session Notes of the week, one organisation-wide page that everyone may read (ADR-126). Only a person who can write notes AND sees every
 *                     unit (the Presenter, the Note Taker, the Super Admin) may open it; anybody else is refused in the database.
 *   { weekId, buId }  a business unit's or department's OWN notes for the week (ADR-133, Take Notes). Only people of that unit, or those who write notes for every unit, may
 *                     open it; the notes stay visible to that unit and to the roles that see every unit. Another unit is refused in the database (BU_SCOPE_DENIED).
 */
export const POST = api({ body: z.object({ weekId: uuid, buId: uuid.optional() }) },
  async ({ actor, body, rpc }) => body.buId
    ? rpc("get_or_create_notes_session", { p_actor: actor.id, p_week: body.weekId, p_bu: body.buId })
    : rpc("get_or_create_notes_session", { p_actor: actor.id, p_week: body.weekId }));

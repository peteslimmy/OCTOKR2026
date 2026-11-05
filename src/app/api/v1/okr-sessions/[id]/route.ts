import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { getWorkspace } from "@/lib/data/session-notes";
import { isoDate, optText, reason, uuid, version } from "@/lib/session-notes/schemas";

/** GET /api/v1/okr-sessions/{id} — the whole workspace (notes, decisions, actions, risks, minutes, attachments, timeline) as the caller may see it. 404 when it is not visible to them. */
export const GET = api({}, async ({ params }) => {
  const ws = await getWorkspace(params.id);
  if (!ws) throw fail("NOT_FOUND", 404, "That record was not found.");
  return ws;
});

/** PATCH /api/v1/okr-sessions/{id} — change the session's details (the form's full set). Needs the version you opened; a completed session needs a reason. */
export const PATCH = api({
  body: z.object({
    expectedVersion: version, title: z.string().trim().min(1).max(200).optional(), typeId: uuid.optional(), date: isoDate.optional(), startsAt: z.string().datetime({ offset: true }).nullish(),
    endsAt: z.string().datetime({ offset: true }).nullish(), facilitatorId: uuid.optional(), description: optText(4000), agenda: optText(20000), attendanceSessionId: uuid.nullish(), reason: reason.optional(),
  }),
}, async ({ actor, body, params, rpc }) => rpc("update_okr_session", {
  p_actor: actor.id, p_session: params.id, p_expected_version: body.expectedVersion, p_title: body.title ?? null, p_type: body.typeId ?? null, p_date: body.date ?? null,
  p_starts: body.startsAt ?? null, p_ends: body.endsAt ?? null, p_facilitator: body.facilitatorId ?? null, p_description: body.description ?? null, p_agenda: body.agenda ?? null,
  p_governance: body.attendanceSessionId ?? null, p_reason: body.reason ?? null,
}));

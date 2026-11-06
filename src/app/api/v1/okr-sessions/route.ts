import { z } from "zod";
import { api } from "@/lib/api/handler";
import { adminClient } from "@/lib/supabase/admin";
import { searchSessions } from "@/lib/data/session-notes";
import { isoDate, optText, requestKey, uuid } from "@/lib/session-notes/schemas";

/** GET /api/v1/okr-sessions?q=&bu=&quarter=&week=&from=&to=&type=&facilitator=&participant=&status=&noteCategory=&decisionStatus=&actionStatus=&linkType=&linkId=&limit=&offset= — the session library (row-level security decides what is returned). */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const g = (k: string) => sp.get(k) || undefined;
  return searchSessions({
    q: g("q"), bu: g("bu"), quarter: g("quarter"), week: g("week"), from: g("from"), to: g("to"), type: g("type"), facilitator: g("facilitator"), participant: g("participant"),
    status: g("status"), noteCategory: g("noteCategory"), decisionStatus: g("decisionStatus"), actionStatus: g("actionStatus"), linkType: g("linkType"), linkId: g("linkId"),
    limit: Math.min(Number(g("limit") ?? 25) || 25, 100), offset: Math.max(Number(g("offset") ?? 0) || 0, 0),
  });
});

/** POST /api/v1/okr-sessions — create a session (session_notes.create; BU scope enforced in the database). A repeated key returns the first answer. */
export const POST = api({
  body: z.object({
    title: z.string().trim().min(1).max(200), typeId: uuid.nullish(), date: isoDate, weekId: uuid.nullish(), buId: uuid.nullish(), attendanceSessionId: uuid.nullish(),
    startsAt: z.string().datetime({ offset: true }).nullish(), endsAt: z.string().datetime({ offset: true }).nullish(), facilitatorId: uuid.nullish(),
    description: optText(4000), agenda: optText(20000),
    participants: z.array(z.object({ userId: uuid, role: z.enum(["PRESENTER", "BU_LEAD", "ATTENDEE", "OBSERVER"]).default("ATTENDEE") })).max(60).default([]),
    key: requestKey,
  }),
}, async ({ actor, body, rpc }) => rpc("create_okr_session", {
  // sessions no longer have a type to choose; the standard one is used (the database still requires a type)
  p_actor: actor.id, p_title: body.title, p_type: body.typeId ?? (await adminClient().from("okr_session_types").select("id").eq("code", "WEEKLY_OKR_REVIEW").single()).data?.id, p_date: body.date, p_week: body.weekId ?? null, p_bu: body.buId ?? null, p_governance: body.attendanceSessionId ?? null,
  p_starts: body.startsAt ?? null, p_ends: body.endsAt ?? null, p_facilitator: body.facilitatorId ?? null, p_description: body.description ?? null, p_agenda: body.agenda ?? null,
  p_participants: body.participants.map((p) => ({ user_id: p.userId, role: p.role })), p_key: body.key,
}));

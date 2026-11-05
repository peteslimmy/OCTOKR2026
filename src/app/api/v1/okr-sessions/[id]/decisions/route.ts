import { z } from "zod";
import { api } from "@/lib/api/handler";
import { isoDate, links, optText, requestKey, uuid } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-sessions/{id}/decisions — record a PROPOSED decision (session_decisions.create). It is formal only after /okr-decisions/{id}/decide approves it. */
export const POST = api({
  body: z.object({
    title: z.string().trim().min(1).max(300), description: z.string().trim().min(1).max(10000), background: optText(10000), justification: optText(10000), decisionDate: isoDate.nullish(),
    affectedBuId: uuid.nullish(), involvedUserIds: z.array(uuid).max(60).default([]), expectedOutcome: optText(5000), followUp: optText(5000), sourceNoteId: uuid.nullish(),
    authorityNote: optText(300), links: links.default([]), clientKey: requestKey,
  }),
}, async ({ actor, body, params, rpc }) => rpc("create_okr_decision", {
  p_actor: actor.id, p_session: params.id, p_title: body.title, p_description: body.description, p_background: body.background ?? null, p_justification: body.justification ?? null,
  p_date: body.decisionDate ?? null, p_affected_bu: body.affectedBuId ?? null, p_involved: body.involvedUserIds, p_expected_outcome: body.expectedOutcome ?? null, p_follow_up: body.followUp ?? null,
  p_source_note: body.sourceNoteId ?? null, p_authority_note: body.authorityNote ?? null, p_links: body.links, p_client_key: body.clientKey,
}));

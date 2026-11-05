import { z } from "zod";
import { api } from "@/lib/api/handler";
import { isoDate, optText, reason, uuid, version } from "@/lib/session-notes/schemas";

/** PATCH /api/v1/okr-decisions/{id} — amend a PROPOSED decision (the earlier wording is kept in the session timeline). An approved decision is superseded, not edited. */
export const PATCH = api({
  body: z.object({
    expectedVersion: version, title: z.string().trim().min(1).max(300).optional(), description: z.string().trim().min(1).max(10000).optional(), background: optText(10000), justification: optText(10000),
    decisionDate: isoDate.optional(), involvedUserIds: z.array(uuid).max(60).optional(), expectedOutcome: optText(5000), followUp: optText(5000), authorityNote: optText(300), reason,
  }),
}, async ({ actor, body, params, rpc }) => rpc("update_okr_decision", {
  p_actor: actor.id, p_decision: params.id, p_expected_version: body.expectedVersion, p_title: body.title ?? null, p_description: body.description ?? null, p_background: body.background ?? null,
  p_justification: body.justification ?? null, p_date: body.decisionDate ?? null, p_involved: body.involvedUserIds ?? null, p_expected_outcome: body.expectedOutcome ?? null,
  p_follow_up: body.followUp ?? null, p_authority_note: body.authorityNote ?? null, p_reason: body.reason,
}));

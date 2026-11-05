import { z } from "zod";
import { api } from "@/lib/api/handler";
import { optText, reason, requestKey } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-decisions/{id}/supersede — replace an APPROVED decision with a new approved one (the correction path); the old one is kept, marked SUPERSEDED, and links forward. */
export const POST = api({
  stepUp: true,
  body: z.object({ title: optText(300), description: optText(10000), background: optText(10000), justification: optText(10000), expectedOutcome: optText(5000), followUp: optText(5000), reason, key: requestKey }),
}, async ({ actor, body, params, rpc }) => rpc("supersede_okr_decision", {
  p_actor: actor.id, p_old: params.id, p_title: body.title ?? null, p_description: body.description ?? null, p_background: body.background ?? null, p_justification: body.justification ?? null,
  p_expected_outcome: body.expectedOutcome ?? null, p_follow_up: body.followUp ?? null, p_reason: body.reason, p_key: body.key,
}));

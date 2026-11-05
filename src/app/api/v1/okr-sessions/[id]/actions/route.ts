import { z } from "zod";
import { api } from "@/lib/api/handler";
import { isoDate, links, requestKey, uuid } from "@/lib/session-notes/schemas";
import { PRIORITIES } from "@/lib/session-notes/constants";

/** POST /api/v1/okr-sessions/{id}/actions — create an action item (session_actions.create) and tell the assignee. It never touches an OKR task or goal. */
export const POST = api({
  body: z.object({
    description: z.string().trim().min(1).max(5000), assigneeId: uuid, buId: uuid.nullish(), priority: z.enum(PRIORITIES).default("MEDIUM"), dueDate: isoDate, sourceNoteId: uuid.nullish(),
    sourceDecisionId: uuid.nullish(), requiresVerification: z.boolean().default(false), evidenceRequired: z.boolean().default(false), links: links.default([]), clientKey: requestKey,
  }),
}, async ({ actor, body, params, rpc }) => rpc("create_okr_action", {
  p_actor: actor.id, p_session: params.id, p_description: body.description, p_assignee: body.assigneeId, p_bu: body.buId ?? null, p_priority: body.priority, p_due: body.dueDate,
  p_source_note: body.sourceNoteId ?? null, p_source_decision: body.sourceDecisionId ?? null, p_requires_verification: body.requiresVerification, p_evidence_required: body.evidenceRequired,
  p_links: body.links, p_client_key: body.clientKey,
}));

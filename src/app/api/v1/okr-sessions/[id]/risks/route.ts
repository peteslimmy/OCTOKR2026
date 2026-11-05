import { z } from "zod";
import { api } from "@/lib/api/handler";
import { isoDate, links, optText, requestKey, uuid } from "@/lib/session-notes/schemas";
import { RISK_CATEGORIES, RISK_KINDS, SEVERITIES } from "@/lib/session-notes/constants";

/** POST /api/v1/okr-sessions/{id}/risks — record a formal risk, blocker or issue (session_risks.manage). An observation stays a note until someone with that authority records it here. */
export const POST = api({
  body: z.object({
    kind: z.enum(RISK_KINDS).default("RISK"), title: z.string().trim().min(1).max(300), description: z.string().trim().min(1).max(10000), buId: uuid.nullish(), category: z.enum(RISK_CATEGORIES).default("OPERATIONAL"),
    severity: z.enum(SEVERITIES).default("MEDIUM"), businessImpact: optText(5000), rootCause: optText(5000), mitigation: optText(5000), ownerId: uuid.nullish(), targetDate: isoDate.nullish(),
    sourceNoteId: uuid.nullish(), links: links.default([]), clientKey: requestKey,
  }),
}, async ({ actor, body, params, rpc }) => rpc("create_okr_risk", {
  p_actor: actor.id, p_session: params.id, p_kind: body.kind, p_title: body.title, p_description: body.description, p_bu: body.buId ?? null, p_category: body.category, p_severity: body.severity,
  p_impact: body.businessImpact ?? null, p_root_cause: body.rootCause ?? null, p_mitigation: body.mitigation ?? null, p_owner: body.ownerId ?? null, p_target: body.targetDate ?? null,
  p_source_note: body.sourceNoteId ?? null, p_links: body.links, p_client_key: body.clientKey,
}));

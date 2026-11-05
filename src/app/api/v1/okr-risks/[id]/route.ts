import { z } from "zod";
import { api } from "@/lib/api/handler";
import { isoDate, optText, uuid, version } from "@/lib/session-notes/schemas";
import { RISK_STATUSES, SEVERITIES } from "@/lib/session-notes/constants";

/** PATCH /api/v1/okr-risks/{id} — update a risk (session_risks.manage); every earlier state is kept in the timeline. Resolving needs a resolution note; reopening needs a reason. */
export const PATCH = api({
  body: z.object({
    expectedVersion: version, status: z.enum(RISK_STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), description: z.string().trim().min(1).max(10000).optional(), businessImpact: optText(5000),
    rootCause: optText(5000), mitigation: optText(5000), ownerId: uuid.nullish(), targetDate: isoDate.nullish(), resolutionNote: optText(5000), contextSessionId: uuid.nullish(), reason: optText(2000),
  }),
}, async ({ actor, body, params, rpc }) => rpc("update_okr_risk", {
  p_actor: actor.id, p_risk: params.id, p_expected_version: body.expectedVersion, p_status: body.status ?? null, p_severity: body.severity ?? null, p_description: body.description ?? null,
  p_impact: body.businessImpact ?? null, p_root_cause: body.rootCause ?? null, p_mitigation: body.mitigation ?? null, p_owner: body.ownerId ?? null, p_target: body.targetDate ?? null,
  p_resolution_note: body.resolutionNote ?? null, p_context_session: body.contextSessionId ?? null, p_reason: body.reason ?? null,
}));

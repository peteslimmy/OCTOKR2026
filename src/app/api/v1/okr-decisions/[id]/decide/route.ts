import { z } from "zod";
import { api } from "@/lib/api/handler";
import { optText, reason, requestKey, version } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-decisions/{id}/decide { outcome: APPROVE | REJECT | WITHDRAW, reason?, authorityNote?, expectedVersion?, key } — approving or rejecting needs session_decisions.approve. */
export const POST = api({ stepUp: true, body: z.object({ outcome: z.enum(["APPROVE", "REJECT", "WITHDRAW"]), reason: reason.optional(), authorityNote: optText(300), expectedVersion: version.optional(), key: requestKey }) },
  async ({ actor, body, params, rpc }) => rpc("decide_okr_decision", { p_actor: actor.id, p_decision: params.id, p_outcome: body.outcome, p_reason: body.reason ?? null, p_authority_note: body.authorityNote ?? null, p_expected_version: body.expectedVersion ?? null, p_key: body.key }));

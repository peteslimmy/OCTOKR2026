import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ proposedStatus: z.string().trim().min(1).max(40), reason: z.string().trim().max(2000), evidenceRefs: z.array(z.object({ ref: z.string().trim().min(1).max(500), note: z.string().trim().max(500).optional() }).strict()).max(10).default([]), idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, params, rpc }) =>
  rpc("submit_attendance_amendment", { p_actor: actor.id, p_record_id: params.id, p_proposed: body.proposedStatus, p_reason: body.reason, p_evidence: body.evidenceRefs, p_idempotency_key: body.idempotencyKey }));

import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/disbursement-requests/{id}/resubmit — the requester raises a revised request after a rejection. The rejected one stays as it was. */
export const POST = api(
  { body: z.object({ amount: z.number().positive().max(1_000_000_000), purpose: z.string().trim().min(1).max(500), justification: z.string().trim().min(1).max(2000), note: z.string().trim().min(1).max(1000), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) =>
    rpc("resubmit_disbursement_request", { p_actor: actor.id, p_original: params.id, p_amount: body.amount, p_purpose: body.purpose, p_justification: body.justification, p_note: body.note, p_idempotency_key: body.idempotencyKey }));

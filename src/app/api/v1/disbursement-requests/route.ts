import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listDisbursements } from "@/lib/data/governance";

export const POST = api({ body: z.object({ amount: z.number().positive().max(1_000_000_000), purpose: z.string().trim().min(1).max(500), justification: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, rpc }) =>
  rpc("create_disbursement_request", { p_actor: actor.id, p_amount: body.amount, p_purpose: body.purpose, p_justification: body.justification, p_idempotency_key: body.idempotencyKey }));

export const GET = api({}, async () => listDisbursements());

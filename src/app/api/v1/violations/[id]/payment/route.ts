import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ method: z.enum(["PAYMENT", "SALARY_DEDUCTION"]), reference: z.string().trim().min(1).max(500), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), idempotencyKey: z.string().min(8).max(100) }) }, async ({ actor, body, params, rpc }) =>
  rpc("record_violation_payment", { p_actor: actor.id, p_violation: params.id, p_method: body.method, p_reference: body.reference, p_paid_at: body.paidAt, p_idempotency_key: body.idempotencyKey }));

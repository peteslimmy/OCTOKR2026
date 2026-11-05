import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/payment-methods — adds a payment method (no id) or changes one (id). The code is set once. */
export const POST = api(
  { body: z.object({ id: z.string().uuid().optional(), code: z.string().trim().max(3).optional(), name: z.string().trim().min(1).max(80), isDeduction: z.boolean(), active: z.boolean().optional() }) },
  async ({ actor, body, rpc }) =>
    rpc("save_payment_method", { p_actor: actor.id, p_id: body.id ?? null, p_code: body.code ?? null, p_name: body.name, p_is_deduction: body.isDeduction, p_active: body.active ?? null }));

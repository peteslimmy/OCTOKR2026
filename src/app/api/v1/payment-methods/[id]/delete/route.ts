import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * POST /api/v1/payment-methods/{id}/delete — deletes a payment method that has never been used (Super Admin, Admin, HR: `violation.edit`).
 * A method that has been used, or the last one in use, is refused with the reason; such a method is switched to "not in use" through the edit route instead.
 */
export const POST = api({ body: z.object({}) }, async ({ actor, params, rpc }) =>
  rpc("delete_payment_method", { p_actor: actor.id, p_id: params.id }));

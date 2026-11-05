import { z } from "zod";
import { api } from "@/lib/api/handler";

/**
 * Rolls back an employee or Business Unit import inside the rollback window (ADR-087). Super Admin only (the database checks it, whatever the screen shows),
 * with a fresh authenticator code, the typed confirmation and a reason. Nothing is deleted: created rows are deactivated and changed rows restored.
 */
export const POST = api(
  { stepUp: true, body: z.object({ reason: z.string().min(10).max(2000), confirm: z.string().max(40), idempotencyKey: z.string().min(8).max(100) }) },
  async ({ actor, body, params, rpc }) => rpc("void_import", { p_actor: actor.id, p_batch: params.id, p_reason: body.reason, p_confirm: body.confirm, p_idempotency_key: body.idempotencyKey }),
);

import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";

/** Rolls back a strategy import inside the rollback window (ADR-088). Super Admin only (checked again in the database), fresh authenticator code, typed confirmation. */
export const POST = api({ stepUp: true, body: z.object({ reason: z.string().min(10).max(2000), confirm: z.string().max(40) }) }, async ({ actor, body, params, rpc }) => {
  requirePerm(actor, "strategy.import");
  return rpc("strategy_void", { p_actor: actor.id, p_batch: params.id, p_reason: body.reason, p_confirm: body.confirm });
});

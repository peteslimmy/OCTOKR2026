import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";

/** Rolls back a committed historical import inside the rollback window (ADR-088): its reports, goals, tasks, weeks, scores and placeholder strategy are removed and what it changed is restored. */
export const POST = api({ stepUp: true, body: z.object({ reason: z.string().min(10).max(2000), confirm: z.string().max(40) }) }, async ({ actor, body, params, rpc }) => {
  requirePerm(actor, "history.import");
  return rpc("history_void", { p_actor: actor.id, p_batch: params.id, p_reason: body.reason, p_confirm: body.confirm });
});

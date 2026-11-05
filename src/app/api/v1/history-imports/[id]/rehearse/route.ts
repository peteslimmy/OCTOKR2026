import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";
import { explaining } from "@/lib/import/history-route";

/** Runs the whole import for real inside a transaction that is always undone, and returns the recomputed scores. Nothing is saved. A refusal says what happened and what to do. */
export const POST = api({ body: z.object({ fillGaps: z.boolean() }) }, async ({ actor, params, body, rpc }) => {
  requirePerm(actor, "history.import");
  return explaining("The rehearsal", () => rpc("history_rehearse", { p_actor: actor.id, p_batch: params.id, p_fill_gaps: body.fillGaps }));
});

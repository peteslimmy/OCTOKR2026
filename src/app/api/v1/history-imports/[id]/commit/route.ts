import { z } from "zod";
import { api, requirePerm } from "@/lib/api/handler";
import { explaining } from "@/lib/import/history-route";

/** Writes the history in one transaction. Super Admin only, no second approver (owner decision), but a fresh authenticator code and the typed confirmation are required. A refusal says what happened and what to do; nothing is written. */
export const POST = api({ stepUp: true, body: z.object({ fillGaps: z.boolean(), confirm: z.string().max(40) }) }, async ({ actor, params, body, rpc }) => {
  requirePerm(actor, "history.import");
  return explaining("The import", () => rpc("history_commit", { p_actor: actor.id, p_batch: params.id, p_fill_gaps: body.fillGaps, p_confirm: body.confirm }));
});

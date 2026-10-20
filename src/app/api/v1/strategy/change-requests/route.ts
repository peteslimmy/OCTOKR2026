import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listStrategyChanges } from "@/lib/data";
import { fail } from "@/lib/api/handler";

const uuid = z.string().uuid();

/** Ask for a change to the strategy of an ACTIVE quarter (edit, add, or retire). A different person must approve it. */
export const POST = api({
  stepUp: true,
  body: z.object({
    changeType: z.enum(["EDIT", "RETIRE", "ADD"]), itemType: z.enum(["OBJECTIVE", "KR", "SUBKR"]), itemId: uuid.nullish(), parentId: uuid.nullish(),
    title: z.string().trim().max(500).nullish(), description: z.string().trim().max(4000).nullish(), reason: z.string().trim().min(1).max(2000), idempotencyKey: z.string().min(8).max(100),
  }),
}, async ({ actor, body, rpc }) => rpc("request_strategy_change", {
  p_actor: actor.id, p_change: body.changeType, p_item_type: body.itemType, p_item_id: body.itemId ?? null, p_parent_id: body.parentId ?? null,
  p_title: body.title ?? null, p_description: body.description ?? null, p_reason: body.reason, p_idempotency_key: body.idempotencyKey,
}));

export const GET = api({}, async ({ req }) => {
  const q = new URL(req.url).searchParams.get("quarterId");
  if (!q || !uuid.safeParse(q).success) throw fail("VALIDATION_ERROR", 422, "Choose a quarter.");
  return listStrategyChanges(q);
});

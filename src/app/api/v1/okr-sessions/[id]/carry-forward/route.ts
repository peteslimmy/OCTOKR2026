import { z } from "zod";
import { api } from "@/lib/api/handler";
import { requestKey, uuid } from "@/lib/session-notes/schemas";
import { CARRY_OUTCOMES } from "@/lib/session-notes/constants";

/** POST /api/v1/okr-sessions/{id}/carry-forward { items: [{ type, id, outcome, remarks? }], key } — record that open items were reviewed in this session. The same action is reviewed, never copied. */
export const POST = api({
  body: z.object({
    items: z.array(z.object({ type: z.enum(["ACTION", "RISK"]), id: uuid, outcome: z.enum(CARRY_OUTCOMES.map((c) => c.code) as [string, ...string[]]).default("STILL_OPEN"), remarks: z.string().trim().max(3000).nullish() })).min(1).max(100),
    key: requestKey,
  }),
}, async ({ actor, body, params, rpc }) => rpc("carry_forward_okr_items", { p_actor: actor.id, p_session: params.id, p_items: body.items.map((i) => ({ type: i.type, id: i.id, outcome: i.outcome, remarks: i.remarks ?? null })), p_key: body.key }));

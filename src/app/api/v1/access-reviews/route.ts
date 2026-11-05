import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Open an access review now: it lists every active person with what they hold, ready for a decision on each. */
export const POST = api({ stepUp: true, body: z.object({ note: z.string().trim().max(2000).optional() }) }, async ({ actor, body, rpc }) =>
  rpc("open_access_review", { p_actor: actor.id, p_note: body.note ?? null }));

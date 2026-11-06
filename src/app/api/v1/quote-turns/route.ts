import { z } from "zod";
import { api } from "@/lib/api/handler";
import { getQuoteRota, getMyQuoteTurns } from "@/lib/data/quote-rota";
import { uuid } from "@/lib/session-notes/schemas";

/** GET /api/v1/quote-turns?scope=rota|mine — HR's rota of coming weeks, or the caller's unit's turns (row-level security decides what is returned). */
export const GET = api({}, async ({ req }) => new URL(req.url).searchParams.get("scope") === "rota" ? getQuoteRota() : getMyQuoteTurns());

/** POST /api/v1/quote-turns — choose which business unit gives the quote in a week (quote.assign). Its leads are notified. */
export const POST = api({ body: z.object({ weekId: uuid, buId: uuid }) },
  async ({ actor, body, rpc }) => rpc("assign_quote_turn", { p_actor: actor.id, p_week: body.weekId, p_bu: body.buId }));

import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason, uuid } from "@/lib/session-notes/schemas";

/** PUT /api/v1/quote-turns/{id} — the unit (or the Super Admin for it) enters or changes the quote and who said it, until it has been presented (quote.submit). No approval step. */
export const PUT = api({ body: z.object({ quote: z.string().trim().min(1).max(1000), speakerId: uuid }) },
  async ({ actor, body, params, rpc }) => rpc("submit_quote_turn", { p_actor: actor.id, p_turn: params.id, p_quote: body.quote, p_speaker: body.speakerId }));

/** POST /api/v1/quote-turns/{id} {action:"present"} — the Presenter marks the quote as shown (presentation.view). */
export const POST = api({ body: z.object({ action: z.literal("present") }) }, async ({ actor, params, rpc }) => {
  await rpc("mark_quote_turn_presented", { p_actor: actor.id, p_turn: params.id });
  return { id: params.id, status: "PRESENTED" };
});

/** DELETE /api/v1/quote-turns/{id} — HR withdraws a choice that has not been presented (quote.assign); a reason is required. */
export const DELETE = api({ body: z.object({ reason }) }, async ({ actor, body, params, rpc }) => {
  await rpc("cancel_quote_turn", { p_actor: actor.id, p_turn: params.id, p_reason: body.reason });
  return { id: params.id, status: "CANCELLED" };
});

import { api } from "@/lib/api/handler";

/** POST /api/v1/quotes/{id}/archive — the database checks the permission, the current status and the segregation of duties. */
export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("archive_quote", { p_actor: actor.id, p_quote_id: params.id }));

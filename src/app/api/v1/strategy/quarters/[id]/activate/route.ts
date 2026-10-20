import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("activate_quarter", { p_actor: actor.id, p_quarter_id: params.id }));

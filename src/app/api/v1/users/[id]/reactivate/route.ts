import { api } from "@/lib/api/handler";

export const POST = api({ stepUp: true }, async ({ actor, params, rpc }) =>
  rpc("set_user_status", { p_actor: actor.id, p_user: params.id, p_status: 'ACTIVE' }));

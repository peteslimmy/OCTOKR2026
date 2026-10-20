import { api } from "@/lib/api/handler";

/** Only the person who asked can withdraw a request that is still waiting. */
export const POST = api({}, async ({ actor, params, rpc }) => rpc("withdraw_config_change", { p_actor: actor.id, p_request_id: params.id }));

import { api } from "@/lib/api/handler";

/** The person who asked withdraws a pending change request. */
export const POST = api({}, async ({ actor, params, rpc }) => rpc("withdraw_bu_goal_change", { p_actor: actor.id, p_request: params.id }));

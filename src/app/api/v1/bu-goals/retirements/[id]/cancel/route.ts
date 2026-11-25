import { api } from "@/lib/api/handler";

/** The lead who asked cancels a pending retirement request; the goal stays as it is. */
export const POST = api({}, async ({ actor, params, rpc }) => rpc("cancel_bu_goal_retirement", { p_actor: actor.id, p_request: params.id }));

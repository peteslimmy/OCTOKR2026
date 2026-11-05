import { api } from "@/lib/api/handler";

/** POST /api/v1/disbursement-requests/{id}/withdraw — the requester withdraws a request that is still waiting for a decision. */
export const POST = api({}, async ({ actor, params, rpc }) => rpc("withdraw_disbursement_request", { p_actor: actor.id, p_request: params.id }));

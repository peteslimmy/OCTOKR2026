import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("start_disbursement_review", { p_actor: actor.id, p_request_id: params.id }));

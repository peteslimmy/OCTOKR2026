import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/plans/{id}/submit — sends a drafted plan for approval. A different person with the approval permission decides it. */
export const POST = api({}, async ({ actor, params, rpc }) => ({ approvalId: await rpc<string>("ai_submit_plan", { p_actor: actor.id, p_plan: params.id }) }));

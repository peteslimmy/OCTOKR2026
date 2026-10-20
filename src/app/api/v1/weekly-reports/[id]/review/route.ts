import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("review_weekly_report", { p_actor: actor.id, p_report_id: params.id }));

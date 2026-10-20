import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("acquire_edit_lease", { p_actor: actor.id, p_report_id: params.id }));

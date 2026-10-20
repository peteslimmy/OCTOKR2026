import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("acquire_edit_lease", { p_actor: actor.id, p_report_id: params.id }));

export const DELETE = api({}, async ({ actor, params, rpc }) =>
  rpc("release_edit_lease", { p_actor: actor.id, p_report_id: params.id }));

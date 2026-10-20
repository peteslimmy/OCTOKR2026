import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, params, rpc }) =>
  rpc("create_attendance_roster", { p_actor: actor.id, p_session_id: params.id }));

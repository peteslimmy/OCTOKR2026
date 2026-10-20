import { z } from "zod";
import { api } from "@/lib/api/handler";

export const POST = api({ body: z.object({ confirm: z.literal(true) }) }, async ({ actor, body, params, rpc }) =>
  rpc("finalize_attendance_roster", { p_actor: actor.id, p_session_id: params.id, p_confirm: body.confirm }));

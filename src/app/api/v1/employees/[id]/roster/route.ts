import { z } from "zod";
import { api } from "@/lib/api/handler";

/** Puts a person on or off the attendance roster (they keep their sign-in either way). Needs users.manage; audited. */
export const PATCH = api({ body: z.object({ onRoster: z.boolean() }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_employee_roster", { p_actor: actor.id, p_id: params.id, p_on: body.onRoster }));

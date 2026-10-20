import { api } from "@/lib/api/handler";
import { z } from "zod";

// Roles are data (ADR-069): the shape is checked here, whether the role exists and may be granted is checked by the database.
const ROLE_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/);

export const PUT = api(
  { stepUp: true, body: z.object({ roles: z.array(ROLE_CODE).min(1).max(20) }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_user_roles", { p_actor: actor.id, p_user: params.id, p_roles: body.roles }));

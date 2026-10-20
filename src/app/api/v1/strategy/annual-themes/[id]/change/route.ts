import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ theme: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(2000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("change_annual_theme", { p_actor: actor.id, p_theme_id: params.id, p_new_theme: body.theme, p_reason: body.reason }));

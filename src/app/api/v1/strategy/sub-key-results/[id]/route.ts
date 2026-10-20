import { api } from "@/lib/api/handler";
import { z } from "zod";

export const PATCH = api({ body: z.object({ title: z.string().trim().min(1).max(500), description: z.string().trim().max(4000).nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("update_sub_key_result", { p_actor: actor.id, p_id: params.id, p_title: body.title, p_description: body.description ?? null }));

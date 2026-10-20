import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ title: z.string().trim().min(1).max(500), description: z.string().trim().max(4000).nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("create_key_result", { p_actor: actor.id, p_objective_id: params.id, p_title: body.title, p_description: body.description ?? null }));

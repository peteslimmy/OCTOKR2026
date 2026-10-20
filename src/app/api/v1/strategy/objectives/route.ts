import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ quarterId: z.string().uuid(), title: z.string().trim().min(1).max(500), description: z.string().trim().max(4000).nullish() }) }, async ({ actor, body, rpc }) =>
  rpc("create_objective", { p_actor: actor.id, p_quarter_id: body.quarterId, p_title: body.title, p_description: body.description ?? null }));

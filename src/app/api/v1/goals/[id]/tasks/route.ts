import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ description: z.string().trim().min(1).max(500), expectedVersion: z.number().int().nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("create_task", { p_actor: actor.id, p_goal_id: params.id, p_description: body.description, p_expected_version: body.expectedVersion ?? null }));

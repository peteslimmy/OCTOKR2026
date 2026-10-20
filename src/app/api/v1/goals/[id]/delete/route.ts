import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ expectedVersion: z.number().int().nullish() }) }, async ({ actor, body, params, rpc }) =>
  rpc("delete_goal", { p_actor: actor.id, p_goal_id: params.id, p_expected_version: body.expectedVersion ?? null }));

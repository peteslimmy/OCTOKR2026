import { api } from "@/lib/api/handler";
import { z } from "zod";

export const POST = api({ body: z.object({ status: z.enum(["DONE", "NOT_DONE"]) }) }, async ({ actor, body, params, rpc }) =>
  rpc("execute_task", { p_actor: actor.id, p_task_id: params.id, p_status: body.status }));

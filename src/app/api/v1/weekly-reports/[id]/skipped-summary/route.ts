import { api } from "@/lib/api/handler";
import { z } from "zod";

export const PUT = api({ body: z.object({ comment: z.string().trim().max(4000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_skipped_summary", { p_actor: actor.id, p_report_id: params.id, p_comment: body.comment }));

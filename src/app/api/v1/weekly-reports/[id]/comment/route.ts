import { z } from "zod";
import { api } from "@/lib/api/handler";

/** The unit's comment on its weekly report: plain text in the small formatting subset (lib/rich-text), up to 4000 characters. */
export const PUT = api({ body: z.object({ comment: z.string().max(4000) }) }, async ({ actor, body, params, rpc }) =>
  rpc("set_report_comment", { p_actor: actor.id, p_report_id: params.id, p_comment: body.comment }));

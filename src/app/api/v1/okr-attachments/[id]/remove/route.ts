import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason } from "@/lib/session-notes/schemas";

/** POST /api/v1/okr-attachments/{id}/remove { reason } — withdraw an attachment (the uploader, the facilitator or a finaliser). The record and the stored file are kept; it simply stops being listed. */
export const POST = api({ body: z.object({ reason }) },
  async ({ actor, body, params, rpc }) => { await rpc("remove_okr_attachment", { p_actor: actor.id, p_attachment: params.id, p_reason: body.reason }); return { ok: true }; });

import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";

/** POST /api/v1/executive-attachments/{id}/remove { reason } — whoever attached the file withdraws it; the record and the bytes stay, with the reason. */
export const POST = api({ body: S.removeFile }, async ({ actor, body, params, rpc }) => { await rpc("remove_eo_attachment", { p_actor: actor.id, p_attachment: params.id, p_reason: body.reason }); return { ok: true }; });

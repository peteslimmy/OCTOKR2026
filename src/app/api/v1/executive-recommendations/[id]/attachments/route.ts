import { api } from "@/lib/api/handler";
import { uploadAttachment } from "@/lib/executive-oversight/upload";

/** POST /api/v1/executive-recommendations/{id}/attachments — multipart: file. The author attaches support; the addressed unit attaches evidence to its own record. */
export const POST = api({}, async ({ actor, req, params, rpc }) => uploadAttachment({ req, rpc, actorId: actor.id, commentId: null, recId: params.id }));

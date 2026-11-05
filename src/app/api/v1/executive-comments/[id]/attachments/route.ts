import { api } from "@/lib/api/handler";
import { uploadAttachment } from "@/lib/executive-oversight/upload";

/** POST /api/v1/executive-comments/{id}/attachments — multipart: file. Same checks as every other upload (type, content signature, size, malware scan, private bucket). */
export const POST = api({}, async ({ actor, req, params, rpc }) => uploadAttachment({ req, rpc, actorId: actor.id, commentId: params.id, recId: null }));

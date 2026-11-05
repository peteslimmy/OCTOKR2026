import { z } from "zod";
import { api } from "@/lib/api/handler";
import { links, reason, requestKey } from "@/lib/session-notes/schemas";
import { NOTE_CATEGORIES } from "@/lib/session-notes/constants";

/** POST /api/v1/okr-sessions/{id}/notes — add a note entry. clientKey makes a retried create return the same note; links connect it to OKR components (nothing in them changes). */
export const POST = api({
  body: z.object({
    category: z.enum(NOTE_CATEGORIES.map((c) => c.code) as [string, ...string[]]).default("GENERAL_DISCUSSION"), title: z.string().trim().max(200).nullish(), content: z.string().max(100000).default(""),
    visibility: z.enum(["SHARED", "MANAGEMENT", "CONFIDENTIAL"]).default("SHARED"), links: links.default([]), clientKey: requestKey, reason: reason.optional(),
  }),
}, async ({ actor, body, params, rpc }) => rpc("create_okr_note", {
  p_actor: actor.id, p_session: params.id, p_category: body.category, p_title: body.title ?? null, p_content: body.content, p_visibility: body.visibility, p_links: body.links,
  p_client_key: body.clientKey, p_reason: body.reason ?? null,
}));

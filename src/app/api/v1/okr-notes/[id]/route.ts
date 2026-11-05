import { z } from "zod";
import { api } from "@/lib/api/handler";
import { reason, version } from "@/lib/session-notes/schemas";
import { NOTE_CATEGORIES } from "@/lib/session-notes/constants";

/**
 * PATCH /api/v1/okr-notes/{id} — save a note (the autosave target). expectedVersion is the version the editor started from: if someone saved in between the answer is
 * 409 VERSION_CONFLICT and nothing is overwritten. Re-sending identical text changes nothing. A note of a completed session needs a reason (it is kept as an amendment).
 */
export const PATCH = api({
  body: z.object({
    expectedVersion: version, category: z.enum(NOTE_CATEGORIES.map((c) => c.code) as [string, ...string[]]).optional(), title: z.string().trim().max(200).nullish(), content: z.string().max(100000).optional(),
    visibility: z.enum(["SHARED", "MANAGEMENT", "CONFIDENTIAL"]).optional(), reason: reason.optional(), keepReplaced: z.boolean().optional(),
  }),
}, async ({ actor, body, params, rpc }) => rpc("update_okr_note", {
  p_actor: actor.id, p_note: params.id, p_expected_version: body.expectedVersion, p_category: body.category ?? null, p_title: body.title ?? null, p_content: body.content ?? null,
  p_visibility: body.visibility ?? null, p_reason: body.reason ?? null, p_keep_replaced: body.keepReplaced ?? false,
}));

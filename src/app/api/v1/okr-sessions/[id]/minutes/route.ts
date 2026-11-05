import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { getOutstanding, getWorkspace } from "@/lib/data/session-notes";
import { buildMinutes } from "@/lib/session-notes/minutes";
import { requestKey, version } from "@/lib/session-notes/schemas";

/** GET /api/v1/okr-sessions/{id}/minutes?management=true — the minutes proposed from what was recorded (not saved). Confidential notes never appear; management-only notes only when asked for and permitted. */
export const GET = api({}, async ({ actor, params, req }) => {
  const ws = await getWorkspace(params.id);
  if (!ws) throw fail("NOT_FOUND", 404, "That record was not found.");
  const management = new URL(req.url).searchParams.get("management") === "true";
  if (management && !actor.permissions.has("session_notes.view_all")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const outstanding = await getOutstanding(params.id);
  return { content: buildMinutes(ws, { includeManagement: management, generatedOn: new Date().toISOString(), outstanding: outstanding ?? undefined }), audience: management ? "MANAGEMENT" : "PARTICIPANTS" };
});

/** POST /api/v1/okr-sessions/{id}/minutes { content, audience, aiDrafted?, aiModel?, expectedVersion?, key } — save the working draft (starts revision 1, or the next revision when amending finalised minutes). */
export const POST = api({
  body: z.object({ content: z.string().min(1).max(200000), audience: z.enum(["PARTICIPANTS", "MANAGEMENT"]).default("PARTICIPANTS"), aiDrafted: z.boolean().default(false), aiModel: z.string().max(100).nullish(), expectedVersion: version.optional(), key: requestKey }),
}, async ({ actor, body, params, rpc }) => rpc("save_okr_minutes_draft", {
  p_actor: actor.id, p_session: params.id, p_content: body.content, p_audience: body.audience, p_ai_drafted: body.aiDrafted, p_ai_model: body.aiModel ?? null, p_expected_version: body.expectedVersion ?? null, p_key: body.key,
}));

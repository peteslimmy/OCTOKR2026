import { z } from "zod";
import { api, fail } from "@/lib/api/handler";
import { aiStatus, complete } from "@/lib/ai/provider";
import { getWorkspace } from "@/lib/data/session-notes";
import { proposeSummary } from "@/lib/session-notes/ai-summary";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";

/**
 * POST /api/v1/okr-sessions/{id}/minutes/ai-summary { management? } — a proposed summary written by 4COREPAL from the session's records the caller may read.
 * It is returned as text for the person to edit; it is not saved as minutes, creates no decision, action or risk, and changes no OKR record. The answer is never an error
 * for a provider problem: { ok: false, message } says why there is no proposal. Needs session_notes.update, the AI module switched on, and the right to use the assistant.
 */
export const POST = api({ body: z.object({ management: z.boolean().default(false) }) }, async ({ actor, body, params, rpc }) => {
  if (!actor.permissions.has("session_notes.update")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  if (!actor.permissions.has("ai.assistant.use")) throw fail("PERMISSION_DENIED", 403, "You do not have access to the assistant.");
  if (body.management && !actor.permissions.has("session_notes.view_all")) throw fail("PERMISSION_DENIED", 403, "You do not have permission to do this.");
  const status = await aiStatus(actor.id).catch(() => null);
  if (!status?.enabled) throw fail("AI_DISABLED", 403, "The AI Performance Agent is not switched on.");
  const ws = await getWorkspace(params.id);
  if (!ws) throw fail("NOT_FOUND", 404, "That record was not found.");
  const sb = await userClient();
  const { data: units } = await sb.from("business_units").select("code, name");
  const pseud = await adminClient().rpc("ai_setting", { p_key: "pseudonymise_prompts" });
  const res = await proposeSummary({ complete, units: units ?? [], pseudonymise: pseud.data !== false, userId: actor.id }, ws, body.management);
  await rpc("record_okr_ai_summary", { p_actor: actor.id, p_session: params.id, p_model: res.ok ? res.model : null, p_ok: res.ok, p_reason: res.ok ? null : res.reason }).catch(() => undefined);
  return res;
});

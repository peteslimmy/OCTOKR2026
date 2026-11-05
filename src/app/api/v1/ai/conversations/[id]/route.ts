import { api, fail } from "@/lib/api/handler";
import { userClient } from "@/lib/supabase/server";

/** GET /api/v1/ai/conversations/{id} — the messages of one of the person's own conversations. */
export const GET = api({}, async ({ params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw fail("VALIDATION_ERROR", 422, "A conversation id is required.");
  const sb = await userClient();
  const c = await sb.from("ai_conversations").select("id, title").eq("id", params.id).maybeSingle();
  if (!c.data) throw fail("NOT_FOUND", 404, "That conversation was not found.");
  const m = await sb.from("ai_messages").select("id, role, content, sources, created_at").eq("conversation_id", params.id).order("created_at");
  return { conversation: c.data, messages: m.data ?? [] };
});

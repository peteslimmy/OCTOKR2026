import { api } from "@/lib/api/handler";
import { userClient } from "@/lib/supabase/server";

/** GET /api/v1/ai/conversations — the signed-in person's own conversations, newest first (row-level security: nobody else's). */
export const GET = api({}, async () => {
  const sb = await userClient();
  const { data } = await sb.from("ai_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(30);
  return { conversations: data ?? [] };
});

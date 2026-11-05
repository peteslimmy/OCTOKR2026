import "server-only";
import { can, type Actor } from "@/lib/auth/actor";
import { adminClient } from "@/lib/supabase/admin";
import { userClient } from "@/lib/supabase/server";
import { runAssistant, type Answer, type Refusal } from "./assistant";
import { aiStatus, complete } from "./provider";
import { liveToolData } from "./tools/live-data";

/** What is stored with an assistant message, so a past answer can be shown again with its sources and its labels. */
export interface StoredAnswer { items: Answer["sources"]; statements: Answer["statements"]; limitations: string[]; retrievedAt: string; grounded: boolean }
export interface AskResult { conversationId: string; result: Answer | Refusal }

export class AssistantUnavailable extends Error { constructor(readonly code: "AI_DISABLED" | "PERMISSION_DENIED" | "NOT_FOUND") { super(code); } }

/** One question: checks the module is on, finds or starts the person's conversation, asks, and records both sides. */
export async function ask(actor: Actor, input: { question: string; conversationId?: string | null }): Promise<AskResult> {
  if (!can(actor, "ai.assistant.use")) throw new AssistantUnavailable("PERMISSION_DENIED");
  const status = await aiStatus(actor.id).catch(() => null);
  if (!status?.enabled) throw new AssistantUnavailable("AI_DISABLED");
  const admin = adminClient(), sb = await userClient();

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const own = await sb.from("ai_conversations").select("id").eq("id", conversationId).maybeSingle();     // row-level security: only the person's own
    if (own.error || !own.data) throw new AssistantUnavailable("NOT_FOUND");
  } else {
    const r = await admin.rpc("ai_start_conversation", { p_actor: actor.id, p_title: null });
    if (r.error) throw new Error("could not start a conversation");
    conversationId = r.data as string;
  }

  const hist = await sb.from("ai_messages").select("role, content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(8);
  const history = ((hist.data ?? []) as { role: "user" | "assistant"; content: string }[]).reverse();
  const pseud = await admin.rpc("ai_setting", { p_key: "pseudonymise_prompts" });
  const pseudonymise = pseud.data !== false;

  await admin.rpc("ai_add_message", { p_actor: actor.id, p_conversation: conversationId, p_role: "user", p_content: input.question.slice(0, 2000) });
  if (history.length === 0) await admin.rpc("ai_title_conversation", { p_actor: actor.id, p_conversation: conversationId, p_title: input.question.slice(0, 80) });

  const result = await runAssistant({ complete, data: liveToolData(), pseudonymise },
    { asker: { id: actor.id, buId: actor.buId, permissions: actor.permissions }, question: input.question, history, conversationId });

  if (result.ok) {
    const stored: StoredAnswer = { items: result.sources, statements: result.statements, limitations: result.limitations, retrievedAt: result.retrievedAt, grounded: result.grounded };
    await admin.rpc("ai_add_message", { p_actor: actor.id, p_conversation: conversationId, p_role: "assistant", p_content: result.answer, p_tool_calls: result.toolCalls, p_sources: stored, p_model: result.model });
  }
  return { conversationId, result };
}

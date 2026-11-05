import type { Metadata } from "next";
import Link from "next/link";
import { aiModuleStatus } from "@/lib/ai/status";
import type { StoredAnswer } from "@/lib/ai/ask";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireActor } from "@/lib/auth/actor";
import { userClient } from "@/lib/supabase/server";
import { AiTabs } from "./ai-tabs";
import { Chat, type Shown } from "./chat";
import { Notice } from "./notice";

export const metadata: Metadata = { title: "4COREPAL" };

const EXEC_SUGGESTIONS = ["What is the overall organisational performance this quarter?", "Which business units are at risk, and why?", "Which goals have been carried forward the longest?", "How has the weekly score moved over the quarter?"];
const BU_SUGGESTIONS = ["How is my unit performing this quarter?", "Which of my tasks were not done in finished weeks?", "Which of my goals keep being set without being finished?", "Show my weekly trend."];

export default async function AiPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await requireActor();
  const status = await aiModuleStatus();
  if (!can(actor, "ai.assistant.use")) return <Notice><EmptyState title="4COREPAL is not available for your role" /></Notice>;
  if (!status.enabled) return <Notice><EmptyState title="4COREPAL is not switched on">A Super Admin turns it on after an AI provider has been set up and tested.</EmptyState></Notice>;

  const sp = await searchParams;
  const sb = await userClient();
  const list = await sb.from("ai_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(20);
  const conversations = (list.data ?? []) as { id: string; title: string; updated_at: string }[];
  const selected = sp.c && conversations.some((c) => c.id === sp.c) ? sp.c : null;
  let initial: Shown[] = [];
  if (selected) {
    const m = await sb.from("ai_messages").select("id, role, content, sources").eq("conversation_id", selected).order("created_at");
    initial = ((m.data ?? []) as { id: string; role: "user" | "assistant"; content: string; sources: StoredAnswer | unknown[] }[]).map((x): Shown => {
      const s = !Array.isArray(x.sources) ? (x.sources as StoredAnswer) : null;
      return { id: x.id, role: x.role, text: x.content, ...(s ? { statements: s.statements, sources: s.items, limitations: s.limitations, retrievedAt: s.retrievedAt, grounded: s.grounded } : {}) };
    });
  }
  const org = can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view");
  return (
    <>
      <PageHeader title="4COREPAL" description="Ask about performance in plain language. Every answer comes from the application's own records, shows where it came from, and never goes beyond what you are allowed to see. Your questions and the answers are private to you." />
      <AiTabs current="assistant" monitoring={can(actor, "ai.insights.org")} approvals={can(actor, "ai.approval.decide")} executive={can(actor, "ai.insights.org") && can(actor, "dashboard.executive.view")} communications={can(actor, "ai.communication.view")} admin={can(actor, "ai.config.manage") || can(actor, "ai.audit.view")} />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card>
          <nav aria-label="Your conversations" className="max-h-[calc(100vh-14rem)] overflow-y-auto">
            <Link href="/ai" className="block border-b border-line px-4 py-3 text-sm font-medium text-brand-700 hover:bg-surface">+ New conversation</Link>
            {conversations.length === 0 ? <p className="px-4 py-3 text-xs text-muted">No conversations yet.</p> : (
              <ul className="divide-y divide-line">{conversations.map((c) => <li key={c.id}><Link href={`/ai?c=${c.id}`} aria-current={c.id === selected ? "page" : undefined} className={`block truncate px-4 py-2.5 text-sm ${c.id === selected ? "bg-brand-100 font-semibold text-brand-800" : "hover:bg-surface"}`}>{c.title}</Link></li>)}</ul>
            )}
          </nav>
        </Card>
        <Card><Chat key={selected ?? "new"} initial={initial} conversationId={selected} suggestions={org ? EXEC_SUGGESTIONS : BU_SUGGESTIONS} /></Card>
      </div>
    </>
  );
}

"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "@/components/ui/client";
import { Badge, Banner } from "@/components/ui/primitives";

type Kind = "FACT" | "CALCULATION" | "INTERPRETATION" | "FORECAST" | "RECOMMENDATION";
export interface Shown { id?: string; role: "user" | "assistant"; text: string; statements?: { kind: Kind; text: string; sources: string[] }[]; sources?: { id: string; label: string; href: string; period: string }[]; limitations?: string[]; retrievedAt?: string; grounded?: boolean; refused?: boolean }
interface Reply { conversationId: string; result: { ok: true; answer: string; statements: NonNullable<Shown["statements"]>; sources: NonNullable<Shown["sources"]>; limitations: string[]; retrievedAt: string; grounded: boolean } | { ok: false; reason: string; message: string } }

const KIND: Record<Kind, { label: string; tone: "done" | "info" | "brand" | "warn" }> = {
  FACT: { label: "Fact", tone: "done" }, CALCULATION: { label: "Calculated", tone: "info" }, INTERPRETATION: { label: "Interpretation", tone: "brand" }, FORECAST: { label: "Forecast", tone: "warn" }, RECOMMENDATION: { label: "Recommendation", tone: "brand" },
};
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" }).format(new Date(iso));

export function Chat({ initial, conversationId, suggestions }: { initial: Shown[]; conversationId: string | null; suggestions: string[] }) {
  const [messages, setMessages] = useState<Shown[]>(initial);
  const [conv, setConv] = useState<string | null>(conversationId);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    setError(null); setPending(true); setText("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    try {
      const r = await apiRequest<Reply>("POST", "ai/assistant", { question, ...(conv ? { conversationId: conv } : {}) });
      setConv(r.conversationId);
      if (r.conversationId !== conv) window.history.replaceState(null, "", `/ai?c=${r.conversationId}`);
      setMessages((m) => [...m, r.result.ok
        ? { role: "assistant", text: r.result.answer, statements: r.result.statements, sources: r.result.sources, limitations: r.result.limitations, retrievedAt: r.result.retrievedAt, grounded: r.result.grounded }
        : { role: "assistant", text: r.result.message, refused: true }]);
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Nothing was changed.");
    } finally { setPending(false); }
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(text); };

  return (
    <div className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" role="log" aria-live="polite" aria-label="Conversation" tabIndex={0}>
        {messages.length === 0 ? (
          <div className="mx-auto max-w-xl py-10 text-center">
            <p className="text-lg font-semibold">Ask about performance</p>
            <p className="mt-1 text-sm text-muted">Answers come from the application&apos;s own records, with the sources shown. 4COREPAL can only see what you are allowed to see.</p>
            <ul className="mt-5 grid gap-2 text-left sm:grid-cols-2">
              {suggestions.map((s) => <li key={s}><button type="button" onClick={() => void send(s)} className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-left text-sm hover:bg-surface">{s}</button></li>)}
            </ul>
          </div>
        ) : messages.map((m, i) => m.role === "user" ? (
          <div key={m.id ?? `u${i}`} className="ml-auto max-w-[85%] rounded-2xl bg-brand-700 px-4 py-2 text-sm text-white">{m.text}</div>
        ) : (
          <article key={m.id ?? `a${i}`} className="max-w-[92%] space-y-3 rounded-2xl border border-line bg-panel px-4 py-3 text-sm" aria-label="Answer">
            {m.refused ? <Banner tone="warn" title="No answer this time">{m.text}</Banner> : (
              <>
                {m.grounded === false ? <Banner tone="warn" title="Written explanation withheld">Some figures in the draft were not in the data, so only the verified figures are shown.</Banner> : null}
                <p>{m.text}</p>
                {m.statements?.length ? (
                  <ul className="space-y-1.5">
                    {m.statements.map((s, k) => (
                      <li key={k} className="flex items-start gap-2"><span className="mt-0.5 w-28 shrink-0"><Badge tone={KIND[s.kind].tone}>{KIND[s.kind].label}</Badge></span><span>{s.text}{s.sources.length ? <span className="text-xs text-muted"> [{s.sources.join(", ")}]</span> : null}</span></li>
                    ))}
                  </ul>
                ) : null}
                {m.sources?.length ? (
                  <div><p className="mb-1 text-xs font-medium text-muted">Sources</p>
                    <ul className="flex flex-wrap gap-2">{m.sources.map((s) => <li key={s.id}><Link href={s.href} className="inline-block rounded-md border border-line bg-surface px-2 py-1 text-xs text-brand-700 underline">{s.id} · {s.label} · {s.period}</Link></li>)}</ul></div>
                ) : null}
                {m.limitations?.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{m.limitations.map((l) => <li key={l}>{l}</li>)}</ul> : null}
                {m.retrievedAt ? <p className="text-xs text-muted">Data retrieved {when(m.retrievedAt)} WAT. Generated from recorded data by an AI model: check the sources before acting on it.</p> : null}
              </>
            )}
          </article>
        ))}
        {pending ? <div role="status" className="max-w-[60%] rounded-2xl border border-line bg-panel px-4 py-3 text-sm text-muted"><span className="shimmer inline-block h-3 w-40 rounded" /> <span className="sr-only">Working on it</span></div> : null}
        {error ? <Banner tone="critical" title="Could not ask">{error}</Banner> : null}
        <div ref={end} />
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line px-4 py-3">
        <label className="sr-only" htmlFor="ai-question">Your question</label>
        <textarea id="ai-question" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Ask a question about performance…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          className="min-h-[2.75rem] flex-1 resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
        <button type="submit" disabled={pending || !text.trim()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white disabled:opacity-50"><Send className="h-4 w-4" aria-hidden />Ask</button>
      </form>
    </div>
  );
}

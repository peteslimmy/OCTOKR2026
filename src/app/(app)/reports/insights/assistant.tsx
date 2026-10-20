"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest, ApiFailure } from "@/components/ui/client";
import { Badge, Button, Card, CardHeader, Input, Field } from "@/components/ui/primitives";

interface Answer { matched: boolean; reportId: string | null; quarterId: string | null; answer: string; caveat?: string; blocked?: { needs: string }; suggestions: string[] }

/** Maps a question to an approved report. It does not generate SQL or text with a model, and it opens reports with your own permissions. */
export function Assistant() {
  const [q, setQ] = useState("");
  const [a, setA] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    setBusy(true); setErr(null);
    try { setA(await apiRequest<Answer>("POST", "reports/assistant", { question })); } catch (e) { setErr((e as ApiFailure).message); }
    setBusy(false);
  };
  return (
    <Card>
      <CardHeader title="Ask about the numbers" description="Plain questions are matched to the approved reports. No AI model is used, and a question about data the application does not hold is answered with exactly that." />
      <div className="space-y-3 px-6 py-4 text-sm">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
          <Field id="assistant-q" label="Your question"><Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="e.g. Which Business Units are at risk of finishing low?" /></Field>
          <Button type="submit" disabled={busy || !q.trim()}>{busy ? "Looking…" : "Find the report"}</Button>
        </form>
        {err ? <p role="alert" className="text-[var(--critical-fg)]">{err}</p> : null}
        {a ? (
          <div role="status" className="space-y-2 rounded-lg bg-surface p-4">
            <p>{a.answer}</p>
            {a.blocked ? <p className="text-muted"><Badge tone="locked">Data not available</Badge> Needs: {a.blocked.needs}</p> : null}
            {a.caveat ? <p className="text-muted">Note: {a.caveat}</p> : null}
            {a.reportId ? <Link className="inline-block text-brand-700 underline" href={`/reports/${a.reportId}${a.quarterId ? `?quarterId=${a.quarterId}` : ""}`}>Open the report</Link> : null}
          </div>
        ) : null}
        <ul className="flex flex-wrap gap-2" aria-label="Example questions">
          {(a?.suggestions ?? ["Which Business Units improved the most this quarter?", "Compare reporting compliance across BUs", "Which BUs are at risk of finishing low?", "What approvals are outstanding?"]).map((s) => (
            <li key={s}><button type="button" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface" onClick={() => { setQ(s); ask(s); }}>{s}</button></li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

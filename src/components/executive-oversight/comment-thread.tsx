"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Skeleton, Textarea } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import { AreaF, DialogForm } from "@/components/session-notes/forms";
import { moduleLabel } from "@/lib/executive-oversight/constants";
import type { EoCaps } from "@/lib/executive-oversight/caps";
import type { EoCommentThread } from "@/lib/executive-oversight/types";
import { Attachments } from "./attachments";
import { KindBadge, Links, RichText, dateTimeText, newKey } from "./common";

/**
 * One comment with its whole conversation. The original comment is shown apart from the replies (which are in the order they were written); an amended comment says so and
 * keeps every earlier wording readable. Used in the side panel and on the comment's own page.
 */
export function CommentThread({ id, initial, caps, onChanged }: { id: string; initial?: EoCommentThread | null; caps: EoCaps; onChanged?: () => void }) {
  const [c, setC] = useState<EoCommentThread | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [key, setKey] = useState(newKey);
  const { run, pending } = useAction();
  const load = useCallback(async () => {
    try { setC(await apiRequest<EoCommentThread>("GET", `executive-comments/${id}`)); setError(null); } catch { setError("This conversation could not be loaded."); }
  }, [id]);
  useEffect(() => {
    if (initial) return;
    let live = true;
    apiRequest<EoCommentThread>("GET", `executive-comments/${id}`).then((d) => live && setC(d), () => live && setError("This conversation could not be loaded."));
    return () => { live = false; };
  }, [initial, id]);
  const after = async () => { await load(); onChanged?.(); };

  if (error) return <p role="alert" className="text-sm text-[var(--critical-fg)]">{error} <button className="underline" onClick={() => void load()}>Try again</button></p>;
  if (!c) return <Skeleton className="h-24 w-full" />;
  const mine = c.author_id === caps.viewerId;
  const replies = c.events.filter((e) => e.event_type === "REPLY");
  const withdrawn = c.status === "WITHDRAWN";
  return (
    <article className="space-y-3" aria-label={`Comment ${c.reference}`}>
      <div className="rounded-xl border-l-4 border-brand-600 bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <KindBadge kind="COMMENT" />
          {c.category ? <Badge tone="info">{c.category}</Badge> : null}
          {c.visibility === "MANAGEMENT" ? <Badge tone="locked">Management only</Badge> : null}
          {withdrawn ? <Badge tone="locked">Withdrawn</Badge> : null}
          {c.version > 1 && !withdrawn ? <Badge tone="warn">Amended</Badge> : null}
          <span className="font-mono">{c.reference}</span>
        </div>
        {c.title ? <h3 className="mt-1 text-sm font-semibold text-ink">{c.title}</h3> : null}
        <RichText md={c.content} className="mt-1 text-sm" />
        <p className="mt-2 text-xs text-muted">
          {c.author_name} ({c.author_role.replace(/_/g, " ").toLowerCase()}) · {dateTimeText(c.created_at)} · {c.business_unit_name} · {moduleLabel(c.module)}{c.subject_label ? ` · ${c.subject_label}` : ""}
        </p>
        {withdrawn && c.withdrawn_reason ? <p className="mt-1 text-xs text-muted">Withdrawn by the author: {c.withdrawn_reason}</p> : null}
        <div className="mt-2"><Links links={c.links} /></div>
      </div>

      {c.versions.length ? (
        <details className="rounded-lg border border-line px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-ink">Earlier wording ({c.versions.length})</summary>
          <ol className="mt-2 space-y-2">
            {c.versions.map((v) => (
              <li key={v.version} className="rounded-lg bg-surface p-2">
                <p className="text-xs text-muted">Version {v.version} · replaced {dateTimeText(v.replaced_at)} by {v.replaced_by} ({v.change_kind === "WITHDRAWN" ? "withdrawn" : "amended"}) — {v.reason}</p>
                <RichText md={v.content} className="mt-1 text-sm" />
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <section aria-label="Replies">
        <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Replies ({replies.length})</h4>
        {replies.length === 0 ? <p className="mt-1 text-sm text-muted">No replies yet.</p> : (
          <ol className="mt-1 space-y-2">
            {replies.map((e) => (
              <li key={e.id} className={`rounded-lg border p-2 text-sm ${e.actor_id === c.author_id ? "border-brand-200 bg-brand-50/40" : "border-line"}`}>
                <p className="text-xs text-muted"><span className="font-medium text-ink">{e.actor_name}</span> · {(e.actor_role ?? "").replace(/_/g, " ").toLowerCase()} · {dateTimeText(e.occurred_at)}</p>
                <RichText md={e.body ?? ""} className="mt-1" />
              </li>
            ))}
          </ol>
        )}
      </section>

      {caps.reply && !withdrawn ? (
        <form className="space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => apiRequest("POST", `executive-comments/${c.id}/replies`, { content: reply.trim(), requestKey: key }), { success: "Reply posted.", refresh: false });
          if (r) { setReply(""); setKey(newKey()); await after(); }
        }}>
          <label className="sr-only" htmlFor={`reply-${c.id}`}>Your reply</label>
          <Textarea id={`reply-${c.id}`} rows={2} maxLength={10000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">A reply never changes the original comment.</span>
            <Button size="sm" type="submit" disabled={pending || !reply.trim()}>{pending ? "Posting…" : "Reply"}</Button>
          </div>
        </form>
      ) : null}

      <Attachments owner={{ kind: "comment", id: c.id }} files={c.attachments} viewerId={caps.viewerId} canAttach={caps.reply && !withdrawn} />

      {mine && caps.amend && !withdrawn ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <AmendDialog c={c} onDone={after} />
          <WithdrawDialog c={c} onDone={after} />
        </div>
      ) : null}
    </article>
  );
}

function AmendDialog({ c, onDone }: { c: EoCommentThread; onDone: () => void | Promise<void> }) {
  const [content, setContent] = useState(c.content);
  const [reason, setReason] = useState("");
  return (
    <DialogForm label="Amend" title={`Amend ${c.reference}`} description="Your earlier wording stays visible to everyone who can read this comment, with your reason." submitLabel="Save amendment" success="Comment amended."
      canSubmit={!!content.trim() && content.trim() !== c.content && !!reason.trim()} onOpen={() => { setContent(c.content); setReason(""); }}
      onSubmit={async () => { await apiRequest("POST", `executive-comments/${c.id}/amend`, { expectedVersion: c.version, content: content.trim(), reason: reason.trim() }); await onDone(); }}>
      <AreaF id={`am-${c.id}`} label="New wording" value={content} onChange={setContent} rows={5} max={10000} required />
      <AreaF id={`amr-${c.id}`} label="Why are you changing it?" value={reason} onChange={setReason} rows={2} max={2000} required />
    </DialogForm>
  );
}

function WithdrawDialog({ c, onDone }: { c: EoCommentThread; onDone: () => void | Promise<void> }) {
  const [reason, setReason] = useState("");
  return (
    <DialogForm label="Withdraw" title={`Withdraw ${c.reference}`} description="The comment stays readable, marked as withdrawn, and the conversation closes. Nothing is deleted." submitLabel="Withdraw comment" variant="ghost"
      success="Comment withdrawn." canSubmit={!!reason.trim()} onOpen={() => setReason("")}
      onSubmit={async () => { await apiRequest("POST", `executive-comments/${c.id}/withdraw`, { reason: reason.trim() }); await onDone(); }}>
      <AreaF id={`wd-${c.id}`} label="Why are you withdrawing it?" value={reason} onChange={setReason} rows={3} max={2000} required />
    </DialogForm>
  );
}

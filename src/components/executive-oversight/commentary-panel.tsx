"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";
import { apiRequest } from "@/components/ui/client";
import type { EoCaps } from "@/lib/executive-oversight/caps";
import type { EoCategory, EoContext } from "@/lib/executive-oversight/types";
import { CommentThread } from "./comment-thread";
import { AwaitingBadge, CommentLink, KindBadge, OverdueBadge, PriorityBadge, RecLink, StatusBadge, dateText } from "./common";
import { CommentForm, RecommendationDialog, type EoSubject, type Unit } from "./forms";

/**
 * The "Executive Commentary" side panel that sits on a BU-related screen. It opens beside the record being reviewed (the screen behind it is not left), shows what has been said about
 * this record, and lets an Executive or Director add a comment or make a recommendation with the unit, week and record already filled in. A unit's people see the same conversation and can reply.
 */
export function CommentaryPanel({ subject, units, categories, caps, initial, label = "Executive Commentary" }: {
  subject: EoSubject; units: Unit[]; categories: EoCategory[]; caps: EoCaps; initial: EoContext | null; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<EoContext | null>(initial);
  const [mode, setMode] = useState<"list" | "comment">("list");
  const [rec, setRec] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const url = useCallback(() => {
    const q = new URLSearchParams();
    if (subject.subjectType && subject.subjectId) { q.set("subjectType", subject.subjectType); q.set("subjectId", subject.subjectId); } else if (subject.module) q.set("module", subject.module);
    if (subject.businessUnitId) q.set("bu", subject.businessUnitId);
    return `executive-oversight/context?${q.toString()}`;
  }, [subject]);
  const reload = useCallback(async () => {
    try { setCtx(await apiRequest<EoContext>("GET", url())); setFailed(false); } catch { setFailed(true); }
  }, [url]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    apiRequest<EoContext>("GET", url()).then((d) => { if (live) { setCtx(d); setFailed(false); } }, () => live && setFailed(true));
    return () => { live = false; };
  }, [open, url]);
  const n = (ctx?.comments.length ?? 0) + (ctx?.recommendations.length ?? 0);
  const pendingForUnit = (ctx?.recommendations ?? []).filter((r) => r.awaiting === "BU" && r.business_unit_id === caps.viewerBu).length;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="eo-open-panel">
        {label}{ctx ? <span className="ml-1.5 rounded-full bg-brand-100 px-1.5 text-xs text-brand-800" aria-label={`${n} items`}>{n}</span> : null}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content aria-describedby="eo-panel-desc" className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-panel shadow-2xl sm:rounded-l-2xl" data-testid="eo-panel">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-ink">Executive Commentary</Dialog.Title>
                <Dialog.Description id="eo-panel-desc" className="mt-0.5 text-xs text-muted">{subject.subjectLabel ?? "Comments and recommendations about this screen"}</Dialog.Description>
              </div>
              <Dialog.Close className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-line" aria-label="Close the panel">×</Dialog.Close>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {caps.comment || caps.recommend ? (
                <div className="flex flex-wrap gap-2">
                  {caps.comment ? <Button size="sm" variant={mode === "comment" ? "primary" : "secondary"} onClick={() => setMode(mode === "comment" ? "list" : "comment")} data-testid="eo-add-comment">Add a comment</Button> : null}
                  {caps.recommend ? <Button size="sm" variant="secondary" onClick={() => setRec(true)} data-testid="eo-make-recommendation">Make a recommendation</Button> : null}
                </div>
              ) : <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">You can read and reply to what executives write about your unit. Only Executives and Directors can start a comment or recommendation.</p>}
              {pendingForUnit ? <p role="status" className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn-fg)]">{pendingForUnit} recommendation{pendingForUnit === 1 ? " is" : "s are"} waiting for your unit.</p> : null}
              {mode === "comment" ? <CommentForm subject={subject} units={units} categories={categories} canOrgWide={caps.viewAll} onDone={() => { setMode("list"); void reload(); }} /> : null}
              {failed ? <p role="alert" className="text-sm text-[var(--critical-fg)]">The commentary could not be loaded. <button className="underline" onClick={() => void reload()}>Try again</button></p> : null}
              {!ctx && !failed ? <Skeleton className="h-24 w-full" /> : null}
              {ctx ? (
                <>
                  <section aria-label="Recommendations">
                    <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Recommendations ({ctx.recommendations.length})</h3>
                    {ctx.recommendations.length === 0 ? <p className="text-sm text-muted">No recommendations about this yet.</p> : (
                      <ul className="space-y-2">
                        {ctx.recommendations.map((r) => (
                          <li key={r.target_id} className="rounded-xl border border-line p-3 text-sm">
                            <div className="flex flex-wrap items-center gap-1.5"><KindBadge kind="RECOMMENDATION" /><PriorityBadge priority={r.priority} /><StatusBadge status={r.status} /><OverdueBadge overdue={r.overdue} /><AwaitingBadge awaiting={r.awaiting} /></div>
                            <p className="mt-1"><RecLink id={r.id}>{r.title}</RecLink></p>
                            <p className="text-xs text-muted">{r.business_unit_name} · {r.author_name} · {r.response_due ? `respond by ${dateText(r.response_due)}` : "no deadline"}</p>
                            {r.latest_update ? <p className="mt-1 text-xs text-muted">Latest: {r.latest_update.excerpt || r.latest_update.event_type.toLowerCase().replace(/_/g, " ")}</p> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section aria-label="Comments">
                    <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Comments ({ctx.comments.length})</h3>
                    {ctx.comments.length === 0 ? <p className="text-sm text-muted">No comments about this yet.</p> : (
                      <ul className="space-y-2">
                        {ctx.comments.map((c) => (
                          <li key={c.id} className="rounded-xl border border-line p-3 text-sm">
                            {openThread === c.id ? (
                              <>
                                <CommentThread id={c.id} caps={caps} onChanged={() => void reload()} />
                                <div className="mt-2 flex gap-3 text-xs"><button className="underline" onClick={() => setOpenThread(null)}>Hide the conversation</button><CommentLink id={c.id}>Open on its own page</CommentLink></div>
                              </>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-1.5"><KindBadge kind="COMMENT" />{c.category ? <Badge tone="info">{c.category}</Badge> : null}{c.visibility === "MANAGEMENT" ? <Badge tone="locked">Management only</Badge> : null}{c.status === "WITHDRAWN" ? <Badge tone="locked">Withdrawn</Badge> : null}</div>
                                <p className="mt-1 font-medium text-ink">{c.title ?? c.summary}</p>
                                <p className="text-xs text-muted">{c.author_name} · {dateText(c.created_at)} · {c.replies} repl{c.replies === 1 ? "y" : "ies"}</p>
                                <button className="mt-1 text-xs underline" onClick={() => setOpenThread(c.id)}>Read the conversation</button>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {rec ? <RecommendationDialog open={rec} onOpenChange={setRec} subject={subject} units={units} categories={categories} onDone={() => void reload()} /> : null}
    </>
  );
}

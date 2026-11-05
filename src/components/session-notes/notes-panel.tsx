"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Input, NativeSelect } from "@/components/ui/primitives";
import { apiRequest, toast, useAction } from "@/components/ui/client";
import { NOTE_CATEGORIES, categoryLabel } from "@/lib/session-notes/constants";
import type { NoteRow, Workspace } from "@/lib/session-notes/types";
import { DialogForm, TextF } from "./forms";
import { LinkPicker } from "./link-picker";
import { LinkChips, RichText, VisibilityBadge, dateTimeText, newKey } from "./common";
import { NoteEditor } from "./note-editor";
import type { Caps } from "./workspace";

interface Props { ws: Workspace; caps: Caps; editable: boolean; onConvert: (kind: "decision" | "action" | "risk", note: NoteRow) => void }

export function NotesPanel({ ws, caps, editable, onConvert }: Props) {
  const s = ws.session;
  const { run, pending } = useAction();
  const [filter, setFilter] = useState("");
  const [quick, setQuick] = useState("");
  const [quickCat, setQuickCat] = useState<string>("PERFORMANCE_OBSERVATION");
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const completed = s.status === "COMPLETED";
  const [addReason, setAddReason] = useState("");
  const canWrite = caps.create && editable;

  const visible = useMemo(() => ws.notes.filter((n) => (showArchived || n.status === "ACTIVE") && (!filter || n.category === filter)), [ws.notes, filter, showArchived]);
  const runsSession = ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise;

  const create = async (content: string, category: string, openEditor: boolean) => {
    if (completed && !addReason.trim()) { toast.error("Say why a note is being added to a completed session."); return; }
    const r = await run(() => apiRequest<{ id: string }>("POST", `okr-sessions/${s.id}/notes`, {
      category, content, clientKey: newKey(), links: [], ...(completed ? { reason: addReason.trim() } : {}),
      // the unit and week the session is about are the defaults; the link picker on each note changes them
    }), { success: openEditor ? undefined : "Note added." });
    if (r) { setQuick(""); if (openEditor) setEditing(r.value.id); }
  };

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Discussion notes</h2>
      {canWrite ? (
        <Card className="space-y-3 p-4">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) void create(quick.trim(), quickCat, false); }}>
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="quick-note" className="mb-1 block text-sm font-medium text-ink">Quick note</label>
              <Input id="quick-note" value={quick} maxLength={2000} placeholder="Type an observation, question or point and press Enter" onChange={(e) => setQuick(e.target.value)} />
            </div>
            <div>
              <label htmlFor="quick-cat" className="mb-1 block text-sm font-medium text-ink">Category</label>
              <NativeSelect id="quick-cat" value={quickCat} onChange={(e) => setQuickCat(e.target.value)}>{NOTE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</NativeSelect>
            </div>
            <Button type="submit" disabled={!quick.trim() || pending}>Add note</Button>
            <Button variant="secondary" disabled={pending} onClick={() => void create("", quickCat, true)}>Open full editor</Button>
          </form>
          {completed ? <TextF id="add-reason" label="Why is this being added to a completed session?" value={addReason} onChange={setAddReason} required max={2000} hint="Kept with the note as an amendment." /> : null}
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="note-filter" className="text-sm text-muted">Show</label>
        <NativeSelect id="note-filter" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All categories ({ws.notes.filter((n) => n.status === "ACTIVE").length})</option>
          {NOTE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label} ({ws.notes.filter((n) => n.status === "ACTIVE" && n.category === c.code).length})</option>)}
        </NativeSelect>
        <label className="ml-2 inline-flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Include archived notes</label>
      </div>

      {visible.length === 0 ? <Card><EmptyState title="No notes yet">{canWrite ? "Use the quick note box above, or open the full editor." : "Nothing has been recorded in this session yet."}</EmptyState></Card> : (
        <ol className="space-y-3" aria-label="Discussion timeline">
          {visible.map((n) => (
            <li key={n.id}>
              <NoteCard ws={ws} note={n} caps={caps} editable={editable} runsSession={runsSession} editing={editing === n.id} setEditing={setEditing} onConvert={onConvert} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NoteCard({ ws, note: n, caps, editable, runsSession, editing, setEditing, onConvert }: {
  ws: Workspace; note: NoteRow; caps: Caps; editable: boolean; runsSession: boolean; editing: boolean; setEditing: (id: string | null) => void; onConvert: Props["onConvert"];
}) {
  const s = ws.session;
  const { run } = useAction();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [versions, setVersions] = useState<{ id: string; version: number; content: string; title: string | null; saved_by_name: string | null; saved_at: string; superseded_by_name: string | null; superseded_at: string; change_kind: string; reason: string | null }[] | null>(null);
  const mine = n.author_id === ws.viewer.id;
  const canEdit = caps.update && editable && n.status === "ACTIVE" && (mine || runsSession);
  const canLink = canEdit && !!s.business_unit_id;

  return (
    <Card className={`p-4 ${n.status === "ARCHIVED" ? "opacity-75" : ""}`} data-testid="note-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{categoryLabel(n.category)}</Badge>
            <VisibilityBadge visibility={n.visibility} />
            {n.status === "ARCHIVED" ? <Badge tone="locked">Archived</Badge> : null}
            {n.versions > 0 ? <Badge tone="undefined">{n.versions} earlier version{n.versions === 1 ? "" : "s"}</Badge> : null}
          </div>
          {n.title ? <h3 className="mt-1 text-base font-semibold text-ink">{n.title}</h3> : null}
          <p className="mt-0.5 text-xs text-muted">{n.author_name ?? "Unknown"} · {dateTimeText(n.noted_at)}{n.updated_at !== n.created_at ? ` · edited ${dateTimeText(n.updated_at)} by ${n.last_edited_by_name ?? "—"}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {canEdit && !editing ? <Button size="sm" variant="secondary" onClick={() => setEditing(n.id)}>Edit</Button> : null}
          {n.versions > 0 ? (
            <DialogForm label="History" title="Earlier versions of this note" description="Every earlier saved state, who wrote it and why it was replaced." submitLabel="Close" onSubmit={async () => undefined}
              onOpen={() => { apiRequest<NonNullable<typeof versions>>("GET", `okr-notes/${n.id}/versions`).then(setVersions).catch(() => toast.error("The history could not be loaded.")); }}>
              {versions === null ? <p className="text-sm text-muted">Loading…</p> : (
                <ol className="max-h-80 space-y-3 overflow-y-auto">
                  {versions.map((v) => (
                    <li key={v.id} className="rounded-lg border border-line p-3">
                      <p className="text-xs text-muted">Version {v.version} · written by {v.saved_by_name ?? "—"} {dateTimeText(v.saved_at)} · replaced by {v.superseded_by_name ?? "—"} {dateTimeText(v.superseded_at)} ({v.change_kind.replace(/_/g, " ").toLowerCase()}){v.reason ? ` — ${v.reason}` : ""}</p>
                      <div className="mt-2"><RichText md={v.content || "_Empty_"} /></div>
                    </li>
                  ))}
                  {versions.length === 0 ? <li className="text-sm text-muted">No earlier versions.</li> : null}
                </ol>
              )}
            </DialogForm>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        {editing ? <NoteEditor note={n} amend={s.status === "COMPLETED"} mentionable={ws.participants.filter((p) => !p.removed_at && p.user_id !== ws.viewer.id).map((p) => ({ id: p.user_id, name: p.name ?? "Unknown" }))} onClose={(changed) => { setEditing(null); if (changed) router.refresh(); }} /> : n.content.trim() ? <RichText md={n.content} /> : <p className="text-sm text-muted">No text yet.</p>}
      </div>

      <div className="mt-3 space-y-2">
        <LinkChips links={n.links} onRemove={canLink ? (l) => void run(() => apiRequest("POST", `okr-notes/${n.id}/links`, { targetType: l.target_type, targetId: l.target_id, remove: true }), { success: "Link removed." }) : undefined} />
        {canLink ? <LinkPicker buId={s.business_unit_id} weekId={s.reporting_week_id} exclude={n.links.map((l) => l.target_id)}
          onPick={async (l) => { await run(() => apiRequest("POST", `okr-notes/${n.id}/links`, { targetType: l.target_type, targetId: l.target_id }), { success: "Linked. The OKR record itself is unchanged." }); }} /> : null}
      </div>

      {n.status === "ACTIVE" && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {caps.decisionsCreate && editable ? <Button size="sm" variant="ghost" onClick={() => onConvert("decision", n)}>Propose as decision…</Button> : null}
          {caps.actionsCreate && editable ? <Button size="sm" variant="ghost" onClick={() => onConvert("action", n)}>Create action…</Button> : null}
          {caps.risksManage && editable ? <Button size="sm" variant="ghost" onClick={() => onConvert("risk", n)}>Record as risk…</Button> : null}
          {canEdit ? (
            <span className="ml-auto">
              <DialogForm label="Archive" title="Archive this note?" description="It is hidden from the minutes but kept, with all its versions. You can restore it." submitLabel="Archive note" variant="ghost"
                success="Note archived." canSubmit={reason.trim().length > 0} onSubmit={() => apiRequest("POST", `okr-notes/${n.id}/archive`, { reason: reason.trim() })}>
                <TextF id={`arch-${n.id}`} label="Why?" value={reason} onChange={setReason} required max={2000} />
              </DialogForm>
            </span>
          ) : null}
        </div>
      ) : null}
      {n.status === "ARCHIVED" && caps.update && editable && (mine || runsSession) ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-xs text-muted">Archived{n.archive_reason ? `: ${n.archive_reason}` : ""}</p>
          <DialogForm label="Restore" title="Restore this note?" submitLabel="Restore note" success="Note restored." canSubmit={reason.trim().length > 0} onSubmit={() => apiRequest("POST", `okr-notes/${n.id}/archive`, { restore: true, reason: reason.trim() })}>
            <TextF id={`rest-${n.id}`} label="Why?" value={reason} onChange={setReason} required max={2000} />
          </DialogForm>
        </div>
      ) : null}
    </Card>
  );
}

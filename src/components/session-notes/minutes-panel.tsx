"use client";

import { useState } from "react";
import { Badge, Banner, Button, Card, EmptyState } from "@/components/ui/primitives";
import { apiRequest, toast, useAction } from "@/components/ui/client";
import type { MinutesRow, Workspace } from "@/lib/session-notes/types";
import { DialogForm, TextF } from "./forms";
import { MinutesStatusBadge, RichText, dateTimeText, newKey } from "./common";
import type { Caps } from "./workspace";

/**
 * Minutes: draft notes -> a draft of the minutes -> submitted for review -> reviewed -> finalised. Finalising freezes the revision with a snapshot of the notes,
 * decisions, actions and risks and an integrity hash; the notes themselves are untouched. A change after that is a new revision. An AI proposal is only ever text in the editor
 * until a person saves it, and it still has to be submitted, reviewed and finalised by people.
 */
export function MinutesPanel({ ws, caps, editable }: { ws: Workspace; caps: Caps; editable: boolean }) {
  const s = ws.session;
  const { run, pending } = useAction();
  const latest = ws.minutes[0] ?? null;
  const working = latest && latest.status !== "FINALISED" ? latest : null;
  const final = ws.minutes.find((m) => m.status === "FINALISED") ?? null;
  const runs = ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise;
  const [text, setText] = useState(working?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [management, setManagement] = useState(working?.audience === "MANAGEMENT");
  const [aiDrafted, setAiDrafted] = useState(working?.ai_drafted ?? false);
  const [preview, setPreview] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [starting, setStarting] = useState(false);
  const canStart = caps.update && editable && runs && s.status !== "DRAFT";

  const generate = async () => {
    const g = await apiRequest<{ content: string }>("GET", `okr-sessions/${s.id}/minutes${management ? "?management=true" : ""}`);
    return g.content;
  };
  const saveDraft = () => apiRequest<{ version: number }>("POST", `okr-sessions/${s.id}/minutes`, { content: text, audience: management ? "MANAGEMENT" : "PARTICIPANTS", aiDrafted, expectedVersion: working?.version, key: newKey() });

  if (!working && !canStart && !final) {
    return <Card><EmptyState title="No minutes yet">{s.status === "DRAFT" ? "Start the session first; minutes are prepared from what is recorded in it." : "The minutes have not been prepared."}</EmptyState></Card>;
  }

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Minutes</h2>
      {s.status !== "COMPLETED" && !final ? <Banner tone="info" title="Minutes are finalised after the session is completed">You can prepare and review a draft at any time; the session must be completed before the minutes can be finalised.</Banner> : null}

      {final ? (
        <Card className="p-4" data-testid="final-minutes">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><MinutesStatusBadge status="FINALISED" /><span className="text-sm">Revision {final.revision}</span>{final.amends_revision ? <Badge tone="info">Amends revision {final.amends_revision}</Badge> : null}{final.ai_drafted ? <Badge tone="undefined">First draft proposed by AI, reviewed by a person</Badge> : null}</div>
            {caps.export ? <a className="inline-flex min-h-8 items-center rounded-lg border border-line bg-panel px-3 text-sm hover:bg-surface" href={`/api/v1/okr-sessions/${s.id}/export?format=pdf&revision=${final.revision}`}>Download PDF</a> : null}
          </div>
          <p className="mt-1 text-xs text-muted">Finalised by {final.finalised_by_name ?? "—"} on {dateTimeText(final.finalised_at)} · reviewed by {final.reviewed_by_name ?? "—"} · integrity hash <code>{final.content_hash?.slice(0, 16)}…</code> · drafted by {final.created_by_name ?? "—"}</p>
          <div className="mt-3 rounded-lg border border-line p-4"><RichText md={final.content} /></div>
        </Card>
      ) : null}

      {working ? (
        <Card className="space-y-3 p-4" data-testid="working-minutes">
          <div className="flex flex-wrap items-center gap-2"><MinutesStatusBadge status={working.status} /><span className="text-sm">Revision {working.revision}{working.amends_revision ? ` (amends revision ${working.amends_revision})` : ""}</span>
            {working.ai_drafted || aiDrafted ? <Badge tone="warn">Started from an AI proposal — needs a person&apos;s review</Badge> : null}
            {working.audience === "MANAGEMENT" ? <Badge tone="locked">Management minutes</Badge> : null}</div>
          {working.review_remarks ? <p className="rounded bg-[var(--warn-bg)] px-2 py-1 text-sm text-[var(--warn-fg)]">Reviewer&apos;s remarks: {working.review_remarks}</p> : null}
          {working.status === "DRAFT" && canStart ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" disabled={pending} onClick={async () => { if (dirty && !window.confirm("Replace your edits with minutes freshly built from the session records?")) return; const g = await run(generate, { refresh: false }); if (g) { setText(g.value); setDirty(true); } }}>Rebuild from session records</Button>
                {caps.viewAll ? <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={management} onChange={(e) => { setManagement(e.target.checked); setDirty(true); }} /> Management minutes (include management-only notes)</label> : null}
                <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>{preview ? "Edit" : "Preview"}</Button>
              </div>
              {preview ? <div className="rounded-lg border border-line p-4"><RichText md={text} /></div> : (
                <textarea aria-label="Minutes text" rows={22} value={text} maxLength={200000} onChange={(e) => { setText(e.target.value); setDirty(true); }}
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[0.9rem] leading-6 text-ink" />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={pending || !text.trim()} onClick={async () => { const r = await run(saveDraft, { success: "Draft saved." }); if (r) setDirty(false); }}>Save draft</Button>
                <Button variant="secondary" disabled={pending || dirty} title={dirty ? "Save the draft first" : undefined} onClick={() => void run(() => apiRequest("POST", `okr-minutes/${working.id}/submit`, { expectedVersion: working.version }), { success: "Submitted for review." })}>Submit for review</Button>
                {dirty ? <span className="text-sm text-[var(--warn-fg)]" role="status">Unsaved changes</span> : <span className="text-sm text-muted" role="status">Saved</span>}
              </div>
            </>
          ) : <div className="rounded-lg border border-line p-4"><RichText md={working.content} /></div>}

          {working.status === "SUBMITTED" ? (
            caps.finalise ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <p className="text-sm text-muted">Submitted by {working.submitted_by_name ?? "—"} {dateTimeText(working.submitted_at)}.</p>
                <Button disabled={pending} onClick={() => void run(() => apiRequest("POST", `okr-minutes/${working.id}/review`, { outcome: "APPROVE", expectedVersion: working.version }), { success: "Minutes reviewed." })}>Approve as reviewed</Button>
                <DialogForm label="Return for changes…" title="Return the minutes" submitLabel="Return" success="Returned to the author." canSubmit={remarks.trim().length > 0} onOpen={() => setRemarks("")}
                  onSubmit={() => apiRequest("POST", `okr-minutes/${working.id}/review`, { outcome: "RETURN", remarks: remarks.trim(), expectedVersion: working.version })}>
                  <TextF id="ret" label="What needs to change?" value={remarks} onChange={setRemarks} required max={3000} />
                </DialogForm>
              </div>
            ) : <p className="text-sm text-muted">Waiting for review by someone who can finalise minutes.</p>
          ) : null}
          {working.status === "REVIEWED" ? (
            caps.finalise && editable ? (
              <div className="space-y-2 border-t border-line pt-3">
                <p className="text-sm text-muted">Reviewed by {working.reviewed_by_name ?? "—"} {dateTimeText(working.reviewed_at)}. Finalising freezes this revision with a snapshot of the notes, decisions, actions and risks. Later changes become a new revision.</p>
                <Button disabled={pending || s.status !== "COMPLETED" || starting} title={s.status !== "COMPLETED" ? "Complete the session first" : undefined}
                  onClick={async () => { setStarting(true); await run(() => apiRequest("POST", `okr-minutes/${working.id}/finalise`, { expectedVersion: working.version, key: newKey() }), { success: "Minutes finalised." }); setStarting(false); }}>Finalise the minutes</Button>
              </div>
            ) : <p className="text-sm text-muted">Reviewed. Waiting for someone who can finalise minutes.</p>
          ) : null}
        </Card>
      ) : canStart ? (
        <Card className="space-y-3 p-4">
          <p className="text-sm text-muted">{final ? "These minutes are final. To correct them, start an amendment: it becomes a new revision that goes through review again, and revision " + final.revision + " is kept as it is." : "Build the minutes from what was recorded in the session, then edit them."}</p>
          {caps.viewAll ? <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={management} onChange={(e) => setManagement(e.target.checked)} /> Management minutes (include management-only notes)</label> : null}
          <div><Button disabled={pending} onClick={async () => {
            const g = await run(generate, { refresh: false });
            if (!g) return;
            const saved = await run(() => apiRequest("POST", `okr-sessions/${s.id}/minutes`, { content: g.value, audience: management ? "MANAGEMENT" : "PARTICIPANTS", key: newKey() }), { success: final ? "Amendment started." : "Draft minutes created." });
            if (saved) { setText(g.value); setDirty(false); }
          }}>{final ? "Start an amendment" : "Prepare the minutes"}</Button></div>
        </Card>
      ) : null}

      {ws.minutes.length > 1 || (ws.minutes.length === 1 && !final) ? (
        <Card className="p-4"><h3 className="text-sm font-semibold text-ink">Revisions</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {ws.minutes.map((m: MinutesRow) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>Revision {m.revision} <MinutesStatusBadge status={m.status} /> <span className="text-muted">by {m.created_by_name ?? "—"}, {dateTimeText(m.created_at)}{m.finalised_at ? `, finalised ${dateTimeText(m.finalised_at)}` : ""}</span></span>
                {caps.export ? <a className="text-brand-700 underline" href={`/api/v1/okr-sessions/${s.id}/export?format=pdf&revision=${m.revision}`}>PDF</a> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}


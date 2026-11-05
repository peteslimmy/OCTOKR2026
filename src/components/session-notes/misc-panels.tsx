"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge, Banner, Button, Card, EmptyState } from "@/components/ui/primitives";
import { ApiFailure, apiRequest, useAction } from "@/components/ui/client";
import type { Person, Workspace } from "@/lib/session-notes/types";
import { DialogForm, PersonF, SelectF, TextF } from "./forms";
import { RichText, dateText, dateTimeText } from "./common";
import type { Caps } from "./workspace";

const ROLE = (r: string) => r.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function OverviewPanel({ ws, caps, editable, people }: { ws: Workspace; caps: Caps; editable: boolean; people: Person[] }) {
  const s = ws.session;
  const { run } = useAction();
  const [who, setWho] = useState("");
  const [role, setRole] = useState("ATTENDEE");
  const runs = ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise;
  const active = ws.participants.filter((p) => !p.removed_at);
  const open = ws.actions.filter((a) => ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(a.status)).length;
  const weekClosed = s.week?.status === "FINAL_LOCKED" || s.quarter_status === "LOCKED";
  return (
    <div className="space-y-4">
      {weekClosed ? <Banner tone="info" title="The reporting week or quarter is closed">This session is documentation and stays open for notes, decisions and actions. It never changes the week&apos;s report, scores or compliance.</Banner> : null}
      {!s.reporting_week_id ? <Banner tone="info" title="No reporting week">This session is not tied to a reporting week{s.quarter_label ? `; it belongs to ${s.quarter_label} by its date` : ""}.</Banner> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-4 lg:col-span-2">
          <h2 className="text-base font-semibold text-ink">About this session</h2>
          {s.description ? <p className="text-sm text-ink">{s.description}</p> : <p className="text-sm text-muted">No description.</p>}
          <div>
            <h3 className="text-sm font-medium text-ink">Agenda</h3>
            {s.agenda ? <div className="mt-1"><RichText md={s.agenda} /></div> : <p className="text-sm text-muted">No agenda recorded.</p>}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Notes</dt><dd className="text-lg font-semibold">{ws.notes.filter((n) => n.status === "ACTIVE").length}</dd></div>
            <div><dt className="text-muted">Decisions</dt><dd className="text-lg font-semibold">{ws.decisions.length}</dd></div>
            <div><dt className="text-muted">Open actions</dt><dd className="text-lg font-semibold">{open}</dd></div>
            <div><dt className="text-muted">Risks recorded</dt><dd className="text-lg font-semibold">{ws.risks.length}</dd></div>
          </dl>
          {s.attendance_session ? <p className="text-xs text-muted">Related attendance session: {dateText(s.attendance_session.session_date)} ({s.attendance_session.outcome.toLowerCase()}). Attendance is governed separately by HR and is not changed here.</p> : null}
          {s.completed_at ? <p className="text-xs text-muted">Completed {dateTimeText(s.completed_at)} by {s.completed_by_name ?? "—"}.</p> : null}
        </Card>
        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold text-ink">Participants ({active.length})</h2>
          <ul className="divide-y divide-line text-sm">
            {active.map((p) => (
              <li key={p.user_id} className="flex items-center justify-between gap-2 py-1.5">
                <span>{p.name ?? "Unknown"} <span className="text-muted">· {ROLE(p.role)}</span></span>
                {runs && editable && p.role !== "FACILITATOR" ? <Button size="sm" variant="ghost" onClick={() => void run(() => apiRequest("POST", `okr-sessions/${s.id}/participants`, { userId: p.user_id, remove: true }), { success: "Removed from the session." })}>Remove</Button> : null}
              </li>
            ))}
          </ul>
          {ws.participants.some((p) => p.removed_at) ? <p className="text-xs text-muted">{ws.participants.filter((p) => p.removed_at).length} removed earlier (kept in the history).</p> : null}
          {runs && editable ? (
            <div className="space-y-2 border-t border-line pt-3">
              <PersonF id="p-who" label="Invite" people={people.filter((p) => p.can_view_sessions && !active.some((x) => x.user_id === p.id))} value={who} onChange={setWho} unit={s.business_unit_id} />
              <SelectF id="p-role" label="As" value={role} onChange={setRole} options={[["ATTENDEE", "Attendee"], ["PRESENTER", "Presenter"], ["BU_LEAD", "BU Lead"], ["OBSERVER", "Observer"]]} />
              <Button size="sm" disabled={!who} onClick={async () => { const r = await run(() => apiRequest("POST", `okr-sessions/${s.id}/participants`, { userId: who, role }), { success: "Invited." }); if (r) setWho(""); }}>Invite</Button>
              <p className="text-xs text-muted">An invited person can read this session&apos;s shared notes, whatever their unit.</p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export function AttachmentsPanel({ ws, caps, editable }: { ws: Workspace; caps: Caps; editable: boolean }) {
  const s = ws.session;
  const { run } = useAction();
  const [target, setTarget] = useState(`SESSION:${s.id}`);
  const [why, setWhy] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const runs = ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise;
  const targets: [string, string][] = [
    [`SESSION:${s.id}`, "The session as a whole"],
    ...ws.notes.filter((n) => n.status === "ACTIVE").map((n) => [`NOTE:${n.id}`, `Note: ${n.title ?? n.content.slice(0, 40) ?? "untitled"}`] as [string, string]),
    ...ws.actions.map((a) => [`ACTION:${a.id}`, `Action ${a.reference}`] as [string, string]),
    ...(caps.decisionsCreate ? ws.decisions.map((d) => [`DECISION:${d.id}`, `Decision ${d.reference}`] as [string, string]) : []),
    ...(caps.risksManage ? ws.risks.map((r) => [`RISK:${r.id}`, `Risk ${r.reference}`] as [string, string]) : []),
  ];
  const upload = async (f: File) => {
    const [recordType, recordId] = target.split(":");
    const form = new FormData();
    form.append("file", f);
    form.append("metadata", JSON.stringify({ recordType, recordId, purpose: recordType === "ACTION" ? "COMPLETION_EVIDENCE" : "SUPPORTING" }));
    const res = await fetch(`/api/v1/okr-sessions/${s.id}/attachments`, { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiFailure(json?.error?.code ?? "ERROR", json?.error?.message ?? "The file could not be uploaded. Nothing was saved.", res.status);
  };
  const label = (a: Workspace["attachments"][number]) => targets.find(([v]) => v === `${a.record_type}:${a.record_id}`)?.[1] ?? a.record_type.toLowerCase();
  return (
    <div className="space-y-4">
      <h2 className="sr-only">Attachments</h2>
      {caps.create && editable ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold text-ink">Attach a file</h2>
          <SelectF id="att-target" label="Attach to" value={target} onChange={setTarget} options={targets} />
          <input ref={input} type="file" className="sr-only" aria-label="Choose a file to attach" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await run(() => upload(f), { success: "File attached." }); }} />
          <Button onClick={() => input.current?.click()}>Choose a file…</Button>
          <p className="text-xs text-muted">PDF, images, Word, Excel or text, up to 50 MiB. The file&apos;s contents are checked against its type, and it is stored privately.</p>
        </Card>
      ) : null}
      {ws.attachments.length === 0 ? <Card><EmptyState title="No attachments" /></Card> : (
        <Card className="divide-y divide-line">
          {ws.attachments.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div><a className="font-medium text-brand-700 underline" href={`/api/v1/okr-attachments/${a.id}`}>{a.file_name}</a> {a.purpose === "COMPLETION_EVIDENCE" ? <Badge tone="done">Completion evidence</Badge> : null}
                <p className="text-xs text-muted">{label(a)} · {(a.size_bytes / 1024).toFixed(a.size_bytes > 1024 * 100 ? 0 : 1)} KB · {a.uploaded_by_name ?? "—"}, {dateTimeText(a.uploaded_at)}</p></div>
              {editable && (runs || a.uploaded_by_name) && caps.create ? (
                <DialogForm label="Remove" variant="ghost" title="Remove this attachment?" description="It stops being listed. The record of it and the stored file are kept." submitLabel="Remove" success="Attachment removed." canSubmit={why.trim().length > 0} onOpen={() => setWhy("")}
                  onSubmit={() => apiRequest("POST", `okr-attachments/${a.id}/remove`, { reason: why.trim() })}>
                  <TextF id={`rm-${a.id}`} label="Why?" value={why} onChange={setWhy} required max={1000} />
                </DialogForm>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

const EVENT_TEXT: Record<string, string> = {
  CREATED: "created", UPDATED: "changed", STATUS_IN_PROGRESS: "started the session", STATUS_COMPLETED: "completed the session", STATUS_ARCHIVED: "archived the session", STATUS_DRAFT: "restored the session to draft",
  PARTICIPANT_ADDED: "invited a participant", PARTICIPANT_REMOVED: "removed a participant", AMENDED: "amended", RECLASSIFIED: "changed who can read", ARCHIVED: "archived", RESTORED: "restored", ADDED_AFTER_COMPLETION: "added after completion",
  LINK_ADDED: "linked to an OKR component", LINK_REMOVED: "removed a link", PROPOSED: "proposed", APPROVED: "approved", REJECTED: "rejected", WITHDRAWN: "withdrew", SUPERSEDED: "superseded",
  STATUS_OPEN: "reopened", STATUS_BLOCKED: "marked blocked", STATUS_COMPLETED_: "completed", PROGRESS: "reported progress", REASSIGNED: "reassigned", DUE_EXTENDED: "extended the deadline", ESCALATED: "escalated",
  REVIEWED_IN_SESSION: "reviewed in a session", VERIFICATION_VERIFIED: "verified the completion", VERIFICATION_REJECTED: "sent the completion back", DRAFT_STARTED: "started a draft", DRAFT_SAVED: "saved the draft",
  SUBMITTED: "submitted for review", REVIEWED: "reviewed", RETURNED: "returned for changes", FINALISED: "finalised", ADDED: "added", REMOVED: "removed", EXPORTED: "exported",
  AI_SUMMARY_PROPOSED: "asked for an AI summary", AI_SUMMARY_FAILED: "asked for an AI summary (none produced)", STATUS_IN_PROGRESS_: "started",
};

export function HistoryPanel({ ws }: { ws: Workspace }) {
  const [kind, setKind] = useState("");
  const rows = ws.events.filter((e) => !kind || e.record_type === kind);
  const text = (e: Workspace["events"][number]) => EVENT_TEXT[e.event_type] ?? e.event_type.replace(/^STATUS_/, "set to ").replace(/_/g, " ").toLowerCase();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="ev-kind" className="text-sm text-muted">Show</label>
        <select id="ev-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">
          <option value="">Everything</option>{["SESSION", "NOTE", "DECISION", "ACTION", "RISK", "MINUTES", "ATTACHMENT"].map((k) => <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}s</option>)}
        </select>
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing in the history yet" /> : (
          <ol className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.seq} className="px-4 py-3 text-sm">
                <p><strong className="text-ink">{e.actor_name ?? "The system"}</strong> {text(e)} <Badge tone="undefined">{e.record_type.toLowerCase()}</Badge>
                  {typeof e.details?.reference === "string" ? <span className="ml-1 font-mono text-xs text-muted">{e.details.reference}</span> : null}
                  {typeof e.details?.origin_session_id === "string" && e.details.origin_session_id !== undefined ? <span className="ml-1 text-xs text-muted">(commitment from another session: <Link className="underline" href={`/session-notes/${e.details.origin_session_id}?tab=history`}>open</Link>)</span> : null}</p>
                {e.remarks ? <p className="mt-0.5 text-muted">“{e.remarks}”</p> : null}
                <p className="text-xs text-muted">{dateTimeText(e.occurred_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <p className="text-xs text-muted">This is the permanent record of what happened in this session. Entries cannot be changed or removed.</p>
    </div>
  );
}

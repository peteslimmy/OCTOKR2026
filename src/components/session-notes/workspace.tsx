"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { apiRequest, useAction } from "@/components/ui/client";
import { SAVE_LABEL, type SaveState } from "@/lib/session-notes/autosave";
import type { NoteRow, Outstanding, Workspace as Ws } from "@/lib/session-notes/types";
import { DialogForm, TextF, AreaF } from "./forms";
import { LinkChips, SessionStatusBadge, dateText, newKey, usePeople } from "./common";
import { MinutesPanel } from "./minutes-panel";
import { AttachmentsPanel, HistoryPanel, OverviewPanel } from "./misc-panels";
import { NotesPanel } from "./notes-panel";
import { ActionsPanel, DecisionsPanel, RisksPanel, type Prefill } from "./registers-panels";

export interface Caps {
  create: boolean; update: boolean; finalise: boolean; archive: boolean; export: boolean; viewAll: boolean;
  decisionsCreate: boolean; decisionsApprove: boolean; actionsCreate: boolean; actionsAssign: boolean; actionsUpdate: boolean; actionsVerify: boolean; risksManage: boolean;
  buId: string | null; viewerId: string;
}
function StartButton({ sessionId, version }: { sessionId: string; version: number }) {
  const { run, pending } = useAction();
  return <Button disabled={pending} onClick={() => void run(() => apiRequest("POST", `okr-sessions/${sessionId}/transition`, { to: "IN_PROGRESS", expectedVersion: version, key: newKey() }), { success: "Session started." })}>Start session</Button>;
}

export interface Performance { submission_status: string; final_score: number | null; compliance: string | null; report_status: string | null }

const TABS = [
  ["overview", "Overview"], ["notes", "Discussion notes"], ["decisions", "Decisions"], ["actions", "Action items"], ["risks", "Risks & blockers"], ["attachments", "Attachments"], ["minutes", "Minutes"], ["history", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

export function SessionWorkspace({ ws, outstanding, caps, performance, presentationHref, initialTab }: { ws: Ws; outstanding: Outstanding | null; caps: Caps; performance: Performance | null; presentationHref: string | null; initialTab: string | null }) {
  const s = ws.session;
  const { people } = usePeople();
  const [tab, setTab] = useState<Tab>((TABS.find(([t]) => t === initialTab)?.[0] ?? "notes") as Tab);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const states = useRef(new Map<string, SaveState>());
  const [why, setWhy] = useState("");
  const [title, setTitle] = useState(s.title);
  const [date, setDate] = useState(s.session_date);
  const [desc, setDesc] = useState(s.description ?? "");
  const [agenda, setAgenda] = useState(s.agenda ?? "");

  const editable = s.status !== "ARCHIVED";
  const runs = ws.viewer.is_facilitator || ws.viewer.is_creator || caps.finalise;

  // the header shows the worst save state of any open note editor
  useEffect(() => {
    const order: SaveState[] = ["saved", "dirty", "saving", "retrying", "conflict", "failed"];
    const on = (e: Event) => {
      const { id, state } = (e as CustomEvent<{ id: string; state: SaveState }>).detail;
      if (state === "saved") states.current.delete(id); else states.current.set(id, state);
      setSave([...states.current.values()].reduce<SaveState>((w, x) => (order.indexOf(x) > order.indexOf(w) ? x : w), "saved"));
    };
    window.addEventListener("okr:savestate", on);
    return () => window.removeEventListener("okr:savestate", on);
  }, []);

  const go = (t: Tab) => { setTab(t); try { const u = new URL(window.location.href); u.searchParams.set("tab", t); window.history.replaceState(null, "", u); } catch { /* the URL is a convenience only */ } };
  const convert = (kind: Prefill["kind"], note: NoteRow) => { setPrefill({ kind, note }); go(kind === "decision" ? "decisions" : kind === "action" ? "actions" : "risks"); };

  const transition = (to: string, reason?: string) => apiRequest("POST", `okr-sessions/${s.id}/transition`, { to, reason: reason || undefined, expectedVersion: s.version, key: newKey() });
  const openActions = ws.actions.filter((a) => ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(a.status)).length;

  const allLinks = useMemo(() => {
    const seen = new Map<string, Ws["notes"][number]["links"][number]>();
    for (const l of [...ws.notes.flatMap((n) => n.links), ...ws.decisions.flatMap((d) => d.links), ...ws.actions.flatMap((a) => a.links), ...ws.risks.flatMap((r) => r.links)]) seen.set(`${l.target_type}:${l.target_id}`, l);
    return [...seen.values()];
  }, [ws]);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    go(TABS[n][0]); tabRefs.current[n]?.focus();
  };

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-line bg-panel p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted"><Link href="/session-notes" className="underline">OKR session notes</Link> / <span className="font-mono">{s.reference}</span></p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{s.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <SessionStatusBadge status={s.status} /><span>{s.type_name}</span><span>{s.business_unit_name ?? "Organisation-wide"}</span><span>{s.quarter_label ?? "No quarter"}{s.week ? ` · week ${s.week.week_number}` : " · no reporting week"}</span>
              <span>{dateText(s.session_date)}</span><span>Facilitator: {s.facilitator_name ?? "—"}</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p role="status" aria-live="polite" className="inline-flex items-center gap-2 text-sm text-muted" data-testid="header-save-state" data-state={save}>
              <span className={`inline-block size-2 rounded-full ${save === "saved" ? "bg-[var(--done-fg)]" : save === "failed" || save === "conflict" ? "bg-[var(--critical-fg)]" : "bg-[var(--warn-fg)]"}`} aria-hidden />
              {save === "saved" ? "All changes saved" : SAVE_LABEL[save]}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {presentationHref ? <Link href={presentationHref} className="inline-flex min-h-8 items-center rounded-lg border border-line bg-panel px-3 text-sm hover:bg-surface">Back to presentation</Link> : null}
              {caps.export ? <a className="inline-flex min-h-8 items-center rounded-lg border border-line bg-panel px-3 text-sm hover:bg-surface" href={`/api/v1/okr-sessions/${s.id}/export?format=pdf`}>Minutes PDF</a> : null}
              {runs && caps.update && editable ? (
                <DialogForm label="Edit details" title="Session details" description={s.status === "COMPLETED" ? "This session is completed: say why it is being changed." : undefined} submitLabel="Save details" success="Details saved."
                  canSubmit={title.trim().length > 0 && (s.status !== "COMPLETED" || why.trim().length > 0)} onOpen={() => { setTitle(s.title); setDate(s.session_date); setDesc(s.description ?? ""); setAgenda(s.agenda ?? ""); setWhy(""); }}
                  onSubmit={() => apiRequest("PATCH", `okr-sessions/${s.id}`, { expectedVersion: s.version, title: title.trim(), date, description: desc.trim() || null, agenda: agenda.trim() || null, startsAt: s.starts_at, endsAt: s.ends_at, attendanceSessionId: s.governance_session_id, reason: why.trim() || undefined })}>
                  <TextF id="sd-title" label="Title" value={title} onChange={setTitle} required max={200} />
                  <TextF id="sd-date" label="Session date" type="date" value={date} onChange={setDate} required />
                  <AreaF id="sd-desc" label="Description" value={desc} onChange={setDesc} max={4000} />
                  <AreaF id="sd-agenda" label="Agenda" value={agenda} onChange={setAgenda} rows={5} max={20000} hint="You can use the same formatting as notes." />
                  {s.status === "COMPLETED" ? <TextF id="sd-why" label="Why is it being changed?" value={why} onChange={setWhy} required max={2000} /> : null}
                </DialogForm>
              ) : null}
              {s.status === "DRAFT" && runs && caps.update ? <StartButton sessionId={s.id} version={s.version} /> : null}
              {s.status === "IN_PROGRESS" && runs && caps.update ? (
                <DialogForm label="Complete session…" variant="primary" size="md" title="Complete this session?" description={`Completing keeps everything and its history. ${openActions} action${openActions === 1 ? " is" : "s are"} still open and stay open. You can reopen the session if this was a mistake.`} submitLabel="Complete session" success="Session completed." onSubmit={() => transition("COMPLETED")}>
                  <p className="text-sm text-muted">After completion, changes to notes are recorded as amendments with a reason, and the minutes can be finalised.</p>
                </DialogForm>
              ) : null}
              {s.status === "COMPLETED" && runs && caps.update ? (
                <DialogForm label="Reopen…" title="Reopen this session?" description="Use this if it was completed by mistake. Finalised minutes stay as they are." submitLabel="Reopen" success="Session reopened." canSubmit={why.trim().length > 0} onOpen={() => setWhy("")} onSubmit={() => transition("IN_PROGRESS", why.trim())}>
                  <TextF id="ro-why" label="Why?" value={why} onChange={setWhy} required max={2000} />
                </DialogForm>
              ) : null}
              {(s.status === "DRAFT" || s.status === "COMPLETED") && caps.archive ? (
                <DialogForm label="Archive…" variant="ghost" title="Archive this session?" description={openActions ? `${openActions} action${openActions === 1 ? " is" : "s are"} still open. They are not cancelled; they stay open and are still followed up.` : "It stays searchable and can be restored."} submitLabel="Archive" success="Session archived." canSubmit={why.trim().length > 0} onOpen={() => setWhy("")} onSubmit={() => transition("ARCHIVED", why.trim())}>
                  <TextF id="ar-why" label="Why?" value={why} onChange={setWhy} required max={2000} />
                </DialogForm>
              ) : null}
              {s.status === "ARCHIVED" && caps.archive ? (
                <DialogForm label="Restore…" title="Restore this session?" submitLabel="Restore" success="Session restored." canSubmit={why.trim().length > 0} onOpen={() => setWhy("")} onSubmit={() => transition("RESTORED", why.trim())}>
                  <TextF id="rs-why" label="Why?" value={why} onChange={setWhy} required max={2000} />
                </DialogForm>
              ) : null}
            </div>
          </div>
        </div>
        {s.status === "ARCHIVED" ? <p className="mt-3 rounded bg-[var(--locked-bg)] px-3 py-2 text-sm text-[var(--locked-fg)]">This session is archived and read-only. It stays searchable. {openActions ? `${openActions} of its actions are still open.` : ""}</p> : null}
        {s.status === "COMPLETED" ? <p className="mt-3 text-xs text-muted">This session is completed. Changes to its notes are kept as amendments with the earlier version and the reason.</p> : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Session sections" className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map(([t, label], i) => {
              const count = t === "notes" ? ws.notes.filter((n) => n.status === "ACTIVE").length : t === "decisions" ? ws.decisions.length : t === "actions" ? ws.actions.length : t === "risks" ? ws.risks.length : t === "attachments" ? ws.attachments.length : null;
              return (
                <button key={t} ref={(el) => { tabRefs.current[i] = el; }} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1} type="button" onClick={() => go(t)} onKeyDown={(e) => onKey(e, i)}
                  className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>
                  {label}{count ? <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-xs">{count}</span> : null}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" ? <OverviewPanel ws={ws} caps={caps} editable={editable} people={people} /> : null}
            {tab === "notes" ? <NotesPanel ws={ws} caps={caps} editable={editable} onConvert={convert} /> : null}
            {tab === "decisions" ? <DecisionsPanel ws={ws} caps={caps} editable={editable} people={people} prefill={prefill} clearPrefill={() => setPrefill(null)} /> : null}
            {tab === "actions" ? <ActionsPanel ws={ws} caps={caps} editable={editable} people={people} outstanding={outstanding} prefill={prefill} clearPrefill={() => setPrefill(null)} /> : null}
            {tab === "risks" ? <RisksPanel ws={ws} caps={caps} editable={editable} people={people} outstanding={outstanding} prefill={prefill} clearPrefill={() => setPrefill(null)} /> : null}
            {tab === "attachments" ? <AttachmentsPanel ws={ws} caps={caps} editable={editable} /> : null}
            {tab === "minutes" ? <MinutesPanel ws={ws} caps={caps} editable={editable} /> : null}
            {tab === "history" ? <HistoryPanel ws={ws} /> : null}
          </div>
        </div>

        <aside aria-label="Session context" className="space-y-4">
          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold text-ink">Context</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Unit</dt><dd className="text-right">{s.business_unit_name ?? "Organisation-wide"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Quarter</dt><dd className="text-right">{s.quarter_label ?? "—"}{s.quarter_status === "LOCKED" ? " (locked)" : ""}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Reporting week</dt><dd className="text-right">{s.week ? `Week ${s.week.week_number}, ${s.week.week_year}${s.week.status === "FINAL_LOCKED" ? " (final)" : ""}` : "—"}</dd></div>
              {performance ? (
                <>
                  <div className="flex justify-between gap-2"><dt className="text-muted">Weekly report</dt><dd className="text-right">{performance.submission_status === "SUBMITTED" ? "Submitted" : "Not submitted"}</dd></div>
                  {performance.final_score !== null ? <div className="flex justify-between gap-2"><dt className="text-muted">Score</dt><dd className="text-right">{performance.final_score}</dd></div> : null}
                </>
              ) : null}
            </dl>
            {performance ? <p className="text-xs text-muted">Read from the weekly report. Session notes never change it.</p> : null}
          </Card>
          {outstanding && (outstanding.actions.length > 0 || outstanding.risks.length > 0) ? (
            <Card className="space-y-2 p-4" data-testid="outstanding-card">
              <h2 className="text-sm font-semibold text-ink">To review from earlier sessions</h2>
              <ul className="text-sm">
                {outstanding.actions.length ? <li><button type="button" className="text-brand-700 underline" onClick={() => go("actions")}>{outstanding.actions.length} open commitment{outstanding.actions.length === 1 ? "" : "s"}</button>{outstanding.actions.some((a) => a.overdue) ? <> <Badge tone="critical">{outstanding.actions.filter((a) => a.overdue).length} overdue</Badge></> : null}</li> : null}
                {outstanding.risks.length ? <li><button type="button" className="text-brand-700 underline" onClick={() => go("risks")}>{outstanding.risks.length} open risk{outstanding.risks.length === 1 ? "" : "s"}</button></li> : null}
              </ul>
            </Card>
          ) : null}
          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold text-ink">Linked OKR components</h2>
            {allLinks.length ? <LinkChips links={allLinks} /> : <p className="text-sm text-muted">Nothing is linked yet. Link a note to a key result, goal or task from its card.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, NativeSelect } from "@/components/ui/primitives";
import { ApiFailure, apiRequest, toast } from "@/components/ui/client";
import { AUTOSAVE_DELAY_MS, NOTE_CATEGORIES, NOTE_VISIBILITY } from "@/lib/session-notes/constants";
import { SAVE_LABEL, draftStorageKey, isTransient, needsLeaveGuard, readDraft, retryDelay, type Draft, type SaveState } from "@/lib/session-notes/autosave";
import { heading, insertLink, insertTable, prefixLines, wrap, type Sel } from "@/lib/session-notes/editor-ops";
import type { NoteRow, Workspace } from "@/lib/session-notes/types";
import { RichText } from "./common";
import { VisualEditor, type Mentionable } from "./visual-editor";

const keyOf = (v: { title: string; category: string; visibility: string; content: string }) => JSON.stringify([v.title, v.category, v.visibility, v.content]);
const DOT: Record<SaveState, string> = { saved: "bg-[var(--done-fg)]", dirty: "bg-[var(--warn-fg)]", saving: "bg-[var(--info-fg)]", failed: "bg-[var(--critical-fg)]", retrying: "bg-[var(--warn-fg)]", conflict: "bg-[var(--critical-fg)]" };

const TOOLS: { label: string; text: string; op: (s: Sel) => Sel; cls?: string }[] = [
  { label: "Heading", text: "H1", op: (s) => heading(s, 1) }, { label: "Subheading", text: "H2", op: (s) => heading(s, 2) },
  { label: "Bold (Ctrl+B)", text: "B", op: (s) => wrap(s, "**"), cls: "font-bold" }, { label: "Italic (Ctrl+I)", text: "I", op: (s) => wrap(s, "_"), cls: "italic" },
  { label: "Bulleted list", text: "• List", op: (s) => prefixLines(s, "- ") }, { label: "Numbered list", text: "1. List", op: (s) => prefixLines(s, "1.") },
  { label: "Checklist", text: "☑ Checklist", op: (s) => prefixLines(s, "- [ ] ") }, { label: "Quote", text: "❝", op: (s) => prefixLines(s, "> ") },
  { label: "Table", text: "Table", op: (s) => insertTable(s) },
];

function initialDraft(note: NoteRow): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const d = readDraft(localStorage.getItem(draftStorageKey(note.id)));
    if (d && keyOf({ title: d.title, category: d.category || note.category, visibility: d.visibility || note.visibility, content: d.content }) !== keyOf({ title: note.title ?? "", category: note.category, visibility: note.visibility, content: note.content })) return d;
  } catch { /* storage unavailable: nothing to recover */ }
  return null;
}

/**
 * The note editor: a text area with a formatting toolbar and a live preview, an autosave that never discards what was typed (saving, saved, unsaved, failed, retrying),
 * an optimistic-concurrency check on every save, a local copy of unsent text that survives a refresh or a lost connection, and a guard on leaving the page.
 * In a completed session saving is deliberate (an amendment with a reason) rather than automatic.
 */
export function NoteEditor({ note, amend, onClose, mentionable = [], simple = false }: { note: NoteRow; amend: boolean; onClose: (changed: boolean) => void; mentionable?: Mentionable[]; simple?: boolean }) {
  const [title, setTitle] = useState(note.title ?? "");
  const [category, setCategory] = useState<string>(note.category);
  const [visibility, setVisibility] = useState<string>(note.visibility);
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<SaveState>("saved");
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [recovered, setRecovered] = useState<Draft | null>(() => initialDraft(note));
  const [theirs, setTheirs] = useState<NoteRow | null>(null);
  const [mode, setMode] = useState<"visual" | "markdown">(() => { try { return localStorage.getItem("okr-note-editor-mode") === "markdown" ? "markdown" : "visual"; } catch { return "visual"; } });
  const chooseMode = (m: "visual" | "markdown") => { setMode(m); try { localStorage.setItem("okr-note-editor-mode", m); } catch { /* a convenience only */ } };
  const taRef = useRef<HTMLTextAreaElement>(null);
  const selRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const base = useRef(note.version);
  const lastSaved = useRef(keyOf({ title: note.title ?? "", category: note.category, visibility: note.visibility, content: note.content }));
  const latest = useRef({ title: note.title ?? "", category: note.category as string, visibility: note.visibility as string, content: note.content });
  const inFlight = useRef(false);
  const again = useRef(false);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useRef(false);
  const statusRef = useRef<SaveState>("saved");
  const reasonRef = useRef("");
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const touched = useRef(false);
  const overwrite = useRef(false);   // set when the person chose to save over someone else's newer version: the version being replaced is then always kept

  // the refs always hold what is on screen, for the save that runs after a pause or while the page closes
  useEffect(() => { latest.current = { title, category, visibility, content }; reasonRef.current = reason; });

  const set = useCallback((s: SaveState) => {
    statusRef.current = s;
    setStatus(s);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("okr:savestate", { detail: { id: note.id, state: s } }));   // the session header shows the worst state of any open editor
  }, [note.id]);

  const stash = useCallback(() => {
    try { localStorage.setItem(draftStorageKey(note.id), JSON.stringify({ ...latest.current, baseVersion: base.current, at: new Date().toISOString() } satisfies Draft)); } catch { /* storage unavailable */ }
  }, [note.id]);
  const unstash = useCallback(() => { try { localStorage.removeItem(draftStorageKey(note.id)); } catch { /* storage unavailable */ } }, [note.id]);

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) { again.current = true; return false; }
    const snap = latest.current;
    const k = keyOf(snap);
    if (k === lastSaved.current) { set("saved"); return true; }
    if (amend && reasonRef.current.trim() === "") { setError("Say why this completed session's note is being changed."); return false; }
    inFlight.current = true;
    setError(null);
    set(attempt.current > 0 ? "retrying" : "saving");
    try {
      const res = await apiRequest<{ version: number; unchanged?: boolean }>("PATCH", `okr-notes/${note.id}`, {
        expectedVersion: base.current, title: snap.title, category: snap.category, visibility: snap.visibility, content: snap.content, ...(amend ? { reason: reasonRef.current.trim() } : {}), ...(overwrite.current ? { keepReplaced: true } : {}),
      });
      overwrite.current = false;
      base.current = res.version;
      lastSaved.current = k;
      attempt.current = 0; setTries(0);
      changed.current = true;
      inFlight.current = false;
      if (keyOf(latest.current) !== k) { set("dirty"); stash(); if (!amend) timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS); } else { set("saved"); unstash(); }
      if (again.current) { again.current = false; void saveRef.current(); }
      return true;
    } catch (e) {
      inFlight.current = false;
      const f = e as ApiFailure;
      stash();
      if (f.code === "VERSION_CONFLICT") {
        set("conflict");
        apiRequest<Workspace>("GET", `okr-sessions/${note.session_id}`).then((w) => setTheirs(w.notes.find((n) => n.id === note.id) ?? null)).catch(() => undefined);
      } else if (isTransient(e)) {
        const d = retryDelay(attempt.current);
        attempt.current += 1; setTries(attempt.current);
        if (d === null) { set("failed"); setError("The connection to the server is not working. Your text is kept on this device; use Retry when the connection is back."); }
        else { set("retrying"); timer.current = setTimeout(() => void saveRef.current(), d); }
      } else {
        set("failed");
        setError(f.message || "The note could not be saved.");
      }
      return false;
    }
  }, [amend, note.id, note.session_id, set, stash, unstash]);
  useEffect(() => { saveRef.current = save; }, [save]);

  // autosave: a short pause after the last keystroke
  useEffect(() => {
    if (!touched.current) { touched.current = true; return; }
    if (keyOf({ title, category, visibility, content }) === lastSaved.current) return;
    if (statusRef.current !== "conflict" && statusRef.current !== "failed") set("dirty");
    stash();
    if (amend || statusRef.current === "conflict" || statusRef.current === "failed") return;
    const t = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
    timer.current = t;
    return () => clearTimeout(t);
  }, [title, category, visibility, content, amend, set, stash]);

  // leaving the page: warn while anything is unsaved, and make one last attempt to send it
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (needsLeaveGuard(statusRef.current)) { e.preventDefault(); e.returnValue = ""; } };
    const flush = () => {
      if (!needsLeaveGuard(statusRef.current) || amend || statusRef.current === "conflict" || keyOf(latest.current) === lastSaved.current || latest.current.content.length > 40000) return;
      void fetch(`/api/v1/okr-notes/${note.id}`, { method: "PATCH", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: base.current, ...latest.current }) }).catch(() => undefined);
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", warn); window.removeEventListener("pagehide", flush);
      if (timer.current) clearTimeout(timer.current);
      flush();   // moving to another page of the app while text is unsent: one last attempt (the text is also kept on this device)
      window.dispatchEvent(new CustomEvent("okr:savestate", { detail: { id: note.id, state: "saved" } }));
    };
  }, [note.id, amend]);

  const finish = async () => {
    let ok = await save();
    while (!ok && inFlight.current) { await new Promise((r) => setTimeout(r, 150)); ok = await save(); }
    if (keyOf(latest.current) !== lastSaved.current) { toast.error("Your latest text is not saved yet, so the editor stays open. Fix the problem shown, or copy your text first."); return; }
    onClose(changed.current);
  };

  // ---- toolbar: each operation is applied to the text area's current text and selection, and written back as one undoable edit
  const commit = (r: Sel) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    // execCommand keeps the browser's own undo/redo history; setContent is the fallback when it is unavailable
    const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, r.value);
    if (!ok) setContent(r.value);
    requestAnimationFrame(() => { ta.setSelectionRange(r.start, r.end); selRef.current = { start: r.start, end: r.end }; });
  };
  const apply = (op: (s: Sel) => Sel) => { const ta = taRef.current; if (ta) commit(op({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd })); };
  const undoRedo = (cmd: "undo" | "redo") => { taRef.current?.focus(); document.execCommand(cmd); };

  const dis = status === "conflict";
  const btn = "rounded-md border border-line bg-panel px-2 py-1 text-xs font-medium text-ink hover:bg-surface focus-visible:outline-2 disabled:opacity-50";

  return (
    <div className="space-y-3" data-testid="note-editor">
      {recovered ? (
        <div role="alert" className="rounded-lg border border-[#fde68a] bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-fg)]">
          <p>Unsent changes from {new Date(recovered.at).toLocaleString("en-GB")} were found on this device.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => { setTitle(recovered.title); if (recovered.category) setCategory(recovered.category); if (recovered.visibility) setVisibility(recovered.visibility); setContent(recovered.content); setRecovered(null); }}>Restore them</Button>
            <Button size="sm" variant="secondary" onClick={() => { unstash(); setRecovered(null); }}>Discard them</Button>
          </div>
        </div>
      ) : null}

      {simple ? null : <div className="grid gap-2 sm:grid-cols-[1fr_12rem_12rem]">
        <Input aria-label="Note title (optional)" placeholder="Title (optional)" value={title} maxLength={200} disabled={dis} onChange={(e) => setTitle(e.target.value)} />
        <NativeSelect aria-label="Category" value={category} disabled={dis} onChange={(e) => setCategory(e.target.value)}>{NOTE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</NativeSelect>
        <NativeSelect aria-label="Who can read this note" value={visibility} disabled={dis} onChange={(e) => setVisibility(e.target.value)}>{NOTE_VISIBILITY.map((v) => <option key={v.code} value={v.code}>{v.label.split(" with")[0]}</option>)}</NativeSelect>
      </div>}

      {simple ? null : <div role="group" aria-label="Editor mode" className="inline-flex rounded-md border border-line p-0.5 text-xs">
        <button type="button" aria-pressed={mode === "visual"} className={`rounded px-2 py-1 ${mode === "visual" ? "bg-brand-100 font-semibold" : ""}`} onClick={() => chooseMode("visual")}>Visual</button>
        <button type="button" aria-pressed={mode === "markdown"} className={`rounded px-2 py-1 ${mode === "markdown" ? "bg-brand-100 font-semibold" : ""}`} onClick={() => chooseMode("markdown")}>Text (markdown)</button>
      </div>}
      {simple || mode === "visual" ? <VisualEditor value={content} onChange={setContent} disabled={dis} mentionable={mentionable} sectioned={simple} /> : (
        <>
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1">
          {TOOLS.map((t) => <button key={t.label} type="button" title={t.label} aria-label={t.label} className={`${btn} ${t.cls ?? ""}`} onClick={() => apply(t.op)} disabled={dis}>{t.text}</button>)}
          <button type="button" className={btn} aria-label="Link" title="Link" disabled={dis} onClick={() => { selRef.current = { start: taRef.current?.selectionStart ?? 0, end: taRef.current?.selectionEnd ?? 0 }; setLinkOpen((o) => !o); }}>Link</button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <button type="button" className={btn} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={() => undoRedo("undo")} disabled={dis}>Undo</button>
          <button type="button" className={btn} aria-label="Redo" title="Redo (Ctrl+Y)" onClick={() => undoRedo("redo")} disabled={dis}>Redo</button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <button type="button" className={`${btn} ${preview ? "bg-brand-100" : ""}`} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>{preview ? "Hide preview" : "Preview"}</button>
        </div>

        {linkOpen ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
            e.preventDefault();
            const ta = taRef.current;
            if (!ta) return;
            commit(insertLink({ value: ta.value, start: selRef.current.start, end: selRef.current.end }, linkUrl));
            setLinkOpen(false); setLinkUrl("https://");
          }}>
            <Input aria-label="Link address" type="url" required className="max-w-sm" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
            <Button size="sm" type="submit">Add link</Button>
            <span className="text-xs text-muted">Only http, https and mailto links are kept.</span>
          </form>
        ) : null}

        <textarea ref={taRef} aria-label="Note text" rows={10} value={content} disabled={dis} spellCheck maxLength={100000}
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[0.9rem] leading-6 text-ink placeholder:text-muted disabled:bg-surface disabled:text-muted"
          placeholder="Write freely. Use the toolbar for headings, lists, checklists and tables; you do not need to classify every sentence."
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); apply((s) => wrap(s, "**")); }
            if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); apply((s) => wrap(s, "_")); }
            if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
          }} />
        {preview ? <div className="rounded-lg border border-line bg-surface p-3" aria-label="Preview"><RichText md={content || "_Nothing to preview yet._"} /></div> : null}
        </>
      )}

      {amend ? (
        <div className="space-y-1">
          <label htmlFor={`amend-${note.id}`} className="text-sm font-medium text-ink">Why is this note being changed after the session was completed?</label>
          <Input id={`amend-${note.id}`} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="Required: kept with the earlier version" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="inline-flex items-center gap-2 text-sm text-muted" data-testid="save-state" data-state={status}>
          <span className={`inline-block size-2 rounded-full ${DOT[status]}`} aria-hidden />{SAVE_LABEL[status]}
          {status === "retrying" ? <span className="text-xs">(attempt {tries})</span> : null}
        </p>
        <div className="flex gap-2">
          {(status === "failed" || status === "dirty" || amend) && !dis ? <Button size="sm" variant="secondary" onClick={() => { attempt.current = 0; setTries(0); void save(); }}>{amend ? "Save amendment" : status === "failed" ? "Retry now" : "Save now"}</Button> : null}
          <Button size="sm" onClick={() => void finish()}>Done</Button>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--critical-fg)]">{error}</p> : null}

      {status === "conflict" ? (
        <div role="alert" className="space-y-2 rounded-lg border border-[#fecaca] bg-[var(--critical-bg)] p-3 text-sm text-[var(--critical-fg)]">
          <p><strong>{theirs?.last_edited_by_name ?? "Someone else"}</strong> saved this note after you opened it. Nothing of theirs was overwritten and your text is kept.</p>
          {theirs ? <details><summary className="cursor-pointer underline">See their version</summary><div className="mt-2 rounded bg-panel p-2 text-ink"><RichText md={theirs.content} /></div></details> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!theirs} onClick={() => {
              if (!theirs) return;
              stash();
              base.current = theirs.version;
              lastSaved.current = keyOf({ title: theirs.title ?? "", category: theirs.category, visibility: theirs.visibility, content: theirs.content });
              setTitle(theirs.title ?? ""); setCategory(theirs.category); setVisibility(theirs.visibility); setContent(theirs.content);
              set("saved"); toast.info("Their version is loaded. Your text was kept on this device until you save again.");
            }}>Use their version</Button>
            <Button size="sm" disabled={!theirs} onClick={() => { if (!theirs) return; base.current = theirs.version; overwrite.current = true; set("dirty"); attempt.current = 0; setTries(0); void save(); }}>Save mine over theirs</Button>
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(content).then(() => toast.success("Your text was copied."), () => toast.error("Could not copy; select the text and copy it."))}>Copy my text</Button>
          </div>
          <p className="text-xs">Either way, the version you do not keep stays in the note&apos;s history.</p>
        </div>
      ) : null}
    </div>
  );
}

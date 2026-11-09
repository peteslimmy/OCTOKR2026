"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { joinSections, sectionId, splitSections, type Section } from "@/lib/session-notes/format";
import { markdownToText } from "@/lib/session-notes/markdown";
import { RichText } from "./common";
import { Ribbon, type Mentionable } from "./editor/ribbon";
import { SectionEditor } from "./editor/section-editor";

export type { Mentionable };

const icon = "inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink focus-visible:outline-2 disabled:opacity-40";

/**
 * The visual (what-you-see) editor: a Word-style ribbon over the note's text. With `sectioned` the note is shown as one card per top-level heading
 * (Notes, Recommendations, Actions, Next steps, and any the person adds), each with its own editing area; the ribbon works on the card being edited.
 * What is saved is always the note's one markdown text (src/lib/session-notes/format.ts joins the cards back together); the editor's own HTML is never stored.
 */
export function VisualEditor({ value, onChange, disabled, mentionable, sectioned = false }: { value: string; onChange: (md: string) => void; disabled: boolean; mentionable: Mentionable[]; sectioned?: boolean }) {
  const [active, setActive] = useState<Editor | null>(null);
  const [preview, setPreview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [sections, setSections] = useState<Section[]>(() => (sectioned ? splitSections(value) : []));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const secRef = useRef(sections);
  const emitted = useRef(value);

  // the cards are rebuilt from the text only when the text changed from outside (restored draft, their version), never while the person is typing
  useEffect(() => {
    if (!sectioned || value === emitted.current) return;
    const next = splitSections(value);
    secRef.current = next; emitted.current = value;
    setSections(next);
  }, [value, sectioned]);

  useEffect(() => {
    if (!fullscreen) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [fullscreen]);

  const commit = (next: Section[]) => {
    secRef.current = next;
    setSections(next);
    const md = joinSections(next);
    emitted.current = md;
    onChange(md);
  };
  const edit = (id: string, patch: Partial<Section>) => commit(secRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const a = [...secRef.current];
    const j = i + d;
    if (j < 0 || j >= a.length || (a[i].title === null) || (a[j].title === null)) return;
    [a[i], a[j]] = [a[j], a[i]];
    commit(a);
  };
  const remove = (s: Section) => {
    if (secRef.current.length <= 1) return;
    if (s.md.trim() && !window.confirm(`Delete the section "${s.title ?? "Opening text"}" and everything written in it?`)) return;
    commit(secRef.current.filter((x) => x.id !== s.id));
  };
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const words = useMemo(() => markdownToText(value).split(/\s+/).filter(Boolean).length, [value]);
  // the first editor to exist is the one the ribbon works on until the person clicks into another
  const ready = (e: Editor) => setActive((prev) => (prev && !prev.isDestroyed ? prev : e));
  const live = active && !active.isDestroyed ? active : null;
  const view = { preview, onPreview: () => setPreview((p) => !p), fullscreen, onFullscreen: () => setFullscreen((f) => !f), zoom, onZoom: setZoom };

  return (
    <div data-testid="visual-editor" className={fullscreen ? "fixed inset-0 z-50 overflow-auto bg-surface p-3 sm:p-6" : "space-y-0"}>
      <div className={fullscreen ? "mx-auto max-w-5xl space-y-3" : "space-y-3"}>
        <div className="sticky top-0 z-20 -mx-px">
          <Ribbon editor={live} sectioned={sectioned} disabled={disabled} mentionable={mentionable} view={view} />
        </div>

        <div style={{ zoom: zoom / 100 }} className="space-y-3">
          {sectioned ? (
            <>
              {sections.map((s, i) => {
                const closed = collapsed.has(s.id);
                return (
                  <section key={s.id} aria-label={s.title ?? "Opening text"} data-section={s.title ?? ""} className="rounded-lg border border-line bg-panel focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600/40">
                    <header className="flex items-center gap-1 rounded-t-lg border-b border-line bg-surface px-2 py-1.5">
                      <button type="button" className={icon} aria-label={closed ? "Expand section" : "Collapse section"} aria-expanded={!closed} onClick={() => toggle(s.id)}>{closed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}</button>
                      {s.title === null
                        ? <span className="flex-1 px-1 text-sm font-semibold text-muted">Opening text</span>
                        : <input aria-label="Section title" value={s.title} maxLength={120} disabled={disabled} onChange={(e) => edit(s.id, { title: e.target.value })} className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold text-ink focus-visible:bg-panel focus-visible:outline-2" />}
                      <button type="button" className={icon} aria-label="Move section up" disabled={disabled || i === 0 || s.title === null || sections[i - 1].title === null} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></button>
                      <button type="button" className={icon} aria-label="Move section down" disabled={disabled || i === sections.length - 1 || s.title === null} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></button>
                      <button type="button" className={icon} aria-label="Delete section" disabled={disabled || sections.length <= 1} onClick={() => remove(s)}><Trash2 className="size-4" /></button>
                    </header>
                    <div hidden={closed} className="px-3 py-2">
                      <SectionEditor md={s.md} label={`${s.title ?? "Opening text"} (visual editor)`} sectioned disabled={disabled} onMd={(md) => edit(s.id, { md })} onActive={setActive} onReady={ready} />
                    </div>
                  </section>
                );
              })}
              {adding === null ? (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setAdding("")}><Plus className="mr-1 inline size-4" aria-hidden />Add section</Button>
              ) : (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  const t = adding.trim();
                  if (!t) return;
                  commit([...secRef.current, { id: sectionId(), title: t, md: "" }]);
                  setAdding(null);
                }}>
                  <Input aria-label="New section title" autoFocus placeholder="Section title, for example Decisions" className="max-w-xs" maxLength={120} value={adding} onChange={(e) => setAdding(e.target.value)} />
                  <Button size="sm" type="submit" disabled={!adding.trim()}>Add</Button>
                  <Button size="sm" variant="secondary" type="button" onClick={() => setAdding(null)}>Cancel</Button>
                </form>
              )}
            </>
          ) : (
            <div className="rounded-b-lg border border-t-0 border-line bg-panel px-3 py-2 focus-within:ring-1 focus-within:ring-brand-600/40">
              <SectionEditor md={value} label="Note text (visual editor)" sectioned={false} disabled={disabled} onMd={(md) => { emitted.current = md; onChange(md); }} onActive={setActive} onReady={ready} minHeight="12rem" />
            </div>
          )}
        </div>

        {preview ? <div className="rounded-lg border border-line bg-surface p-3" aria-label="Preview"><RichText md={value || "_Nothing to preview yet._"} /></div> : null}

        <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>{words} {words === 1 ? "word" : "words"} · pasted text is inserted as plain text</span>
          <span>Saved as the same formatted text the text editor uses.</span>
        </p>
      </div>
    </div>
  );
}

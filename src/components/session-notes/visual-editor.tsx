"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, NativeSelect } from "@/components/ui/primitives";
import { htmlToMarkdown } from "@/lib/session-notes/html-to-markdown";
import { markdownToHtml, safeUrl } from "@/lib/session-notes/markdown";

export interface Mentionable { id: string; name: string }

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const btn = "rounded-md border border-line bg-panel px-2 py-1 text-xs font-medium text-ink hover:bg-surface focus-visible:outline-2 disabled:opacity-50";

/**
 * The visual (what-you-see) editor. The person edits the rendered note; every change is turned back into the notes' markdown text (src/lib/session-notes/html-to-markdown.ts)
 * and that text is what is saved, versioned and rendered, exactly as with the text editor. The editor's own HTML is never stored and never trusted: it is rebuilt from the text
 * by the safe renderer, and pasted content is inserted as plain text.
 */
export function VisualEditor({ value, onChange, disabled, mentionable }: { value: string; onChange: (md: string) => void; disabled: boolean; mentionable: Mentionable[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("https://");
  const [linkError, setLinkError] = useState<string | null>(null);
  const saved = useRef<Range | null>(null);

  // the document is rebuilt from the text only when the text changed from outside (first show, restored draft, their version): never while the person is typing
  useEffect(() => {
    const el = ref.current;
    if (!el || emitted.current === value) return;
    el.innerHTML = markdownToHtml(value, { editable: true });
    emitted.current = value;
  }, [value]);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const md = htmlToMarkdown(el);
    emitted.current = md;
    onChange(md);
  };
  const exec = (cmd: string, arg?: string) => { ref.current?.focus(); document.execCommand(cmd, false, arg); sync(); };
  const html = (h: string) => exec("insertHTML", h);
  const remember = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { const s = window.getSelection(); if (s && saved.current) { s.removeAllRanges(); s.addRange(saved.current); } };

  return (
    <div className="space-y-2" data-testid="visual-editor">
      <div role="toolbar" aria-label="Formatting (visual editor)" className="flex flex-wrap items-center gap-1">
        <button type="button" className={btn} disabled={disabled} aria-label="Heading" onClick={() => exec("formatBlock", "H3")}>H1</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Subheading" onClick={() => exec("formatBlock", "H4")}>H2</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Paragraph" onClick={() => exec("formatBlock", "P")}>¶</button>
        <button type="button" className={`${btn} font-bold`} disabled={disabled} aria-label="Bold" onClick={() => exec("bold")}>B</button>
        <button type="button" className={`${btn} italic`} disabled={disabled} aria-label="Italic" onClick={() => exec("italic")}>I</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Bulleted list" onClick={() => exec("insertUnorderedList")}>• List</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Numbered list" onClick={() => exec("insertOrderedList")}>1. List</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Checklist" onClick={() => html('<ul><li><span data-task="open" contenteditable="false" class="task-box">☐</span>&nbsp;</li></ul>')}>☑ Checklist</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Quote" onClick={() => exec("formatBlock", "BLOCKQUOTE")}>❝</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Table" onClick={() => html("<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p></p>")}>Table</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Link" onClick={() => { remember(); setLinkError(null); setLinkOpen((o) => !o); }}>Link</button>
        {mentionable.length ? (
          <NativeSelect aria-label="Mention a participant" className="!w-auto !py-1 text-xs" disabled={disabled} value="" onFocus={remember}
            onChange={(e) => {
              const p = mentionable.find((x) => x.id === e.target.value);
              if (!p) return;
              restore();
              html(`<span class="mention" data-user="${p.id}" contenteditable="false">@${escapeHtml(p.name.replace(/[\]\n]/g, ""))}</span>&nbsp;`);
            }}>
            <option value="">@ Mention…</option>
            {mentionable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        ) : null}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={btn} disabled={disabled} aria-label="Undo" onClick={() => exec("undo")}>Undo</button>
        <button type="button" className={btn} disabled={disabled} aria-label="Redo" onClick={() => exec("redo")}>Redo</button>
      </div>

      {linkOpen ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          const safe = safeUrl(url);
          if (!safe) { setLinkError("Only http, https and mailto links are accepted."); return; }
          restore();
          exec("createLink", safe);
          setLinkOpen(false); setUrl("https://");
        }}>
          <Input aria-label="Link address" className="max-w-sm" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button size="sm" type="submit">Add link</Button>
          {linkError ? <span role="alert" className="text-xs text-[var(--critical-fg)]">{linkError}</span> : <span className="text-xs text-muted">Select the words first.</span>}
        </form>
      ) : null}

      <div
        ref={ref} role="textbox" aria-multiline="true" aria-label="Note text (visual editor)" contentEditable={!disabled} suppressContentEditableWarning spellCheck
        className="session-rich session-editor min-h-48 rounded-lg border border-line bg-panel px-3 py-2 focus-visible:outline-2"
        onInput={sync} onBlur={remember}
        onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData("text/plain"); if (t) { document.execCommand("insertText", false, t); sync(); } }}
        onDrop={(e) => e.preventDefault()}
        onClick={(e) => {
          const box = (e.target as HTMLElement).closest?.("[data-task]") as HTMLElement | null;
          if (!box || disabled) return;
          const done = box.getAttribute("data-task") === "done";
          box.setAttribute("data-task", done ? "open" : "done");
          box.textContent = done ? "☐" : "☑";
          sync();
        }}
      />
      <p className="text-xs text-muted">Pasted text is inserted as plain text. What you see is saved as the same formatted text the text editor uses.</p>
    </div>
  );
}

"use client";

import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import { useEffect, useRef } from "react";
import { htmlToMarkdown, markdownToHtml } from "@/lib/rich-text";

const PROSE = "[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_b]:font-semibold";

/** A stored comment, shown with its formatting. The HTML comes only from the safe subset in lib/rich-text (everything typed is escaped). */
export function RichText({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value || !value.trim()) return null;
  return <div className={`text-sm leading-relaxed ${PROSE} ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} />;
}

const TOOLS = [
  { cmd: "bold", label: "Bold", Icon: Bold }, { cmd: "italic", label: "Italic", Icon: Italic }, { cmd: "underline", label: "Underline", Icon: Underline },
  { cmd: "insertUnorderedList", label: "Bulleted list", Icon: List }, { cmd: "insertOrderedList", label: "Numbered list", Icon: ListOrdered },
] as const;

/**
 * A small rich-text box for comments: bold, italic, underline and lists. What it hands back is the plain-text subset of lib/rich-text,
 * never HTML, and pasted content is inserted as plain text.
 */
export function RichTextEditor({ id, label, value, onChange, disabled, maxLength = 4000 }: {
  id: string; label: string; value: string; onChange: (md: string) => void; disabled?: boolean; maxLength?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);   // the text this box itself last reported, so an echo from the parent never resets the cursor

  useEffect(() => {
    const el = box.current;
    if (!el || value === last.current) return;
    el.innerHTML = markdownToHtml(value);
    last.current = value;
  }, [value]);

  const emit = () => {
    const el = box.current;
    if (!el) return;
    const md = htmlToMarkdown(el as unknown as Parameters<typeof htmlToMarkdown>[0]);
    last.current = md;
    onChange(md);
  };
  const run = (cmd: string) => { box.current?.focus(); document.execCommand(cmd); emit(); };

  return (
    <div className="rounded-lg border border-line bg-panel focus-within:border-brand-700">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1" role="toolbar" aria-label={`${label} formatting`}>
        {TOOLS.map(({ cmd, label: l, Icon }) => (
          <button key={cmd} type="button" disabled={disabled} aria-label={l} title={l}
            onMouseDown={(e) => e.preventDefault()}   // keep the selection in the box
            onClick={() => run(cmd)} className="rounded p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-40"><Icon className="h-4 w-4" aria-hidden /></button>
        ))}
        <span className="ml-auto pr-1 text-xs text-muted tabular-nums">{value.length}/{maxLength}</span>
      </div>
      <div ref={box} id={id} role="textbox" aria-multiline="true" aria-label={label} contentEditable={!disabled} suppressContentEditableWarning
        className={`min-h-28 max-h-72 overflow-y-auto px-3 py-2 text-sm leading-relaxed outline-none ${PROSE} ${disabled ? "opacity-60" : ""}`}
        onInput={emit}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}
        onBeforeInput={(e) => { if (value.length >= maxLength && (e.nativeEvent as InputEvent).inputType.startsWith("insert")) e.preventDefault(); }} />
    </div>
  );
}

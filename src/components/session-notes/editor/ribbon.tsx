"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AtSign, Baseline, Bold, CalendarDays, ClipboardCheck, ChevronDown, Eye, Highlighter, IndentDecrease, IndentIncrease, Italic,
  Link2, List, ListChecks, ListOrdered, Maximize2, Minimize2, Minus, Quote, Redo2, RemoveFormatting, Strikethrough, Table2, Trash2, Underline, Undo2,
} from "lucide-react";
import { HIGHLIGHTS, MAX_LIST_DEPTH, TEXT_COLOURS } from "@/lib/session-notes/format";
import { safeUrl } from "@/lib/session-notes/markdown";
import { Button, Input, NativeSelect } from "@/components/ui/primitives";

export interface Mentionable { id: string; name: string }
export interface ViewState { preview: boolean; onPreview: () => void; fullscreen: boolean; onFullscreen: () => void; zoom: number; onZoom: (z: number) => void }

const TABS = ["Home", "Insert", "Table", "View"] as const;
type Tab = (typeof TABS)[number];
const ZOOMS = [80, 90, 100, 110, 125, 150];
const btnBase = "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink hover:bg-panel focus-visible:outline-2 disabled:opacity-40 disabled:hover:bg-transparent";

function Tool({ label, onClick, active, disabled, children, className = "" }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} disabled={disabled} onClick={onClick}
      className={`${btnBase} ${active ? "bg-brand-100 text-brand-800" : ""} ${className}`}>{children}</button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col items-center justify-between gap-0.5 border-r border-line px-2 py-1 last:border-r-0">
      <div className="flex flex-wrap items-center gap-0.5">{children}</div>
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

/** A small menu under a button; closes on a click outside it or on Escape. */
function Pop({ label, trigger, disabled, children, active }: { label: string; trigger: ReactNode; disabled?: boolean; children: (close: () => void) => ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" title={label} aria-label={label} aria-haspopup="true" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)} className={`${btnBase} ${active || open ? "bg-brand-100 text-brand-800" : ""}`}>{trigger}<ChevronDown className="size-3 opacity-60" aria-hidden /></button>
      {open ? <div className="absolute left-0 top-full z-30 mt-1 min-w-48 rounded-lg border border-line bg-panel p-2 shadow-lg">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

function Swatches({ items, current, onPick, none }: { items: readonly { key: string; label: string; hex: string }[]; current: string | null; onPick: (key: string | null) => void; none: string }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {items.map((c) => (
          <button key={c.key} type="button" title={c.label} aria-label={c.label} aria-pressed={current === c.key} onClick={() => onPick(c.key)}
            className={`size-6 rounded border ${current === c.key ? "ring-2 ring-brand-600 ring-offset-1" : "border-line"}`} style={{ background: c.hex }} />
        ))}
      </div>
      <button type="button" className="w-full rounded border border-line px-2 py-1 text-xs hover:bg-surface" onClick={() => onPick(null)}>{none}</button>
    </div>
  );
}

const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function listDepth(editor: Editor) {
  const { $from } = editor.state.selection;
  let n = 0;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "listItem") n++;
  return n;
}

/** Turn the current line into a checklist item (or back into a plain list item). */
function toggleChecklist(editor: Editor) {
  const inItem = listDepth(editor) > 0;
  const chain = editor.chain().focus();
  if (!inItem) chain.toggleBulletList();
  chain.command(({ tr, state }) => {
    const start = tr.selection.$from.start();
    const first = tr.doc.nodeAt(start);
    if (first?.type.name === "taskBox") { tr.delete(start, start + first.nodeSize); return true; }
    const atStart = tr.selection.from === start;
    tr.insert(start, [state.schema.nodes.taskBox.create({ state: "open" }), state.schema.text(" ")]);
    if (atStart) tr.setSelection(TextSelection.create(tr.doc, start + 2));
    return true;
  }).run();
}

type RibbonProps = { editor: Editor | null; sectioned: boolean; disabled: boolean; mentionable: Mentionable[]; view: ViewState };

/** The ribbon keeps its chosen tab; its body is rebuilt whenever it is pointed at another editor, so its buttons always reflect the editor being edited. */
export function Ribbon(props: RibbonProps) {
  const [tab, setTab] = useState<Tab>("Home");
  return <RibbonBody key={props.editor?.instanceId ?? "none"} {...props} tab={tab} setTab={setTab} />;
}

function RibbonBody({ editor, sectioned, disabled, mentionable, view, tab, setTab }: RibbonProps & { tab: Tab; setTab: (t: Tab) => void }) {
  const [url, setUrl] = useState("https://");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 3 });
  const [action, setAction] = useState({ text: "", owner: "", due: "" });

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const attrs = (t: string) => e.getAttributes(t);
      return {
        bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"), link: e.isActive("link"),
        bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), table: e.isActive("table"),
        heading: e.isActive("heading") ? Number(attrs("heading").level) : 0,
        align: (attrs("heading").align ?? attrs("paragraph").align ?? attrs("blockquote").align ?? "left") as string,
        colour: (attrs("textColour").key ?? null) as string | null, highlight: (attrs("highlight").key ?? null) as string | null,
        depth: listDepth(e), canUndo: e.can().undo(), canRedo: e.can().redo(),
      };
    },
  });

  const off = disabled || !editor || !s;
  const run = (fn: (e: Editor) => void) => { if (editor) fn(editor); };
  const style = s?.quote ? "quote" : s?.heading ? (sectioned ? "h1" : `h${s.heading}`) : "p";

  const setStyle = (v: string) => run((e) => {
    const chain = e.chain().focus();
    if (e.isActive("blockquote")) chain.unsetBlockquote();
    if (v === "p") chain.setParagraph();
    else if (v === "quote") chain.setBlockquote();
    else chain.setHeading({ level: (sectioned ? 3 : Number(v[1])) as 1 | 2 | 3 });
    chain.run();
  });
  const align = (a: "left" | "center" | "right" | "justify") => run((e) => {
    const v = a === "left" ? null : a;
    e.chain().focus().updateAttributes("paragraph", { align: v }).updateAttributes("heading", { align: v }).updateAttributes("blockquote", { align: v }).run();
  });
  const clearFormatting = () => run((e) => e.chain().focus().unsetAllMarks().clearNodes().updateAttributes("paragraph", { align: null }).run());

  const insertText = (text: string) => run((e) => e.chain().focus().insertContent({ type: "text", text }).run());
  const person = (id: string) => mentionable.find((p) => p.id === id);

  return (
    <div role="toolbar" aria-label="Formatting (visual editor)" className="rounded-t-lg border border-line bg-surface"
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input, select, textarea, label")) e.preventDefault(); }}>
      <div role="tablist" aria-label="Ribbon" className="flex gap-1 border-b border-line px-2 pt-1">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold ${tab === t ? "border-line bg-panel text-brand-800" : "border-transparent text-muted hover:text-ink"}`}>{t}</button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tab} className="flex flex-wrap bg-panel/60">
        {tab === "Home" ? (
          <>
            <Group label="Undo">
              <Tool label="Undo (Ctrl+Z)" disabled={off || !s?.canUndo} onClick={() => run((e) => e.chain().focus().undo().run())}><Undo2 className="size-4" /></Tool>
              <Tool label="Redo (Ctrl+Y)" disabled={off || !s?.canRedo} onClick={() => run((e) => e.chain().focus().redo().run())}><Redo2 className="size-4" /></Tool>
            </Group>
            <Group label="Style">
              <NativeSelect aria-label="Paragraph style" className="!w-36 !py-1 text-xs" disabled={off} value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="p">Normal</option>
                {sectioned ? <option value="h1">Heading</option> : <><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></>}
                <option value="quote">Quote</option>
              </NativeSelect>
            </Group>
            <Group label="Font">
              <Tool label="Bold (Ctrl+B)" active={s?.bold} disabled={off} onClick={() => run((e) => e.chain().focus().toggleBold().run())}><Bold className="size-4" /></Tool>
              <Tool label="Italic (Ctrl+I)" active={s?.italic} disabled={off} onClick={() => run((e) => e.chain().focus().toggleItalic().run())}><Italic className="size-4" /></Tool>
              <Tool label="Underline (Ctrl+U)" active={s?.underline} disabled={off} onClick={() => run((e) => e.chain().focus().toggleUnderline().run())}><Underline className="size-4" /></Tool>
              <Tool label="Strikethrough" active={s?.strike} disabled={off} onClick={() => run((e) => e.chain().focus().toggleStrike().run())}><Strikethrough className="size-4" /></Tool>
              <Pop label="Text colour" disabled={off} active={!!s?.colour} trigger={<Baseline className="size-4" style={{ color: TEXT_COLOURS.find((c) => c.key === s?.colour)?.hex }} />}>
                {(close) => <Swatches items={TEXT_COLOURS} current={s?.colour ?? null} none="Automatic" onPick={(k) => { run((e) => (k ? e.chain().focus().setMark("textColour", { key: k }).run() : e.chain().focus().unsetMark("textColour").run())); close(); }} />}
              </Pop>
              <Pop label="Highlight colour" disabled={off} active={!!s?.highlight} trigger={<Highlighter className="size-4" />}>
                {(close) => <Swatches items={HIGHLIGHTS} current={s?.highlight ?? null} none="No highlight" onPick={(k) => { run((e) => (k ? e.chain().focus().setMark("highlight", { key: k }).run() : e.chain().focus().unsetMark("highlight").run())); close(); }} />}
              </Pop>
              <Tool label="Clear formatting" disabled={off} onClick={clearFormatting}><RemoveFormatting className="size-4" /></Tool>
            </Group>
            <Group label="Paragraph">
              <Tool label="Bulleted list" active={s?.bullet} disabled={off} onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}><List className="size-4" /></Tool>
              <Tool label="Numbered list" active={s?.ordered} disabled={off} onClick={() => run((e) => e.chain().focus().toggleOrderedList().run())}><ListOrdered className="size-4" /></Tool>
              <Tool label="Checklist" disabled={off} onClick={() => run(toggleChecklist)}><ListChecks className="size-4" /></Tool>
              <Tool label="Decrease indent" disabled={off || !s?.depth} onClick={() => run((e) => e.chain().focus().liftListItem("listItem").run())}><IndentDecrease className="size-4" /></Tool>
              <Tool label="Increase indent" disabled={off || !s?.depth || (s?.depth ?? 0) >= MAX_LIST_DEPTH} onClick={() => run((e) => e.chain().focus().sinkListItem("listItem").run())}><IndentIncrease className="size-4" /></Tool>
              <Tool label="Align left" active={s?.align === "left"} disabled={off} onClick={() => align("left")}><AlignLeft className="size-4" /></Tool>
              <Tool label="Align centre" active={s?.align === "center"} disabled={off} onClick={() => align("center")}><AlignCenter className="size-4" /></Tool>
              <Tool label="Align right" active={s?.align === "right"} disabled={off} onClick={() => align("right")}><AlignRight className="size-4" /></Tool>
              <Tool label="Justify" active={s?.align === "justify"} disabled={off} onClick={() => align("justify")}><AlignJustify className="size-4" /></Tool>
              <Tool label="Quote" active={s?.quote} disabled={off} onClick={() => run((e) => e.chain().focus().toggleBlockquote().run())}><Quote className="size-4" /></Tool>
            </Group>
          </>
        ) : null}

        {tab === "Insert" ? (
          <>
            <Group label="Table">
              <Pop label="Table" disabled={off} trigger={<><Table2 className="size-4" /> Table</>}>
                {(close) => (
                  <form className="space-y-2 text-xs" onSubmit={(ev) => { ev.preventDefault(); run((e) => e.chain().focus().insertTable({ rows: tableSize.rows, cols: tableSize.cols, withHeaderRow: true }).run()); close(); }}>
                    <label className="flex items-center justify-between gap-2">Rows<Input type="number" min={1} max={20} className="!w-16 !py-1" value={tableSize.rows} onChange={(e) => setTableSize((t) => ({ ...t, rows: Math.min(20, Math.max(1, Number(e.target.value) || 1)) }))} /></label>
                    <label className="flex items-center justify-between gap-2">Columns<Input type="number" min={1} max={8} className="!w-16 !py-1" value={tableSize.cols} onChange={(e) => setTableSize((t) => ({ ...t, cols: Math.min(8, Math.max(1, Number(e.target.value) || 1)) }))} /></label>
                    <Button size="sm" type="submit">Insert table</Button>
                  </form>
                )}
              </Pop>
            </Group>
            <Group label="Links">
              <Pop label="Link" disabled={off} active={s?.link} trigger={<><Link2 className="size-4" /> Link</>}>
                {(close) => (
                  <form className="space-y-2 text-xs" onSubmit={(ev) => {
                    ev.preventDefault();
                    const safe = safeUrl(url);
                    if (!safe) { setLinkError("Only http, https and mailto links are accepted."); return; }
                    run((e) => e.chain().focus().extendMarkRange("link").setLink({ href: safe }).run());
                    setLinkError(null); setUrl("https://"); close();
                  }}>
                    <Input aria-label="Link address" className="!w-64" value={url} onChange={(e) => setUrl(e.target.value)} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" type="submit">Add link</Button>
                      {s?.link ? <Button size="sm" variant="secondary" type="button" onClick={() => { run((e) => e.chain().focus().extendMarkRange("link").unsetLink().run()); close(); }}>Remove link</Button> : null}
                    </div>
                    {linkError ? <p role="alert" className="text-[var(--critical-fg)]">{linkError}</p> : <p className="text-muted">Select the words first.</p>}
                  </form>
                )}
              </Pop>
            </Group>
            <Group label="Insert">
              <Tool label="Horizontal line" disabled={off} onClick={() => run((e) => e.chain().focus().setHorizontalRule().run())}><Minus className="size-4" /></Tool>
              <Tool label="Today's date" disabled={off} onClick={() => insertText(today())}><CalendarDays className="size-4" /></Tool>
              {mentionable.length ? (
                <NativeSelect aria-label="Mention a participant" className="!w-auto !py-1 text-xs" disabled={off} value="" onChange={(e) => {
                  const p = person(e.target.value);
                  if (!p) return;
                  run((ed) => ed.chain().focus().insertContent([{ type: "mention", attrs: { id: p.id, name: p.name.replace(/[\]\n]/g, "") } }, { type: "text", text: " " }]).run());
                }}>
                  <option value="">@ Mention…</option>
                  {mentionable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              ) : <span className="inline-flex items-center gap-1 px-1 text-xs text-muted"><AtSign className="size-3" /> no one to mention</span>}
            </Group>
            <Group label="Action item">
              <Pop label="Action item" disabled={off} trigger={<><ClipboardCheck className="size-4" /> Action item</>}>
                {(close) => (
                  <form className="space-y-2 text-xs" onSubmit={(ev) => {
                    ev.preventDefault();
                    const text = action.text.trim();
                    if (!text) return;
                    const owner = person(action.owner);
                    const due = action.due ? new Date(`${action.due}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
                    const inline: unknown[] = [{ type: "taskBox", attrs: { state: "open" } }, { type: "text", text: ` ${text}` }];
                    if (owner) inline.push({ type: "text", text: " — " }, { type: "mention", attrs: { id: owner.id, name: owner.name.replace(/[\]\n]/g, "") } });
                    if (due) inline.push({ type: "text", text: ` — due ${due}` });
                    run((e) => e.chain().focus().insertContent({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: inline as never }] }] }).run());
                    setAction({ text: "", owner: "", due: "" }); close();
                  }}>
                    <Input aria-label="What needs to be done" placeholder="What needs to be done" className="!w-64" value={action.text} maxLength={300} onChange={(e) => setAction((a) => ({ ...a, text: e.target.value }))} />
                    {mentionable.length ? (
                      <NativeSelect aria-label="Owner" value={action.owner} onChange={(e) => setAction((a) => ({ ...a, owner: e.target.value }))}>
                        <option value="">No owner</option>
                        {mentionable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </NativeSelect>
                    ) : null}
                    <label className="flex items-center justify-between gap-2">Due<Input type="date" aria-label="Due date" className="!w-40 !py-1" value={action.due} onChange={(e) => setAction((a) => ({ ...a, due: e.target.value }))} /></label>
                    <Button size="sm" type="submit" disabled={!action.text.trim()}>Add action</Button>
                  </form>
                )}
              </Pop>
            </Group>
          </>
        ) : null}

        {tab === "Table" ? (
          <>
            <Group label="Rows">
              <Tool label="Add row above" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().addRowBefore().run())}>Row above</Tool>
              <Tool label="Add row below" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().addRowAfter().run())}>Row below</Tool>
              <Tool label="Delete row" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().deleteRow().run())}><Trash2 className="size-3.5" /> Row</Tool>
            </Group>
            <Group label="Columns">
              <Tool label="Add column left" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().addColumnBefore().run())}>Column left</Tool>
              <Tool label="Add column right" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().addColumnAfter().run())}>Column right</Tool>
              <Tool label="Delete column" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().deleteColumn().run())}><Trash2 className="size-3.5" /> Column</Tool>
            </Group>
            <Group label="Table">
              <Tool label="Delete table" disabled={off || !s?.table} onClick={() => run((e) => e.chain().focus().deleteTable().run())}><Trash2 className="size-3.5" /> Table</Tool>
              {s?.table ? <span className="px-1 text-xs text-muted">The first row is the header.</span> : <span className="px-1 text-xs text-muted">Click inside a table to change it.</span>}
            </Group>
          </>
        ) : null}

        {tab === "View" ? (
          <>
            <Group label="Show">
              <Tool label={view.preview ? "Hide preview" : "Preview as read"} active={view.preview} onClick={view.onPreview}><Eye className="size-4" /> Preview</Tool>
              <Tool label={view.fullscreen ? "Exit full screen" : "Full screen"} active={view.fullscreen} onClick={view.onFullscreen}>{view.fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />} Full screen</Tool>
            </Group>
            <Group label="Zoom">
              <NativeSelect aria-label="Zoom" className="!w-24 !py-1 text-xs" value={view.zoom} onChange={(e) => view.onZoom(Number(e.target.value))}>
                {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
              </NativeSelect>
            </Group>
          </>
        ) : null}
      </div>
    </div>
  );
}

import Heading from "@tiptap/extension-heading";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { isAlignment, isHighlight, isTextColour } from "@/lib/session-notes/format";
import { safeUrl } from "@/lib/session-notes/markdown";

/**
 * The editor's document model. Every node and mark here corresponds to something the note format can store (src/lib/session-notes/format.ts and markdown.ts): the editor's own
 * HTML is converted back to the note's text by html-to-markdown.ts, which keeps only what is listed there. A mark or node the format cannot store is deliberately not offered.
 */

/** Headings keep the note format's own levels: level 1 is "#", 2 is "##", 3 is "###" and they show as h3, h4 and h5 (the page's own title stays the top heading). */
const NoteHeading = (levels: number[]) => Heading.extend({
  parseHTML() { return [3, 4, 5].map((t) => ({ tag: `h${t}`, attrs: { level: t - 2 } })); },
  renderHTML({ node, HTMLAttributes }) { return [`h${Number(node.attrs.level) + 2}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]; },
}).configure({ levels: levels as never });

const colourMark = (name: string, attr: "data-c" | "data-h", prefix: "tc" | "hl", valid: (k: string | null) => boolean) => Mark.create({
  name,
  addAttributes() {
    return { key: { default: null, parseHTML: (el: HTMLElement) => { const k = el.getAttribute(attr); return valid(k) ? k : null; }, renderHTML: (a: Record<string, unknown>) => (a.key ? { [attr]: String(a.key), class: `${prefix}-${String(a.key)}` } : {}) } };
  },
  parseHTML() { return [{ tag: `span[${attr}]` }]; },
  renderHTML({ HTMLAttributes }) { return ["span", HTMLAttributes, 0]; },
});
export const TextColour = colourMark("textColour", "data-c", "tc", isTextColour);
export const Highlight = colourMark("highlight", "data-h", "hl", isHighlight);

/** Paragraph alignment (left is the default and is not stored). Only the three known words are kept. */
export const Align = Extension.create({
  name: "align",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading", "blockquote"],
      attributes: { align: { default: null, parseHTML: (el: HTMLElement) => { const a = el.getAttribute("data-align"); return isAlignment(a) ? a : null; }, renderHTML: (a: Record<string, unknown>) => (a.align ? { "data-align": String(a.align) } : {}) } },
    }];
  },
});

/** The box of a checklist item. Clicking it toggles open/done. */
export const TaskBox = Node.create({
  name: "taskBox", group: "inline", inline: true, atom: true, selectable: false,
  addAttributes() { return { state: { default: "open", parseHTML: (el: HTMLElement) => (el.getAttribute("data-task") === "done" ? "done" : "open"), renderHTML: (a: Record<string, unknown>) => ({ "data-task": a.state === "done" ? "done" : "open" }) } }; },
  parseHTML() { return [{ tag: "span[data-task]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "task-box", contenteditable: "false" }), node.attrs.state === "done" ? "☑" : "☐"]; },
  addKeyboardShortcuts() {
    // Enter in a checklist item starts another checklist item; Enter on an item with nothing written ends the list (as in a word processor)
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        const para = $from.parent;
        if (!empty || para.type.name !== "paragraph" || para.firstChild?.type.name !== "taskBox" || $from.depth < 2 || $from.node($from.depth - 1).type.name !== "listItem") return false;
        const blank = para.childCount === 1 || (para.childCount === 2 && !!para.lastChild?.isText && (para.lastChild.text ?? "").trim() === "");
        if (blank) return editor.chain().command(({ tr }) => { tr.delete($from.start(), $from.end()); return true; }).liftListItem("listItem").run();
        return editor.chain().splitListItem("listItem").command(({ tr, state }) => {
          const at = tr.selection.$from.start();
          tr.insert(at, [state.schema.nodes.taskBox.create({ state: "open" }), state.schema.text(" ")]);
          tr.setSelection(TextSelection.create(tr.doc, at + 2));
          return true;
        }).run();
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("taskBoxClick"),
      props: {
        handleClickOn: (view, _pos, node, nodePos) => {
          if (node.type.name !== "taskBox" || !view.editable) return false;
          view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { state: node.attrs.state === "done" ? "open" : "done" }));
          return true;
        },
      },
    })];
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An @mention of a colleague; the person's id is what is stored, the name is only shown. */
export const Mention = Node.create({
  name: "mention", group: "inline", inline: true, atom: true, selectable: false,
  addAttributes() {
    return {
      id: { default: "", parseHTML: (el: HTMLElement) => { const v = el.getAttribute("data-user") ?? ""; return UUID.test(v) ? v : ""; }, renderHTML: (a: Record<string, unknown>) => ({ "data-user": String(a.id ?? "") }) },
      name: { default: "", parseHTML: (el: HTMLElement) => (el.textContent ?? "").replace(/^@/, "").slice(0, 80), renderHTML: () => ({}) },
    };
  },
  parseHTML() { return [{ tag: "span[data-user]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "mention", contenteditable: "false" }), `@${String(node.attrs.name)}`]; },
});

/** Pasted content is always inserted as plain text, as it always was: what is typed or pasted never brings markup, styles or scripts with it. */
const PlainPaste = Extension.create({
  name: "plainPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey("plainPaste"),
      props: {
        handlePaste: (_view, event) => {
          const text = event.clipboardData?.getData("text/plain");
          if (!text) return true;
          const lines = text.replace(/\r\n?/g, "\n").split("\n");
          if (lines.length === 1) editor.commands.insertContent({ type: "text", text: lines[0] });
          else editor.commands.insertContent(lines.map((l) => (l ? { type: "paragraph", content: [{ type: "text", text: l }] } : { type: "paragraph" })));
          return true;
        },
        handleDrop: () => true,
      },
    })];
  },
});

export function noteExtensions(sectioned: boolean) {
  return [
    StarterKit.configure({
      heading: false, codeBlock: false, code: { HTMLAttributes: {} },
      link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: (url: string) => !!safeUrl(url), HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
    }),
    // inside a card the "##" level is the card's own title, so the editor offers the one level below it
    NoteHeading(sectioned ? [3] : [1, 2, 3]),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    TextColour, Highlight, Align, TaskBox, Mention, PlainPaste,
  ];
}

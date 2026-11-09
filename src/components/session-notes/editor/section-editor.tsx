"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { htmlToMarkdown, type NodeLike } from "@/lib/session-notes/html-to-markdown";
import { markdownToHtml } from "@/lib/session-notes/markdown";
import { noteExtensions } from "./extensions";

/**
 * One editing surface (a card's body, or the whole note in the plain layout). The note's markdown text is what goes in and what comes out: the editor shows
 * markdownToHtml(text), and every change is converted back to text by htmlToMarkdown, so nothing the editor itself produces is ever stored or trusted.
 * The editor is rebuilt from the text only when the text changed from outside (a restored draft, someone else's version), never while the person is typing.
 */
export function SectionEditor({ md, label, sectioned, disabled, onMd, onActive, onReady, minHeight = "9rem" }: {
  md: string; label: string; sectioned: boolean; disabled: boolean; onMd: (md: string) => void; onActive: (editor: Editor) => void; onReady: (editor: Editor) => void; minHeight?: string;
}) {
  const last = useRef(md);
  const cb = useRef({ onMd, onActive, onReady });
  useEffect(() => { cb.current = { onMd, onActive, onReady }; });
  const extensions = useMemo(() => noteExtensions(sectioned), [sectioned]);

  const editor = useEditor({
    extensions,
    content: markdownToHtml(md, { editable: true }),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: { attributes: { class: "session-rich session-editor note-prose", role: "textbox", "aria-multiline": "true", "aria-label": label, spellcheck: "true" } },
    onFocus: ({ editor: e }) => cb.current.onActive(e),
    onUpdate: ({ editor: e }) => {
      const body = new DOMParser().parseFromString(e.getHTML(), "text/html").body;
      const next = htmlToMarkdown(body as unknown as NodeLike);
      last.current = next;
      cb.current.onMd(next);
    },
  }, [extensions]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || md === last.current) return;
    editor.commands.setContent(markdownToHtml(md, { editable: true }), { emitUpdate: false });
    last.current = md;
  }, [md, editor]);

  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!disabled); }, [disabled, editor]);
  // the ribbon needs a live editor from the start (the editor can be created more than once, for example by React's development double-mount)
  useEffect(() => { if (editor && !editor.isDestroyed) cb.current.onReady(editor); }, [editor]);

  return <div className="note-editor-surface" style={{ ["--note-min" as string]: minHeight }}><EditorContent editor={editor} /></div>;
}

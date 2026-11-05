// Text operations behind the note editor's toolbar. Pure: each takes the text and the selection and returns the new text and selection, so they are testable
// without a browser. The editor writes the result back as one undoable edit.

export interface Sel { value: string; start: number; end: number }

const lineStart = (v: string, i: number) => v.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (v: string, i: number) => { const n = v.indexOf("\n", i); return n === -1 ? v.length : n; };

/** Wrap the selection in a marker pair (bold, italic, code); with nothing selected, insert the pair and leave the cursor between. Wrapping already-wrapped text unwraps it. */
export function wrap({ value, start, end }: Sel, mark: string, placeholder = "text"): Sel {
  const before = value.slice(0, start), chosen = value.slice(start, end), after = value.slice(end);
  if (chosen && before.endsWith(mark) && after.startsWith(mark)) {
    return { value: before.slice(0, -mark.length) + chosen + after.slice(mark.length), start: start - mark.length, end: end - mark.length };
  }
  const inner = chosen || placeholder;
  return { value: before + mark + inner + mark + after, start: start + mark.length, end: start + mark.length + inner.length };
}

const STRIP = /^(#{1,3} |- \[[ xX]\] |\d+\. |- |> )/;

/** Put a prefix at the start of every selected line (lists, quote, headings, checklist). If every line already has it, it is removed instead; numbered lists count from 1. */
export function prefixLines({ value, start, end }: Sel, prefix: string | "1."): Sel {
  const from = lineStart(value, start), to = lineEnd(value, end);
  const lines = value.slice(from, to).split("\n");
  const numbered = prefix === "1.";
  const pre = (i: number) => (numbered ? `${i + 1}. ` : prefix);
  const has = (l: string, i: number) => l.startsWith(pre(i)) && !(prefix === "- " && /^- \[[ xX]\] /.test(l));
  const all = lines.every(has);
  const text = lines.map((l, i) => (all ? l.slice(pre(i).length) : pre(i) + l.replace(STRIP, ""))).join("\n");
  return { value: value.slice(0, from) + text + value.slice(to), start: from, end: from + text.length };
}

export const heading = (s: Sel, level: 1 | 2 | 3) => prefixLines(s, "#".repeat(level) + " ");

/** A table with a header row, ready to fill in (the cursor lands in the first header cell). */
export function insertTable({ value, start, end }: Sel, columns = 3, rows = 2): Sel {
  const head = `| ${Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(" | ")} |`;
  const sep = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  const body = Array.from({ length: rows }, () => `| ${Array.from({ length: columns }, () => " ").join(" | ")} |`);
  const lead = start > 0 && value[start - 1] !== "\n" ? "\n\n" : "";
  const table = `${lead}${[head, sep, ...body].join("\n")}\n`;
  return { value: value.slice(0, start) + table + value.slice(end), start: start + lead.length + 2, end: start + lead.length + 10 };
}

/** [text](url) around the selection. The url is checked by the renderer too: only http, https and mailto links are ever produced. */
export function insertLink({ value, start, end }: Sel, url: string, label?: string): Sel {
  const text = value.slice(start, end) || label || "link";
  const md = `[${text.replace(/[\[\]]/g, "")}](${url.trim()})`;
  return { value: value.slice(0, start) + md + value.slice(end), start: start + md.length, end: start + md.length };
}

// Light formatting for free-text comments, stored as plain text in a small markdown-like subset and never as HTML:
//   **bold**   _italic_   ++underline++   "- " bullets   "1. " numbered   a blank line starts a new paragraph   \ escapes the next character
// Rendering builds HTML only from this subset: every character of the person's text is escaped and the only tags ever produced are
// b, i, u, p, br, ul, ol and li, so nothing a person types (or pastes) can run as markup.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Mark = "b" | "i" | "u";

/** One line of the subset as HTML (marks toggle on and off; anything left open is closed at the end of the line). */
function inlineToHtml(src: string): string {
  const open: Mark[] = [];
  let out = "";
  const toggle = (m: Mark) => {
    const at = open.lastIndexOf(m);
    if (at === -1) { open.push(m); out += `<${m}>`; return; }
    // close everything above it, then the mark, then reopen what was above it, so tags never cross
    const above = open.splice(at + 1);
    for (let i = above.length - 1; i >= 0; i--) out += `</${above[i]}>`;
    open.pop(); out += `</${m}>`;
    for (const a of above) { open.push(a); out += `<${a}>`; }
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length) { out += escapeHtml(src[++i]); continue; }
    if (c === "*" && src[i + 1] === "*") { toggle("b"); i++; continue; }
    if (c === "+" && src[i + 1] === "+") { toggle("u"); i++; continue; }
    if (c === "_") { toggle("i"); continue; }
    out += escapeHtml(c);
  }
  for (let i = open.length - 1; i >= 0; i--) out += `</${open[i]}>`;
  return out;
}

/** The stored text as safe HTML. */
export function markdownToHtml(md: string | null | undefined): string {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { html.push(`<p>${para.join("<br>")}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((x) => `<li>${x}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const line of lines) {
    const bullet = /^- (.*)$/.exec(line);
    const number = /^\d+\. (.*)$/.exec(line);
    if (bullet || number) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(inlineToHtml((bullet ?? number)![1]));
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(inlineToHtml(line));
    }
  }
  flushPara(); flushList();
  return html.join("");
}

const escapeInline = (s: string) => s.replace(/[\\*_+]/g, (m) => `\\${m}`);
/** A plain line that would be read as a list item is escaped so it stays text. */
const escapeLineStart = (s: string) => s.replace(/^(\s*)- /, "$1\\- ").replace(/^(\s*)(\d+)\. /, "$1$2\\. ");

interface Nodeish { nodeType: number; nodeName: string; textContent: string | null; childNodes: ArrayLike<Nodeish> }

function inlineOf(node: Nodeish): string {
  if (node.nodeType === 3) return escapeInline(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const name = node.nodeName.toUpperCase();
  if (name === "BR") return "\n";
  const inner = Array.from(node.childNodes).map(inlineOf).join("");
  if (inner.trim() === "") return inner;
  if (name === "B" || name === "STRONG") return `**${inner}**`;
  if (name === "I" || name === "EM") return `_${inner}_`;
  if (name === "U") return `++${inner}++`;
  return inner;
}

/** What the editor's content is, as the stored text. Reads the browser's DOM; nothing from it is kept except the subset above. */
export function htmlToMarkdown(root: Nodeish): string {
  const lines: string[] = [];
  let loose = "";
  const flushLoose = () => { if (loose !== "") { for (const l of loose.split("\n")) lines.push(escapeLineStart(l)); loose = ""; } };
  for (const node of Array.from(root.childNodes)) {
    const name = node.nodeName.toUpperCase();
    if (node.nodeType === 1 && (name === "UL" || name === "OL")) {
      flushLoose();
      let n = 1;
      for (const li of Array.from(node.childNodes)) {
        if (li.nodeName.toUpperCase() !== "LI") continue;
        const text = Array.from(li.childNodes).filter((c) => !["UL", "OL"].includes(c.nodeName.toUpperCase())).map(inlineOf).join("").replace(/\n+/g, " ").trim();
        lines.push(`${name === "UL" ? "-" : `${n++}.`} ${text}`);
      }
    } else if (node.nodeType === 1 && (name === "DIV" || name === "P")) {
      flushLoose();
      const text = inlineOf(node);
      for (const l of (text === "" ? [""] : text.split("\n"))) lines.push(escapeLineStart(l));
    } else {
      loose += inlineOf(node);
    }
  }
  flushLoose();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

import { safeUrl } from "./markdown";

/**
 * The visual editor edits rendered HTML in the browser; what is SAVED is always the same safe markdown text as in the text editor. This turns the edited document
 * back into that text. It is an allow-list walk: only the elements below are understood, everything else contributes only its text, and scripts, styles, frames and
 * the like contribute nothing at all. Nothing from the editor's HTML (attributes, classes, styles, event handlers, unknown tags) ever reaches storage, and a link survives
 * only if it passes the same safeUrl check the renderer applies. Pasted rich content is therefore reduced to the subset the notes support.
 */
export interface NodeLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
}

const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "HEAD", "TITLE", "META", "LINK", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA"]);
const BLOCKS = new Set(["P", "DIV", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "HR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SECTION", "ARTICLE", "PRE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const kids = (n: NodeLike) => Array.from(n.childNodes);
const name = (n: NodeLike) => n.nodeName.toUpperCase();
const attr = (n: NodeLike, a: string) => n.getAttribute?.(a) ?? null;
const clean = (s: string) => s.replace(/[  ]+/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "");

/** A person's words made literal: the characters the renderer treats as markup are escaped (the renderer honours a backslash). */
const esc = (s: string) => s.replace(/[\\*_`\[\]]/g, (m) => `\\${m}`);
/** Plus the line starts that would turn plain text into a list, heading, quote or table. */
const escLineStart = (line: string) => line.replace(/^(\s*)(#{1,3} |- |> |\d+\. )/, (_m, sp: string, tok: string) => `${sp}\\${tok}`).replace(/^(\s*)\|/, "$1\\|").replace(/^(-{3,}|\*{3,})\s*$/, "\\$1");

function inlineOf(n: NodeLike, state = { code: false }): string {
  if (n.nodeType === 3) {
    const t = clean(n.textContent ?? "");
    return state.code ? t : esc(t);
  }
  if (n.nodeType !== 1) return "";
  const tag = name(n);
  if (DROP.has(tag)) return "";
  if (tag === "BR") return "\n";
  if (tag === "SPAN" && attr(n, "data-task")) return "";
  if (tag === "SPAN" && attr(n, "data-user")) {
    const id = attr(n, "data-user") ?? "";
    const who = clean(n.textContent ?? "").replace(/^@/, "").replace(/[\]\n]/g, "").trim().slice(0, 80);
    return UUID.test(id) && who ? `@[${who}](user:${id})` : esc(clean(n.textContent ?? ""));
  }
  const inner = () => kids(n).map((c) => inlineOf(c, state)).join("");
  if (tag === "B" || tag === "STRONG") return wrap(inner(), "**");
  if (tag === "I" || tag === "EM") return wrap(inner(), "_");
  if (tag === "CODE") {
    const raw = clean(n.textContent ?? "");
    return raw && !raw.includes("`") ? `\`${raw}\`` : esc(raw);
  }
  if (tag === "A") {
    const href = attr(n, "href");
    const url = href ? safeUrl(href) : null;
    const text = inner().replace(/\n/g, " ").trim();
    return url && text ? `[${text.replace(/[\[\]]/g, "")}](${url.replace(/\)/g, "%29")})` : text;
  }
  return inner();
}

/** Marks wrap the words, not the spaces around them (the renderer needs a non-space next to each marker). */
function wrap(inner: string, mark: string): string {
  const core = inner.trim();
  if (!core) return inner;
  const lead = inner.match(/^\s*/)![0], trail = inner.match(/\s*$/)![0];
  return `${lead}${mark}${core}${mark}${trail}`;
}

const para = (n: NodeLike) => kids(n).map((c) => inlineOf(c)).join("").split("\n").map((l) => escLineStart(l.trim())).filter((l, i, a) => l !== "" || (i > 0 && i < a.length - 1)).join("\n").trim();

function listItems(list: NodeLike, ordered: boolean, out: string[], counter = { n: 0 }) {
  for (const li of kids(list)) {
    if (li.nodeType !== 1) continue;
    if (name(li) === "UL" || name(li) === "OL") { listItems(li, name(li) === "OL", out, { n: 0 }); continue; }
    if (name(li) !== "LI") continue;
    counter.n += 1;
    const task = kids(li).find((c) => c.nodeType === 1 && name(c) === "SPAN" && attr(c, "data-task"));
    const text = kids(li).filter((c) => !(c.nodeType === 1 && (name(c) === "UL" || name(c) === "OL"))).map((c) => inlineOf(c)).join("").replace(/\n+/g, " ").trim();
    const mark = task ? (attr(task, "data-task") === "done" ? "- [x] " : "- [ ] ") : ordered ? `${counter.n}. ` : "- ";
    if (text || task) out.push(mark + text);
    for (const sub of kids(li)) if (sub.nodeType === 1 && (name(sub) === "UL" || name(sub) === "OL")) listItems(sub, name(sub) === "OL", out, { n: 0 });
  }
}

function table(t: NodeLike): string {
  const rows: string[][] = [];
  const walk = (n: NodeLike) => {
    for (const c of kids(n)) {
      if (c.nodeType !== 1) continue;
      if (name(c) === "TR") rows.push(kids(c).filter((x) => x.nodeType === 1 && (name(x) === "TD" || name(x) === "TH")).map((x) => kids(x).map((y) => inlineOf(y)).join("").replace(/\s*\n+\s*/g, " ").replace(/\|/g, "¦").trim()));
      else if (["THEAD", "TBODY", "TFOOT"].includes(name(c))) walk(c);
    }
  };
  walk(t);
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!rows.length || width === 0) return "";
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] || " ").join(" | ")} |`;
  return [pad(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(pad)].join("\n");
}

function blocks(parent: NodeLike, out: string[]) {
  let run: NodeLike[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = run.map((c) => inlineOf(c)).join("").split("\n").map((l) => escLineStart(l.trim())).join("\n").trim();
    if (text) out.push(text);
    run = [];
  };
  for (const c of kids(parent)) {
    if (c.nodeType === 3) { run.push(c); continue; }
    if (c.nodeType !== 1) continue;
    const tag = name(c);
    if (DROP.has(tag)) continue;
    if (!BLOCKS.has(tag)) { run.push(c); continue; }
    flush();
    if (tag === "UL" || tag === "OL") { const items: string[] = []; listItems(c, tag === "OL", items); if (items.length) out.push(items.join("\n")); }
    else if (/^H[1-6]$/.test(tag)) { const level = tag === "H1" || tag === "H2" || tag === "H3" ? 1 : tag === "H4" ? 2 : 3; const t = para(c).replace(/\n/g, " "); if (t) out.push(`${"#".repeat(level)} ${t}`); }
    else if (tag === "BLOCKQUOTE") { const t = para(c); if (t) out.push(t.split("\n").map((l) => `> ${l}`).join("\n")); }
    else if (tag === "HR") out.push("---");
    else if (tag === "TABLE") { const t = table(c); if (t) out.push(t); }
    else if (tag === "LI") { const items: string[] = []; listItems({ nodeType: 1, nodeName: "UL", textContent: null, childNodes: [c] }, false, items); if (items.length) out.push(items.join("\n")); }
    else if (kids(c).some((x) => x.nodeType === 1 && BLOCKS.has(name(x)))) blocks(c, out);
    else { const t = para(c); if (t) out.push(t); }
  }
  flush();
}

/** The edited document as the notes' markdown text. */
export function htmlToMarkdown(root: NodeLike): string {
  const out: string[] = [];
  blocks(root, out);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

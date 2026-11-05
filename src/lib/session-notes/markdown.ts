// The note format of the Session Notes module: a small markdown subset, stored as text and rendered to HTML ONLY by this file.
//
//   # Heading   ## Subheading   ### Minor heading        (shown one level lower on the page, so the page's own title stays the top heading)
//   **bold**   _italic_ or *italic*   `code`   [text](https://link)   (links: http, https and mailto only)
//   - bullet   1. numbered   - [ ] open item   - [x] done item        > quote   ---  rule
//   | a | b |  tables: a header row, a separator row (| --- | --- |), then rows
//   @[Full name](user:<uuid>)  a mention of a colleague (shown as @Full name; the database tells that person, only if they may read the note)
//
// Safety: every character a person typed is HTML-escaped before it is placed in the output; the only tags this file ever produces are the ones listed in
// ALLOWED_TAGS, none of them carries an attribute the person controls except a link's href (which must pass safeUrl), and nothing is ever evaluated.
// A note is therefore never HTML, and pasted markup, scripts, event handlers, javascript: and data: links appear as plain text or as dead text.

export interface RenderOptions {
  /** Markup for the visual editor: checklist items carry data-task and mentions carry data-user, so the editor can turn the edited result back into this same text. */
  editable?: boolean;
}

export const MENTION_PATTERN = /@\[([^\]\n]{1,80})\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

export const ALLOWED_TAGS = ["h3", "h4", "h5", "p", "br", "strong", "em", "code", "ul", "ol", "li", "blockquote", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "span"] as const;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A link target is kept only if it is http, https or mailto after the browser's own cleaning (control characters and spaces removed). */
export function safeUrl(raw: string): string | null {
  // browsers ignore tabs, newlines and other control characters inside a scheme ("java\tscript:"), so they are removed before the check
  const cleaned = raw.replace(/[\u0000- \u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "");
  if (!/^(https?:\/\/|mailto:)/i.test(cleaned)) return null;
  if (cleaned.length > 2000) return null;
  try {
    const u = new URL(cleaned);
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) return null;
    return u.href;
  } catch { return null; }
}

/** One line of inline markdown as HTML. */
function inline(src: string, o: RenderOptions = {}): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length) { out += escapeHtml(src[i + 1]); i += 2; continue; }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { out += `<code>${escapeHtml(src.slice(i + 1, end))}</code>`; i = end + 1; continue; }
    }
    if (c === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) { out += `<strong>${inline(src.slice(i + 2, end), o)}</strong>`; i = end + 2; continue; }
    }
    if (c === "_" || c === "*") {
      const end = src.indexOf(c, i + 1);
      if (end > i + 1 && src[i + 1] !== " " && src[end - 1] !== " ") { out += `<em>${inline(src.slice(i + 1, end), o)}</em>`; i = end + 1; continue; }
    }
    if (c === "@" && src[i + 1] === "[") {
      const m = /^@\[([^\]\n]{1,80})\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/.exec(src.slice(i));
      if (m && m[1].trim()) {
        out += o.editable ? `<span class="mention" data-user="${m[2]}" contenteditable="false">@${escapeHtml(m[1])}</span>` : `<span class="mention">@${escapeHtml(m[1])}</span>`;
        i += m[0].length;
        continue;
      }
    }
    if (c === "[") {
      const close = src.indexOf("](", i + 1);
      const end = close === -1 ? -1 : src.indexOf(")", close + 2);
      if (close > i && end > close) {
        const label = src.slice(i + 1, close);
        const url = safeUrl(src.slice(close + 2, end));
        if (url && label.trim()) { out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${inline(label, o)}</a>`; i = end + 1; continue; }
      }
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
const isSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");

/** The stored note text as safe HTML. */
export function markdownToHtml(md: string | null | undefined, o: RenderOptions = {}): string {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { html.push(`<p>${para.join("<br>")}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((x) => `<li>${x}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    const check = /^- \[( |x|X)\] (.*)$/.exec(line);
    const bullet = /^- (.*)$/.exec(line);
    const number = /^\d+\. (.*)$/.exec(line);
    if (heading) { flushPara(); flushList(); const tag = (["h3", "h4", "h5"] as const)[heading[1].length - 1]; html.push(`<${tag}>${inline(heading[2], o)}</${tag}>`); continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); html.push("<hr>"); continue; }
    if (line.startsWith("> ")) { flushPara(); flushList(); html.push(`<blockquote>${inline(line.slice(2), o)}</blockquote>`); continue; }
    if (line.includes("|") && n + 1 < lines.length && isSeparator(lines[n + 1]) && splitRow(line).length >= 1) {
      flushPara(); flushList();
      const head = splitRow(line);
      const rows: string[][] = [];
      let k = n + 2;
      while (k < lines.length && lines[k].includes("|") && lines[k].trim() !== "") { rows.push(splitRow(lines[k])); k++; }
      html.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h, o)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, ci) => `<td>${inline(r[ci] ?? "", o)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      n = k - 1;
      continue;
    }
    if (check || bullet || number) {
      flushPara();
      const tag = number ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      if (check && o.editable) list.items.push(`<span data-task="${check[1] === " " ? "open" : "done"}" contenteditable="false" class="task-box">${check[1] === " " ? "☐" : "☑"}</span> ${inline(check[2], o)}`);
      else if (check) list.items.push(`<span aria-hidden="true">${check[1] === " " ? "☐" : "☑"}</span> <span class="sr-only">${check[1] === " " ? "Open: " : "Done: "}</span>${inline(check[2], o)}`);
      else list.items.push(inline((bullet ?? number)![1], o));
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(inline(line, o));
    }
  }
  flushPara(); flushList();
  return html.join("");
}

/** Plain text of a note (for search snippets, exports and AI input): the markers removed, nothing evaluated. */
export function markdownToText(md: string | null | undefined): string {
  return (md ?? "").replace(/\r\n?/g, "\n").replace(MENTION_PATTERN, "@$1")
    .replace(/^#{1,3} /gm, "").replace(/^- \[( |x|X)\] /gm, (_m, c: string) => (c === " " ? "[ ] " : "[x] ")).replace(/^[-*] /gm, "• ").replace(/^> /gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[\s(])[_*]([^_*\n]+)[_*]/g, "$1$2").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*\|?\s*:?-{3,}:?[\s|:-]*$/gm, "").replace(/\|/g, "  ").trim();
}

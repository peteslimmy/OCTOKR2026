import { describe, expect, it } from "vitest";
import { htmlToMarkdown, type NodeLike } from "../html-to-markdown";
import { markdownToHtml, markdownToText } from "../markdown";

const ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const txt = (s: string): NodeLike => ({ nodeType: 3, nodeName: "#text", textContent: s, childNodes: [] });
const el = (tag: string, attrs: Record<string, string> = {}, ...kids: (NodeLike | string)[]): NodeLike => {
  const childNodes = kids.map((k) => (typeof k === "string" ? txt(k) : k));
  return { nodeType: 1, nodeName: tag.toUpperCase(), textContent: childNodes.map((c) => c.textContent ?? "").join(""), childNodes, getAttribute: (n) => attrs[n] ?? null };
};
const doc = (...kids: (NodeLike | string)[]) => el("div", {}, ...kids);

describe("mentions in the note format", () => {
  it("renders a mention as @Name, with no link and no id in the reading view", () => {
    expect(markdownToHtml(`Ask @[Ada Obi](user:${ID}) today`)).toBe('<p>Ask <span class="mention">@Ada Obi</span> today</p>');
  });
  it("keeps the person id only in the editing markup", () => {
    expect(markdownToHtml(`@[Ada](user:${ID})`, { editable: true })).toContain(`data-user="${ID}"`);
  });
  it("escapes the name, and ignores a token whose id is not a uuid", () => {
    expect(markdownToHtml(`@[<b>x</b>](user:${ID})`)).toContain("@&lt;b&gt;x&lt;/b&gt;");
    expect(markdownToHtml("@[Ada](user:not-an-id)")).not.toContain("mention");
  });
  it("reads as @Name in plain text (search snippets, exports, the AI input)", () => {
    expect(markdownToText(`Thanks @[Ada Obi](user:${ID})`)).toBe("Thanks @Ada Obi");
  });
});

describe("visual editor: edited HTML back to the note's markdown", () => {
  it("converts headings, emphasis, lists and a checklist", () => {
    const d = doc(
      el("h3", {}, "Performance"), el("p", {}, "Success ", el("b", {}, "dropped"), " to ", el("i", {}, "91%")),
      el("ul", {}, el("li", {}, "one"), el("li", {}, "two")), el("ol", {}, el("li", {}, "first"), el("li", {}, "second")),
      el("ul", {}, el("li", {}, el("span", { "data-task": "open" }, "☐"), " ask for export"), el("li", {}, el("span", { "data-task": "done" }, "☑"), " logged")),
    );
    expect(htmlToMarkdown(d)).toBe("# Performance\n\nSuccess **dropped** to _91%_\n\n- one\n- two\n\n1. first\n2. second\n\n- [ ] ask for export\n- [x] logged");
  });
  it("converts a table, a quote, a rule, a link and a mention", () => {
    const d = doc(
      el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Day"), el("th", {}, "Rate"))), el("tbody", {}, el("tr", {}, el("td", {}, "Mon"), el("td", {}, "93%")))),
      el("blockquote", {}, "said so"), el("hr"),
      el("p", {}, el("a", { href: "https://bank.example/x" }, "Bank"), " and ", el("span", { "data-user": ID, contenteditable: "false" }, "@Ada Obi")),
    );
    expect(htmlToMarkdown(d)).toBe(`| Day | Rate |\n| --- | --- |\n| Mon | 93% |\n\n> said so\n\n---\n\n[Bank](https://bank.example/x) and @[Ada Obi](user:${ID})`);
  });
  it("treats bare text and divs (what browsers produce on Enter) as paragraphs", () => {
    expect(htmlToMarkdown(doc("first line", el("div", {}, "second"), el("div", {}, el("br"))))).toBe("first line\n\nsecond");
  });
  it("makes typed markup characters literal, so they cannot become formatting", () => {
    expect(htmlToMarkdown(doc(el("p", {}, "a *star* and _under_ and [x](y)")))).toBe("a \\*star\\* and \\_under\\_ and \\[x\\](y)");
    expect(htmlToMarkdown(doc(el("p", {}, "- not a list")))).toBe("\\- not a list");
    expect(htmlToMarkdown(doc(el("p", {}, "# not a heading")))).toBe("\\# not a heading");
    expect(markdownToHtml(htmlToMarkdown(doc(el("p", {}, "- not a list"))))).toBe("<p>- not a list</p>");
  });
  it("puts marks around the words, not the spaces", () => {
    expect(htmlToMarkdown(doc(el("p", {}, "a", el("b", {}, " bold "), "b")))).toBe("a **bold** b");
  });
});

describe("visual editor: nothing dangerous survives", () => {
  it("drops scripts, styles and frames entirely and keeps no attributes", () => {
    const d = doc(el("p", { onclick: "alert(1)", style: "x" }, "hello"), el("script", {}, "alert(1)"), el("style", {}, "p{}"), el("iframe", { src: "javascript:alert(1)" }, "frame"));
    expect(htmlToMarkdown(d)).toBe("hello");
  });
  it("keeps a link only if it passes the same check as the renderer", () => {
    expect(htmlToMarkdown(doc(el("p", {}, el("a", { href: "javascript:alert(1)" }, "click"))))).toBe("click");
    expect(htmlToMarkdown(doc(el("p", {}, el("a", { href: "java\tscript:alert(1)" }, "click"))))).toBe("click");
    expect(htmlToMarkdown(doc(el("p", {}, el("a", { href: "data:text/html,x" }, "click"))))).toBe("click");
    expect(htmlToMarkdown(doc(el("p", {}, el("a", { href: "https://ok.example" }, "ok"))))).toBe("[ok](https://ok.example/)");
  });
  it("accepts a mention only with a real uuid", () => {
    expect(htmlToMarkdown(doc(el("p", {}, el("span", { "data-user": "x\" onmouseover=\"y" }, "@Eve"))))).toBe("@Eve");
  });
  it("turns pasted unknown markup into its plain text", () => {
    const d = doc(el("p", {}, el("font", { color: "red" }, "red "), el("u", {}, "underlined"), el("marquee", {}, " moving")));
    expect(htmlToMarkdown(d)).toBe("red underlined moving");
  });
  it("the result is always something the safe renderer accepts: round trip stays inside the allowed tags", () => {
    const evil = doc(el("p", {}, '<img src=x onerror=alert(1)> **x**'), el("ul", {}, el("li", {}, el("a", { href: "https://a.example" }, "ok"))));
    const html = markdownToHtml(htmlToMarkdown(evil));
    expect(html).not.toMatch(/<img/);
    expect(html).toContain("&lt;img");
  });
});

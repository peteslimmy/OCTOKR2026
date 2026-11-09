import { describe, expect, it } from "vitest";
import { joinSections, splitAlignment, splitSections } from "../format";
import { htmlToMarkdown, type NodeLike } from "../html-to-markdown";
import { ALLOWED_TAGS, markdownToHtml, markdownToText } from "../markdown";

const txt = (s: string): NodeLike => ({ nodeType: 3, nodeName: "#text", textContent: s, childNodes: [] });
const el = (tag: string, attrs: Record<string, string> = {}, ...kids: (NodeLike | string)[]): NodeLike => {
  const childNodes = kids.map((k) => (typeof k === "string" ? txt(k) : k));
  return { nodeType: 1, nodeName: tag.toUpperCase(), textContent: childNodes.map((c) => c.textContent ?? "").join(""), childNodes, getAttribute: (n) => attrs[n] ?? null };
};
const doc = (...kids: (NodeLike | string)[]) => el("div", {}, ...kids);

describe("note format: underline, strike-through, colour, highlight", () => {
  it("renders each mark with fixed tags and classes only", () => {
    expect(markdownToHtml("++under++ and ~~gone~~")).toBe("<p><u>under</u> and <s>gone</s></p>");
    expect(markdownToHtml("{c:red}stop{/c} {h:yellow}look{/h}")).toBe('<p><span class="tc-red">stop</span> <span class="hl-yellow">look</span></p>');
    expect(markdownToHtml("**{c:blue}both{/c}**")).toBe('<p><strong><span class="tc-blue">both</span></strong></p>');
  });
  it("accepts only the named colours; anything else stays dead text", () => {
    const html = markdownToHtml('{c:red;background:url(x)}bad{/c} {c:javascript}x{/c} {h:#ff0000}y{/h}');
    expect(html).not.toContain("<span");
    expect(html).not.toContain("style");
  });
  it("round-trips through the editor's HTML", () => {
    const d = doc(el("p", {}, el("u", {}, "under"), " ", el("s", {}, "gone"), " ", el("span", { "data-c": "red" }, "red"), " ", el("span", { "data-h": "green" }, "mark")));
    expect(htmlToMarkdown(d)).toBe("++under++ ~~gone~~ {c:red}red{/c} {h:green}mark{/h}");
  });
  it("drops a colour or highlight that is not in the palette", () => {
    const d = doc(el("p", {}, el("span", { "data-c": "red;x:y" }, "a"), el("span", { "data-h": "#fff" }, "b")));
    expect(htmlToMarkdown(d)).toBe("ab");
  });
  it("makes typed markers literal so a person cannot create formatting by typing them", () => {
    const md = htmlToMarkdown(doc(el("p", {}, "a ++b++ ~~c~~ {c:red}d{/c} {center}e")));
    expect(md).toBe("a \\+\\+b\\+\\+ \\~\\~c\\~\\~ \\{c:red}d\\{/c} \\{center}e");
    expect(markdownToHtml(md)).not.toMatch(/<(u|s)>|class=/);
  });
  it("is plain text in exports", () => {
    expect(markdownToText("++u++ ~~s~~ {c:red}r{/c} {h:yellow}h{/h}")).toBe("u s r h");
  });
  it("adds only u and s to the tags a note can produce", () => {
    expect(ALLOWED_TAGS).toContain("u");
    expect(ALLOWED_TAGS).toContain("s");
  });
});

describe("note format: alignment", () => {
  it("aligns a paragraph, a heading and a quote, and only with the three known words", () => {
    expect(markdownToHtml("{center}Hello")).toBe('<p data-align="center">Hello</p>');
    expect(markdownToHtml("## {right}Title")).toBe('<h4 data-align="right">Title</h4>');
    expect(markdownToHtml("> {justify}Said")).toBe('<blockquote data-align="justify">Said</blockquote>');
    expect(markdownToHtml("{left}x{evil}")).toBe("<p>{left}x{evil}</p>");
    expect(splitAlignment("{center}a")).toEqual({ align: "center", rest: "a" });
  });
  it("round-trips from the editor's data-align", () => {
    const d = doc(el("h4", { "data-align": "center" }, "Title"), el("p", { "data-align": "right" }, "Body"), el("p", { "data-align": "evil" }, "Plain"), el("blockquote", { "data-align": "justify" }, "Q"));
    expect(htmlToMarkdown(d)).toBe("## {center}Title\n\n{right}Body\n\nPlain\n\n> {justify}Q");
  });
});

describe("note format: nested lists", () => {
  it("renders nesting by two spaces per level", () => {
    expect(markdownToHtml("- a\n  - b\n    - c\n- d")).toBe("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>");
    expect(markdownToHtml("1. a\n  - b\n2. c")).toBe("<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>");
  });
  it("cannot jump more than one level down and stops at three levels", () => {
    expect(markdownToHtml("- a\n      - far")).toBe("<ul><li>a<ul><li>far</li></ul></li></ul>");
    expect(markdownToHtml("- a\n  - b\n    - c\n      - d")).toBe("<ul><li>a<ul><li>b<ul><li>c</li><li>d</li></ul></li></ul></li></ul>");
  });
  it("keeps a nested checklist and writes the same text back from the editor's HTML", () => {
    const md = "- one\n  - [ ] two\n  - [x] three\n- four";
    expect(markdownToHtml(md, { editable: true })).toContain('data-task="open"');
    const d = doc(el("ul", {}, el("li", {}, el("p", {}, "one"), el("ul", {}, el("li", {}, el("p", {}, el("span", { "data-task": "open" }, "☐"), " two")), el("li", {}, el("p", {}, el("span", { "data-task": "done" }, "☑"), " three")))), el("li", {}, el("p", {}, "four"))));
    expect(htmlToMarkdown(d)).toBe(md);
  });
  it("accepts a task box inside a paragraph in the item and an empty checklist line", () => {
    expect(markdownToHtml("- [ ]")).toContain("☐");
    expect(htmlToMarkdown(doc(el("ul", {}, el("li", {}, el("p", {}, el("span", { "data-task": "open" }, "☐")))))).trim()).toBe("- [ ]");
  });
});

describe("note sections", () => {
  it("cuts the text at its '## ' headings and joins it back unchanged", () => {
    const md = "## Notes\n\nSome **text**\n\n## Actions\n\n- [ ] ask\n\n### Detail\n\nmore";
    const s = splitSections(md);
    expect(s.map((x) => x.title)).toEqual(["Notes", "Actions"]);
    expect(s[1].md).toBe("- [ ] ask\n\n### Detail\n\nmore");
    expect(joinSections(s)).toBe(md);
  });
  it("splits the template the Take notes page creates", () => {
    const s = splitSections("## Notes\n\n\n## Recommendations\n\n\n## Actions\n\n- [ ] \n\n## Next steps\n\n");
    expect(s.map((x) => x.title)).toEqual(["Notes", "Recommendations", "Actions", "Next steps"]);
    expect(s[2].md).toBe("- [ ]");
  });
  it("keeps text before the first heading in a card of its own", () => {
    const s = splitSections("Intro line\n\n## Notes\n\nbody");
    expect(s.map((x) => x.title)).toEqual([null, "Notes"]);
    expect(joinSections(s)).toBe("Intro line\n\n## Notes\n\nbody");
  });
  it("starts an empty note with the four standard cards, and an empty card keeps its heading", () => {
    const s = splitSections("");
    expect(s.map((x) => x.title)).toEqual(["Notes", "Recommendations", "Actions", "Next steps"]);
    expect(joinSections(s)).toBe("## Notes\n\n## Recommendations\n\n## Actions\n\n- [ ]\n\n## Next steps");
  });
  it("does not treat an escaped or a lower-level heading as a card boundary", () => {
    expect(splitSections("## A\n\n\\## not a heading\n\n### sub\n\n# big").length).toBe(1);
  });
});

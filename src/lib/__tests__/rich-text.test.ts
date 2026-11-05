import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "../rich-text";

type N = { nodeType: number; nodeName: string; textContent: string | null; childNodes: N[] };
const text = (t: string): N => ({ nodeType: 3, nodeName: "#text", textContent: t, childNodes: [] });
const el = (name: string, ...kids: N[]): N => ({ nodeType: 1, nodeName: name, textContent: null, childNodes: kids });

describe("rich text subset", () => {
  it("turns marks, paragraphs and lists into the few tags it allows", () => {
    expect(markdownToHtml("**Good** week, _really_ ++great++")).toBe("<p><b>Good</b> week, <i>really</i> <u>great</u></p>");
    expect(markdownToHtml("Line one\nLine two\n\nNext paragraph")).toBe("<p>Line one<br>Line two</p><p>Next paragraph</p>");
    expect(markdownToHtml("- a\n- b\n\n1. x\n2. y")).toBe("<ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>");
  });

  it("never lets typed markup through", () => {
    const out = markdownToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> "quoted" & more');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp; more");
  });

  it("keeps tags from crossing and closes anything left open", () => {
    expect(markdownToHtml("**a _b** c_")).toBe("<p><b>a <i>b</i></b><i> c</i></p>");
    expect(markdownToHtml("**never closed")).toBe("<p><b>never closed</b></p>");
  });

  it("treats a backslash as an escape", () => {
    expect(markdownToHtml("2 \\* 3 \\_ \\+\\+")).toBe("<p>2 * 3 _ ++</p>");
    expect(markdownToHtml("\\- not a bullet")).toBe("<p>- not a bullet</p>");
  });

  it("reads the editor's DOM back into the stored text", () => {
    const dom = el("DIV", el("DIV", el("B", text("Good")), text(" week")), el("UL", el("LI", text("one")), el("LI", el("I", text("two")))));
    expect(htmlToMarkdown(dom)).toBe("**Good** week\n- one\n- _two_");
    expect(htmlToMarkdown(el("DIV", el("DIV", text("- looks like a bullet"))))).toBe("\\- looks like a bullet");
    expect(htmlToMarkdown(el("DIV", el("DIV", text("a * b"))))).toBe("a \\* b");
  });

  it("round-trips what the editor produces", () => {
    const md = "**Bold** and _italic_\n\n- first\n- second";
    const html = markdownToHtml(md);
    expect(html).toBe("<p><b>Bold</b> and <i>italic</i></p><ul><li>first</li><li>second</li></ul>");
  });
});

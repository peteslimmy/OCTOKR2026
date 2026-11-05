import { describe, expect, it } from "vitest";
import { ALLOWED_TAGS, markdownToHtml, markdownToText, safeUrl } from "../markdown";

const tagsIn = (html: string) => [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());

describe("session note markdown: what it renders", () => {
  it("renders headings one level down so the page title stays on top", () => {
    expect(markdownToHtml("# Title\n## Sub\n### Minor")).toBe("<h3>Title</h3><h4>Sub</h4><h5>Minor</h5>");
  });
  it("renders bold, italic, code and paragraphs", () => {
    expect(markdownToHtml("a **b** _c_ `d`\nsecond line")).toBe("<p>a <strong>b</strong> <em>c</em> <code>d</code><br>second line</p>");
  });
  it("renders bullet, numbered and checklists", () => {
    expect(markdownToHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(markdownToHtml("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    const c = markdownToHtml("- [ ] open\n- [x] done");
    expect(c).toContain("Open: ");
    expect(c).toContain("Done: ");
    expect(c).toContain("☐");
    expect(c).toContain("☑");
  });
  it("renders a table with a header row", () => {
    const html = markdownToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 |");
    expect(html).toBe("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td></td></tr></tbody></table>");
  });
  it("renders safe links with rel attributes and opens them in a new tab", () => {
    expect(markdownToHtml("[Bank](https://example.com/a?b=1&c=2)")).toBe('<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">Bank</a></p>');
    expect(markdownToHtml("[Mail](mailto:a@b.co)")).toContain('href="mailto:a@b.co"');
  });
  it("renders a quote and a rule", () => {
    expect(markdownToHtml("> quoted\n\n---")).toBe("<blockquote>quoted</blockquote><hr>");
  });
});

describe("session note markdown: nothing a person types can run", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    "<iframe src=\"javascript:alert(1)\"></iframe>",
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click](java\tscript:alert(1))",
    "[click](&#106;avascript:alert(1))",
    "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[click](vbscript:msgbox(1))",
    "[click](//evil.example/x)",
    "[x](https://ok.example \"onmouseover=alert(1)\")",
    "**<b onclick=alert(1)>x</b>**",
    "| <img src=x onerror=alert(1)> | b |\n| --- | --- |\n| <script>1</script> | 2 |",
    "# <script>alert(1)</script>",
    "- <a href=\"javascript:alert(1)\">x</a>",
    "`</code><script>alert(1)</script>`",
    "\\<script>alert(1)</script>",
    "![img](https://example.com/x.png)",
    "<a href=\"https://example.com\" onclick=\"alert(1)\">x</a>",
  ];
  for (const a of attacks) {
    it(`neutralises ${JSON.stringify(a).slice(0, 60)}`, () => {
      const html = markdownToHtml(a);
      // only the tags this renderer produces ever appear, and never as something a person wrote
      for (const t of tagsIn(html)) expect(ALLOWED_TAGS as readonly string[]).toContain(t);
      expect(html).not.toMatch(/<(script|img|svg|iframe|object|embed|style|link|meta|form|input|button|base)\b/i);
      // a real tag never carries an attribute, except a link's href, target and rel (text that merely looks like one is escaped and harmless)
      for (const m of html.matchAll(/<([a-z0-9]+)([^>]*)>/gi)) {
        if (m[1] === "a") expect(m[2]).toMatch(/^ href="[^"<>]*" target="_blank" rel="noopener noreferrer nofollow"$/);
        else if (m[1] === "span") expect(m[2]).toMatch(/^( aria-hidden="true"| class="(mention|sr-only)")?$/);
        else expect(m[2].trim()).toBe("");
      }
      expect(html).not.toMatch(/href="(?!https?:\/\/|mailto:)/i);
    });
  }
  it("escapes angle brackets and quotes in text, so markup shows as text", () => {
    expect(markdownToHtml("<b>x</b> & \"y\"")).toBe("<p>&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</p>");
  });
  it("accepts only http, https and mailto links", () => {
    expect(safeUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeUrl("HTTP://a.example")).toBe("http://a.example/");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeUrl("  javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("ftp://a.example")).toBeNull();
    expect(safeUrl("/relative")).toBeNull();
    expect(safeUrl("https://" + "a".repeat(2100))).toBeNull();
  });
  it("is not slowed by hostile input", () => {
    const t = Date.now();
    markdownToHtml("[".repeat(20000) + "](".repeat(20000) + "*".repeat(20000) + "_".repeat(20000));
    markdownToHtml(("| a ".repeat(500) + "|\n").repeat(200));
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe("markdownToText", () => {
  it("removes the markers and keeps the words", () => {
    expect(markdownToText("# Head\n**bold** and _it_\n- [x] done\n[a](https://b.example)")).toBe("Head\nbold and it\n[x] done\na (https://b.example)");
  });
});

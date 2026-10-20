import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, Field, Input } from "../primitives";

describe("Field", () => {
  it("links label, control, hint and error for assistive technology", () => {
    const html = renderToStaticMarkup(h(Field, { id: "f1", label: "Email", hint: "Work address", error: "Not valid", required: true, children: h(Input, { name: "email" }) }));
    expect(html).toContain('<label for="f1"');
    expect(html).toMatch(/<input[^>]*id="f1"/);
    expect(html).toContain('aria-describedby="f1-hint f1-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="f1-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("(required)");
  });
  it("adds nothing it was not given", () => {
    const html = renderToStaticMarkup(h(Field, { id: "f2", label: "Name", children: h(Input, {}) }));
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("required");
  });
});

describe("DataTable", () => {
  const html = renderToStaticMarkup(h(DataTable, { caption: "Things", columns: [{ label: "Name" }, { label: "Amount", align: "right" }, { label: "Actions", srOnly: true }],
    children: h("tr", null, h("td", null, "a"), h("td", null, "1"), h("td", null, "x")) }));
  it("has a caption, real column headers and a scrolling wrapper", () => {
    expect(html).toContain('<caption class="sr-only">Things</caption>');
    expect((html.match(/<th scope="col"/g) ?? []).length).toBe(3);
    expect(html).toMatch(/^<div class="[^"]*overflow-x-auto[^"]*"/);
    expect(html).toMatch(/class="relative /);               // positioned, so visually-hidden text inside cannot escape the scrolling box and widen the page
    expect(html).toContain('tabindex="0"');                 // a scrolling area must be reachable from the keyboard
    expect(html).toContain('role="region" aria-label="Things"');
  });
  it("right-aligns numeric headers and hides visually-empty ones from sight but not from screen readers", () => {
    expect(html).toMatch(/text-right[^>]*>Amount/);
    expect(html).toContain('<span class="sr-only">Actions</span>');
  });
});

import { describe, expect, it } from "vitest";
import { draftStorageKey, isTransient, needsLeaveGuard, readDraft, retryDelay } from "../autosave";
import { heading, insertLink, insertTable, prefixLines, wrap } from "../editor-ops";

describe("editor operations", () => {
  it("wraps a selection and unwraps it again", () => {
    const a = wrap({ value: "hello world", start: 6, end: 11 }, "**");
    expect(a.value).toBe("hello **world**");
    expect(wrap({ value: a.value, start: a.start, end: a.end }, "**").value).toBe("hello world");
  });
  it("inserts a placeholder pair with nothing selected", () => {
    const r = wrap({ value: "", start: 0, end: 0 }, "_", "text");
    expect(r).toEqual({ value: "_text_", start: 1, end: 5 });
  });
  it("makes bullet, numbered and checklist lines and removes them again", () => {
    const v = "one\ntwo";
    const b = prefixLines({ value: v, start: 0, end: v.length }, "- ");
    expect(b.value).toBe("- one\n- two");
    expect(prefixLines({ value: b.value, start: 0, end: b.value.length }, "- ").value).toBe(v);
    const n = prefixLines({ value: v, start: 0, end: v.length }, "1.");
    expect(n.value).toBe("1. one\n2. two");
    const c = prefixLines({ value: b.value, start: 0, end: b.value.length }, "- [ ] ");
    expect(c.value).toBe("- [ ] one\n- [ ] two");
    expect(prefixLines({ value: c.value, start: 0, end: c.value.length }, "- ").value).toBe("- one\n- two");
  });
  it("replaces a heading level rather than stacking it", () => {
    const h1 = heading({ value: "Title", start: 0, end: 5 }, 1);
    expect(h1.value).toBe("# Title");
    expect(heading({ value: h1.value, start: 0, end: h1.value.length }, 2).value).toBe("## Title");
  });
  it("inserts a table on its own lines and a link around the selection", () => {
    const t = insertTable({ value: "intro", start: 5, end: 5 }, 2, 1);
    expect(t.value).toBe("intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n");
    expect(insertLink({ value: "see Bank now", start: 4, end: 8 }, "https://b.example").value).toBe("see [Bank](https://b.example) now");
  });
});

describe("save-state rules", () => {
  it("guards leaving the page whenever something might be unsaved", () => {
    for (const s of ["dirty", "saving", "failed", "retrying", "conflict"] as const) expect(needsLeaveGuard(s)).toBe(true);
    expect(needsLeaveGuard("saved")).toBe(false);
  });
  it("retries a few times with growing pauses, then stops", () => {
    expect(retryDelay(0)).toBe(2000);
    expect(retryDelay(1)).toBe(5000);
    expect(retryDelay(2)).toBe(15000);
    expect(retryDelay(3)).toBeNull();
  });
  it("retries network and server failures but not refusals or conflicts", () => {
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 409, code: "VERSION_CONFLICT" })).toBe(false);
    expect(isTransient({ status: 403 })).toBe(false);
    expect(isTransient({ status: 422 })).toBe(false);
  });
  it("reads back a stored unsent draft, and ignores a damaged one", () => {
    const d = { title: "t", category: "GENERAL_DISCUSSION", visibility: "SHARED", content: "words", baseVersion: 3, at: "2031-01-07T10:00:00Z" };
    expect(readDraft(JSON.stringify(d))).toEqual(d);
    expect(readDraft("{not json")).toBeNull();
    expect(readDraft(JSON.stringify({ content: 1 }))).toBeNull();
    expect(readDraft(null)).toBeNull();
    expect(draftStorageKey("abc")).toBe("okr-note-draft:abc");
  });
});

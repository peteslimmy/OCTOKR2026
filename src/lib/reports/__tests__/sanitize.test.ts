import { describe, expect, it } from "vitest";
import { canonicalJson, csvEscape, pickColumns, safeCell } from "../sanitize";

describe("export sanitising", () => {
  it("neutralises every formula trigger", () => {
    for (const bad of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tTAB", "\rCR", "=HYPERLINK(\"http://x\",\"y\")"]) expect(safeCell(bad)).toBe(`'${bad}`);
  });
  it("leaves ordinary text, numbers and empties alone", () => {
    expect(safeCell("Engineering")).toBe("Engineering");
    expect(safeCell("a=b")).toBe("a=b");
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell(null)).toBeNull();
  });
  it("CSV quoting handles commas, quotes and newlines, and still defuses formulas", () => {
    expect(csvEscape('He said "hi", twice')).toBe('"He said ""hi"", twice"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(12.5)).toBe("12.5");
  });
});

describe("canonical JSON for checksums", () => {
  it("does not depend on key order at any depth, as after a jsonb round trip", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });
});

describe("column choice", () => {
  const cols = [{ key: "a" }, { key: "b" }, { key: "c" }];
  it("only narrows, ignores unknown keys, keeps the report's order and falls back to everything", () => {
    expect(pickColumns(cols, "c,a,zzz").map((c) => c.key)).toEqual(["a", "c"]);
    expect(pickColumns(cols, "zzz").map((c) => c.key)).toEqual(["a", "b", "c"]);
    expect(pickColumns(cols, null)).toHaveLength(3);
  });
});

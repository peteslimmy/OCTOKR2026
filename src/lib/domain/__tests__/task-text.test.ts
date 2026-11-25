import { describe, expect, it } from "vitest";
import { stripLeadingNumber } from "../task-text";

describe("stripLeadingNumber", () => {
  it("removes one typed list number", () => {
    expect(stripLeadingNumber("1. Optimize taxpayer self-service portal")).toBe("Optimize taxpayer self-service portal");
    expect(stripLeadingNumber("12) Audit transaction logs")).toBe("Audit transaction logs");
    expect(stripLeadingNumber("  3 . Reconcile statements")).toBe("Reconcile statements");
  });
  it("leaves text that only starts with a number", () => {
    for (const s of ["2026 targets", "3.5% growth review", "10x throughput", "1.1 Plan", "Review 1. item"]) expect(stripLeadingNumber(s)).toBe(s);
  });
  it("removes only the first number and never returns nothing", () => {
    expect(stripLeadingNumber("1. 2. Two numbers")).toBe("2. Two numbers");
    expect(stripLeadingNumber("1. ")).toBe("1. ");
    expect(stripLeadingNumber("")).toBe("");
  });
});

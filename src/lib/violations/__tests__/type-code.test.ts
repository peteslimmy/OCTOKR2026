import { describe, expect, it } from "vitest";
import { deriveViolationTypeCode } from "../type-code";

describe("violation type code made from the name", () => {
  it("upper-cases and joins words with underscores", () => {
    expect(deriveViolationTypeCode("Late coming")).toBe("LATE_COMING");
    expect(deriveViolationTypeCode("  Phone   violation  ")).toBe("PHONE_VIOLATION");
    expect(deriveViolationTypeCode("Absent (no notice)")).toBe("ABSENT_NO_NOTICE");
  });
  it("treats names that differ only by punctuation or case as the same type", () => {
    expect(deriveViolationTypeCode("late-coming")).toBe(deriveViolationTypeCode("Late Coming"));
  });
  it("removes accents, limits the length and never ends with an underscore", () => {
    expect(deriveViolationTypeCode("Café noise")).toBe("CAFE_NOISE");
    const long = deriveViolationTypeCode("A very long violation name that goes on and on forever");
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith("_")).toBe(false);
  });
  it("falls back to a safe code when the name has no letters or digits", () => {
    expect(deriveViolationTypeCode("###")).toBe("VIOLATION_TYPE");
    expect(deriveViolationTypeCode("é")).toBe("VIOLATION_TYPE");     // a single character is too short to be a code
  });
});

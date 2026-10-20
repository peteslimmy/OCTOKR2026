import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calcBaseScore, calcFinalScore, calcQuarterlyScore, formatScore } from "../scoring";

describe("weekly base score (07-SCORING-ENGINE §14)", () => {
  it.each([
    [1, 1, "100.00"],
    [1, 0, "0.00"],
    [4, 3, "75.00"],
    [5, 4, "80.00"],
    [10, 7, "70.00"],
  ])("%i goals, %i done", (total, done, expected) => {
    expect(calcBaseScore(done, total).toFixed(2)).toBe(expected);
  });
  it("zero goals scores 0 (never divides by zero)", () => expect(calcBaseScore(0, 0).toString()).toBe("0"));
});

describe("integrity penalty: additive, applied once, floor 0, 2dp (ADR-012)", () => {
  it("80 with one 5% = 76", () => expect(calcFinalScore(80, [0.05]).final.toFixed(2)).toBe("76.00"));
  it("80 with two 5% = 72 (not compounded 72.20)", () => expect(calcFinalScore(80, [0.05, 0.05]).final.toFixed(2)).toBe("72.00"));
  it("3 with one 10% = 2.70", () => expect(calcFinalScore(3, [0.1]).final.toFixed(2)).toBe("2.70"));
  it("0 base stays 0", () => expect(calcFinalScore(0, [0.1]).final.toFixed(2)).toBe("0.00"));
  it("combined >= 100% floors at 0", () => {
    expect(calcFinalScore(80, [0.6, 0.6]).final.toFixed(2)).toBe("0.00");
    expect(calcFinalScore(80, [1]).final.toFixed(2)).toBe("0.00");
  });
  it("rounds half up to 2dp", () => expect(calcFinalScore(12.5, [0.05]).final.toFixed(2)).toBe("11.88"));
  it("exposes the combined rate", () => expect(calcFinalScore(80, [0.05, 0.1]).combinedRate.toString()).toBe("0.15"));
  it("is exact for repeating-decimal bases", () => {
    expect(calcFinalScore(calcBaseScore(1, 3), [0.05]).final.toFixed(2)).toBe("31.67");
  });
});

describe("quarterly score (ADR-032/033)", () => {
  it("averages over a fixed denominator including missing zeros", () => {
    const r = calcQuarterlyScore([{ value: 80 }, { value: 0 }, { value: 100 }, { value: 70 }]);
    expect(r.denominator).toBe(4);
    expect(r.score?.toFixed(2)).toBe("62.50");
  });
  it("excludes organisation-holiday weeks from numerator and denominator", () => {
    const r = calcQuarterlyScore([{ value: 80 }, { value: 0, excluded: true }, { value: 60 }]);
    expect(r.denominator).toBe(2);
    expect(r.score?.toFixed(2)).toBe("70.00");
  });
  it("returns N/A with a reason when no week is eligible", () => {
    const r = calcQuarterlyScore([{ value: 0, excluded: true }]);
    expect(r.score).toBeNull();
    expect(r.reason).toBe("NO_ELIGIBLE_REPORTING_WEEKS");
    expect(formatScore(r.score)).toBe("N/A");
  });
});

describe("formatScore", () => {
  it("always renders two decimals", () => expect(formatScore(new Decimal(76))).toBe("76.00"));
});

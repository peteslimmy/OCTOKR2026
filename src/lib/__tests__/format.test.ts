import { describe, expect, it } from "vitest";
import { easeOut, formatDecimal1, formatFraction, formatMetric, formatPercent, formatSigned1 } from "../format";

describe("percentage display: one decimal place", () => {
  it("always shows exactly one decimal", () => {
    expect(formatPercent(50)).toBe("50.0%");
    expect(formatPercent("75.00")).toBe("75.0%");
    expect(formatPercent(27.78)).toBe("27.8%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(100)).toBe("100.0%");
  });
  it("rounds half away from zero on the displayed digit and never mutates the input", () => {
    expect(formatPercent(66.666)).toBe("66.7%");
    expect(formatPercent(0.04)).toBe("0.0%");
    expect(formatPercent(0.05)).toBe("0.1%");
    const v = 12.345;
    formatPercent(v);
    expect(v).toBe(12.345);
  });
  it("handles fractions and missing values", () => {
    expect(formatFraction(0.05)).toBe("5.0%");
    expect(formatFraction(1)).toBe("100.0%");
    expect(formatPercent(null)).toBe("N/A");
    expect(formatPercent(undefined)).toBe("N/A");
    expect(formatPercent("abc")).toBe("N/A");
    expect(formatDecimal1(NaN)).toBe("N/A");
  });
  it("signed movement", () => {
    expect(formatSigned1(3.33)).toBe("+3.3");
    expect(formatSigned1(-1)).toBe("−1.0");
    expect(formatSigned1(0)).toBe("0.0");
    expect(formatSigned1(null)).toBe("—");
  });
});

describe("metric display and counter easing", () => {
  it("formats counts, percentages and currency from one place", () => {
    expect(formatMetric(1234, "count")).toBe("1,234");
    expect(formatMetric(2.6, "count")).toBe("3");
    expect(formatMetric(66.666, "percent")).toBe("66.7%");
    expect(formatMetric(1500, "currency")).toMatch(/1,500\.00/);
  });
  it("eases from 0 to 1 without overshooting, whatever the frame time", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    for (let t = 0; t <= 1; t += 0.05) expect(easeOut(t + 0.05)).toBeGreaterThanOrEqual(easeOut(t));
  });
});

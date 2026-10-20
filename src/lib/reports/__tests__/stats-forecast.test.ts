import { describe, expect, it } from "vitest";
import { MIN_WEEKS_FOR_FORECAST, projectQuarterEnd, scenarioQuarterEnd } from "../forecast";
import { change, linearRegression, mean, rankDescending, stdev, tCritical95, zScore } from "../stats";

describe("statistics", () => {
  it("mean and sample standard deviation", () => {
    expect(mean([])).toBeNull();
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdev([5])).toBeNull();
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
  it("linear regression recovers an exact line and needs three points", () => {
    expect(linearRegression([{ x: 0, y: 1 }, { x: 1, y: 3 }])).toBeNull();
    const r = linearRegression([0, 1, 2, 3, 4].map((x) => ({ x, y: 10 + 5 * x })))!;
    expect(r.slope).toBeCloseTo(5, 10);
    expect(r.intercept).toBeCloseTo(10, 10);
    expect(r.r2).toBeCloseTo(1, 10);
    expect(r.residualSd).toBeCloseTo(0, 8);
  });
  it("t critical values", () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 3);
    expect(tCritical95(10)).toBeCloseTo(2.228, 3);
    expect(tCritical95(100)).toBe(1.96);
    expect(tCritical95(0)).toBe(Infinity);
  });
  it("z-score is null without history or spread", () => {
    expect(zScore(50, [60])).toBeNull();
    expect(zScore(50, [60, 60, 60])).toBeNull();
    expect(zScore(40, [60, 70, 50, 60])).toBeLessThan(-1);
  });
  it("change never divides by zero or invents a baseline", () => {
    expect(change(80, 60)).toEqual({ abs: 20, pct: 33.33 });
    expect(change(80, 0)).toEqual({ abs: 80, pct: null });
    expect(change(null, 60)).toEqual({ abs: null, pct: null });
    expect(change(50, undefined)).toEqual({ abs: null, pct: null });
  });
  it("competition ranking: ties share a rank and nulls are unranked", () => {
    expect(rankDescending([90, 80, 80, 70, null])).toEqual([1, 2, 2, 4, null]);
  });
});

describe("quarter-end forecast", () => {
  const D = 12;
  it("refuses to project with too little history", () => {
    const f = projectQuarterEnd({ weeklyScores: [80, 70], denominator: D });
    expect(f.status).toBe("INSUFFICIENT_DATA");
    expect(f.projected).toBeNull();
    expect(f.limitations[0]).toContain(`at least ${MIN_WEEKS_FOR_FORECAST}`);
    expect(f.currentToDate).toBeCloseTo(12.5, 2);   // (80+70)/12: what the official formula gives today
  });
  it("reports a finished quarter as final, not as a forecast", () => {
    const scores = Array.from({ length: 12 }, () => 50);
    const f = projectQuarterEnd({ weeklyScores: scores, denominator: 12 });
    expect(f.status).toBe("COMPLETE");
    expect(f.projected).toBe(50);
    expect(f.low).toBe(50);
  });
  it("a flat history projects its own level with a tight range", () => {
    const f = projectQuarterEnd({ weeklyScores: [60, 60, 60, 60, 60], denominator: D });
    expect(f.status).toBe("OK");
    expect(f.projected).toBeCloseTo(60 * 12 / 12, 1);
    expect(f.high! - f.low!).toBeLessThan(0.01);
    expect(f.limitations.join(" ")).toMatch(/not certainty/);
    expect(f.weeksRemaining).toBe(7);
    expect(f.projectedWeeklyPath).toHaveLength(7);
  });
  it("uses the trend only when it beats the average in back-testing", () => {
    const rising = [10, 20, 30, 40, 50, 60, 70, 80];
    const f = projectQuarterEnd({ weeklyScores: rising, denominator: D });
    expect(f.method).toBe("TREND");
    expect(f.backtest.trendBeatMean).toBe(true);
    expect(f.projectedWeeklyPath.every((v) => v >= 0 && v <= 100)).toBe(true);
    const noisy = [50, 90, 40, 80, 45, 85, 55, 75];
    const g = projectQuarterEnd({ weeklyScores: noisy, denominator: D });
    expect(g.method).toBe("MEAN");
  });
  it("keeps the interval inside 0..100 and orders it", () => {
    const f = projectQuarterEnd({ weeklyScores: [0, 100, 0, 100, 0], denominator: D });
    expect(f.low!).toBeGreaterThanOrEqual(0);
    expect(f.high!).toBeLessThanOrEqual(100);
    expect(f.low!).toBeLessThanOrEqual(f.projected!);
    expect(f.projected!).toBeLessThanOrEqual(f.high!);
  });
  it("the official formula: observed weeks plus projected weeks over the fixed denominator", () => {
    const scores = [70, 70, 70, 70];
    const f = projectQuarterEnd({ weeklyScores: scores, denominator: 10 });
    expect(f.projected).toBeCloseTo((280 + 6 * 70) / 10, 1);
  });
  it("scenario arithmetic is hypothetical and bounded", () => {
    expect(scenarioQuarterEnd(280, 10, 6, 100)).toBe(88);
    expect(scenarioQuarterEnd(280, 10, 6, 150)).toBe(88);   // assumed average is capped at 100
    expect(scenarioQuarterEnd(280, 0, 6, 80)).toBeNull();
  });
});

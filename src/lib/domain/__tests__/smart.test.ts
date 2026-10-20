import { describe, expect, it } from "vitest";
import { evaluateSmart } from "../smart";

describe("SMART evaluator", () => {
  const good = evaluateSmart({
    title: "Publish 3 pricing sheets to all sales leads by Friday 17:00",
    taskDescriptions: ["Draft 3 sheets", "Review with finance", "Send to 12 leads"],
    subKrTitle: "Publish pricing sheets to sales leads",
    goalType: "KR_ALIGNED",
  });
  const weak = evaluateSmart({ title: "improve things", taskDescriptions: [], goalType: "STRETCH" });

  it("scores within 0..100 for all dimensions", () => {
    for (const e of [good, weak]) {
      for (const k of ["specific", "measurable", "achievable", "relevant", "timeBound", "overall"] as const) {
        expect(e[k]).toBeGreaterThanOrEqual(0);
        expect(e[k]).toBeLessThanOrEqual(100);
      }
    }
  });
  it("is deterministic", () => {
    const i = { title: "x", taskDescriptions: [], goalType: "STRETCH" as const };
    expect(evaluateSmart(i)).toEqual(evaluateSmart(i));
  });
  it("rates a concrete, measurable, time-bound goal well above a vague one", () => {
    expect(good.overall).toBeGreaterThan(weak.overall + 25);
  });
  it("produces warnings and suggestions for weak goals but never throws", () => {
    expect(weak.warnings.length).toBeGreaterThan(0);
    expect(weak.suggestions.length).toBeGreaterThan(0);
  });
  it("overall is the equal-weight mean of the five dimensions", () => {
    const mean = (good.specific + good.measurable + good.achievable + good.relevant + good.timeBound) / 5;
    expect(good.overall).toBeCloseTo(mean, 2);
  });
  it("carries the engine version", () => expect(good.engineVersion).toMatch(/^smart-rules-/));
});

import { describe, expect, it } from "vitest";
import { buildPredictions } from "../predictions";

const unit = (over: Record<string, unknown> = {}) => ({
  id: "u1", name: "Alpha", outlook: "AT_RISK", elapsed: 6, filed: 5, missed: 1, series: [70, 60, 55, 52, 50], scoreToDate: 48.3, projected: 52.4, variance: -17.6, last: 50, previous: 52, delta: -2, direction: "deteriorating",
  slope: -4.5, volatility: 8, maxSwing: 10, recentAvg: 51, needed: 86.1, stepUp: 35.1, remaining: 7, reachable: true, confidence: "medium", forecast: "unlikely", cause: { code: "OVER", label: "Takes on more than it finishes", detail: "d" },
  analysis: { capacity: { plannedPerWeek: 6, donePerWeek: 3, ratio: 50, overcommitted: true, carryOver: [{ title: "g", weeks: 4 }] } }, ...over,
});
const report = (units: unknown[]) => ({ units, quarterLabel: "Q4 2026", org: { target: 70 } }) as never;

describe("predictions", () => {
  it("states outcome, period, evidence, assumptions, confidence, factors and a recommendation for a unit, from the forecast's own figures", () => {
    const p = buildPredictions(report([unit()])).find((x) => x.kind === "UNIT_QUARTER")!;
    expect(p.outcome).toContain("Unlikely to reach the target");
    expect(p.outcome).toContain("52%");
    expect(p.outcome).toContain("-18 points");
    expect(p).toMatchObject({ period: "Q4 2026", confidence: "medium", concern: 3, subject: "Alpha" });
    expect(p.evidence.join(" ")).toContain("5 of 6 settled weeks filed, 1 missed");
    expect(p.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(p.factors.join(" ")).toContain("falling");
    expect(p.factors.join(" ")).toContain("1 week with no report counted as zero");
    expect(p.recommendation).toContain("rise by about 35 points");
    expect(p.recommendation).toContain("takes on more than it finishes");
  });

  it("says plainly when a unit cannot be forecast yet, rather than inventing a number", () => {
    const p = buildPredictions(report([unit({ forecast: "none", projected: null, confidence: "low", series: [], filed: 1, elapsed: 1, missed: 0, slope: null, cause: null })])).find((q) => q.kind === "UNIT_QUARTER")!;
    expect(p.outcome).toContain("Cannot be forecast yet");
    expect(p.concern).toBe(0);
    expect(p.confidence).toBe("low");
  });

  it("a unit on course needs no intervention", () => {
    const p = buildPredictions(report([unit({ forecast: "achieve", projected: 74, direction: "improving", stepUp: null, cause: null, analysis: { capacity: { ratio: 90, overcommitted: false, carryOver: [] } } })]))[0];
    expect(p.outcome).toContain("Likely to reach the target");
    expect(p.recommendation).toContain("No intervention needed");
    expect(p.concern).toBe(1);
  });

  it("warns about commitments only for an over-committed unit, using the unit's own planned and finished figures", () => {
    const ps = buildPredictions(report([unit(), unit({ id: "u2", name: "Bravo", analysis: { capacity: { plannedPerWeek: 4, donePerWeek: 4, ratio: 100, overcommitted: false, carryOver: [] } } })]));
    const commits = ps.filter((x) => x.kind === "UNIT_COMMITMENTS");
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe("Alpha");
    expect(commits[0].outcome).toContain("50%");
  });

  it("flags a Sub-KR nobody supports and one with under half its goals finished, as coverage forecasts that say so", () => {
    const cov = [
      { krCode: "KR1", code: "KR1.1", title: "Pipeline", goals: 0, units: 0, doneRate: null, sharePct: 0, status: "uncovered" },
      { krCode: "KR2", code: "KR2.1", title: "Retention", goals: 8, units: 2, doneRate: 37.5, sharePct: 20, status: "covered" },
      { krCode: "KR3", code: "KR3.1", title: "Delivery", goals: 10, units: 3, doneRate: 80, sharePct: 30, status: "covered" },
    ] as never;
    const ps = buildPredictions(report([]), cov).filter((x) => x.kind === "SUB_KR");
    expect(ps.map((p) => p.subject)).toEqual(["KR1.1 Pipeline", "KR2.1 Retention"]);
    expect(ps[0].outcome).toContain("no weekly goal supports it");
    expect(ps[1].outcome).toContain("37.5%");
    expect(ps.every((p) => p.assumptions.join(" ").includes("no numeric target"))).toBe(true);
  });

  it("orders the most worrying first", () => {
    const ps = buildPredictions(report([unit({ id: "a", name: "Aaa", forecast: "achieve", projected: 75, analysis: { capacity: { ratio: 90, overcommitted: false, carryOver: [] } } }), unit({ id: "b", name: "Bbb" })]));
    expect(ps[0].subject).toBe("Bbb");
  });
});

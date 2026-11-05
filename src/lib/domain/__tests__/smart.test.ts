import { describe, expect, it } from "vitest";
import { evaluateSmart } from "../smart";

// The SMART checker reads the goal only. Tasks are not an input of it.
const ev = (title: string, sub: string | null = null, description: string | null = null) =>
  evaluateSmart({ title, description, subKrTitle: sub, goalType: sub ? "KR_ALIGNED" : "STRETCH" });

describe("SMART evaluator", () => {
  const good = ev("Publish 3 pricing sheets to all sales leads by Friday 17:00", "Publish pricing sheets to sales leads");
  const weak = ev("improve things");

  it("scores within 0..100 for all dimensions", () => {
    for (const e of [good, weak]) {
      for (const k of ["specific", "measurable", "achievable", "relevant", "timeBound", "overall"] as const) {
        expect(e[k]).toBeGreaterThanOrEqual(0);
        expect(e[k]).toBeLessThanOrEqual(100);
      }
    }
  });
  it("is deterministic", () => expect(ev("x")).toEqual(ev("x")));
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
  it("carries the engine version", () => expect(good.engineVersion).toBe("smart-rules-2.2.0"));
  it("takes no tasks: the input has no place for them", () => {
    // @ts-expect-error tasks are not part of the SMART input
    const withTasks = evaluateSmart({ title: "Complete the audit by Friday", goalType: "STRETCH", taskDescriptions: ["Do step one", "rrr rr"] });
    expect(withTasks).toEqual(ev("Complete the audit by Friday"));
  });
});

describe("SMART evaluator, engine 2", () => {
  it("recognises other forms of an action verb (published, closing, schedules)", () => {
    expect(ev("Published the pricing sheet").specific).toBeGreaterThan(ev("The pricing sheet situation").specific);
    expect(ev("Closing 5 invoices by Friday").specific).toBeGreaterThan(60);
  });
  it("treats a weekday, date or clock time as a real deadline, and a general phrase as a weak one", () => {
    const exact = ev("Complete the audit by Friday 17:00").timeBound;
    const general = ev("Complete the audit this week").timeBound;
    const none = ev("Complete the audit").timeBound;
    expect(exact).toBeGreaterThan(general);
    expect(general).toBeGreaterThan(none);
    expect(ev("Complete the audit by 14 Nov").timeBound).toBeGreaterThanOrEqual(80);
  });
  it("measures with counts, percentages, money and verifiable outcomes", () => {
    expect(ev("Reduce churn to 3%").measurable).toBeGreaterThan(ev("Reduce churn").measurable);
    expect(ev("Collect ₦2m in overdue invoices").measurable).toBeGreaterThanOrEqual(60);
    expect(ev("Close 5 invoices").measurable).toBeGreaterThan(60);
  });
  it("judges the size of the goal from its own wording: bounded and stated is better than all-or-nothing or year-long", () => {
    expect(ev("Fully complete every audit always").achievable).toBeLessThan(ev("Complete the audit").achievable);
    expect(ev("Deliver the annual strategy").achievable).toBeLessThan(ev("Deliver the strategy draft").achievable);
    expect(ev("Close 5 invoices for Finance by Friday").achievable).toBeGreaterThanOrEqual(70);
    expect(ev("Audit").achievable).toBeLessThan(70);
  });
  it("credits a mapped Sub-KR, and more when the wording shares its key words", () => {
    const sub = "Publish pricing sheets to sales leads";
    const aligned = ev("Publish 3 pricing sheets to all sales leads", sub);
    const loose = ev("Tidy the office cabinets", sub);
    expect(aligned.relevant).toBeGreaterThan(loose.relevant);
    expect(loose.relevant).toBeGreaterThanOrEqual(70);
    expect(loose.suggestions.join(" ")).toContain("shares nothing");
    expect(ev("Anything").relevant).toBeLessThan(70);
  });
  it("names the problem in the goal's own words", () => {
    const e = ev("improve things");
    expect(e.warnings.join(" ")).toMatch(/action|specific/);
    expect(e.suggestions.join(" ")).toContain("things");
  });
  it("scores a complete goal in the high band", () => {
    const e = ev("Publish 3 pricing sheets to all sales leads by Friday 17:00", "Publish pricing sheets to sales leads");
    expect(e.overall).toBeGreaterThanOrEqual(80);
    expect(e.warnings).toEqual([]);
  });
});

describe("SMART evaluator, nonsense text", () => {
  it("scores keyboard mash and fragments very low", () => {
    const e = ev("ug iui go oioq i o");
    expect(e.overall).toBeLessThan(15);
    expect(e.warnings.join(" ")).toMatch(/plain wording/);
  });
  it("leaves real goals with acronyms, quarters and figures alone", () => {
    const e = ev("Submit the Q4 OKR report to NBMS and VREG leads by Friday 17:00");
    expect(e.warnings.join(" ")).not.toMatch(/plain wording/);
    expect(e.overall).toBeGreaterThan(50);
  });
});

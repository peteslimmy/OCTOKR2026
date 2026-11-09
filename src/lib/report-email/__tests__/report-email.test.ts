import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { dueAt, duePeriods, latestCompletedPeriod, nextDueAt, periodContaining, periodFromKey, previousPeriod, type ScheduleTiming } from "../periods";
import { ALL_SECTIONS, renderEmail, subjectFor } from "../render";
import { buildSummary, type QuarterRow, type WeeklyRow } from "../summary";

const lagos = (iso: string) => DateTime.fromISO(iso, { zone: "Africa/Lagos" });
const timing = (over: Partial<ScheduleTiming> = {}): ScheduleTiming => ({ frequency: "WEEKLY", send_weekday: 1, send_day: 1, send_time: "08:00", ...over });

describe("periods", () => {
  it("weekly: Monday to Sunday, with the ISO week key and the standard week label", () => {
    const p = periodContaining("WEEKLY", lagos("2026-10-29T10:00"));          // a Thursday
    expect(p).toMatchObject({ key: "2026-W44", start: "2026-10-26", end: "2026-11-01" });
    expect(p.label).toBe("Week 44, 26 Oct – 1 Nov 2026");
  });
  it("monthly, quarterly and annual cover whole calendar periods", () => {
    expect(periodContaining("MONTHLY", lagos("2026-02-10T00:00"))).toMatchObject({ key: "2026-02", start: "2026-02-01", end: "2026-02-28" });
    expect(periodContaining("QUARTERLY", lagos("2026-08-15T00:00"))).toMatchObject({ key: "2026-Q3", start: "2026-07-01", end: "2026-09-30", quarter: 3 });
    expect(periodContaining("ANNUAL", lagos("2026-08-15T00:00"))).toMatchObject({ key: "2026", start: "2026-01-01", end: "2026-12-31" });
  });
  it("the latest completed period is never the one still running", () => {
    const now = lagos("2026-11-09T09:00");
    expect(latestCompletedPeriod("WEEKLY", now).key).toBe("2026-W45");
    expect(latestCompletedPeriod("MONTHLY", now).key).toBe("2026-10");
    expect(latestCompletedPeriod("QUARTERLY", now).key).toBe("2026-Q3");
    expect(latestCompletedPeriod("ANNUAL", now).key).toBe("2025");
    expect(latestCompletedPeriod("QUARTERLY", lagos("2027-01-02T00:00")).key).toBe("2026-Q4");        // across a year end
    expect(previousPeriod(periodContaining("WEEKLY", lagos("2027-01-04T00:00"))).key).toBe("2026-W53");
  });
  it("a key is read back only for the frequency it belongs to", () => {
    expect(periodFromKey("WEEKLY", "2026-W44")?.start).toBe("2026-10-26");
    expect(periodFromKey("MONTHLY", "2026-10")?.end).toBe("2026-10-31");
    expect(periodFromKey("QUARTERLY", "2026-Q3")?.key).toBe("2026-Q3");
    expect(periodFromKey("ANNUAL", "2026")?.key).toBe("2026");
    expect(periodFromKey("WEEKLY", "2026-10")).toBeNull();
    expect(periodFromKey("MONTHLY", "2026-13")).toBeNull();
    expect(periodFromKey("WEEKLY", "2026-W60")).toBeNull();
  });
  it("is due on the chosen weekday after the week ended, and on the chosen day after a longer period ended", () => {
    const wk = periodContaining("WEEKLY", lagos("2026-11-02T00:00"));                                  // 2 – 8 Nov
    expect(dueAt(timing({ send_weekday: 1 }), wk).toISO()).toBe(lagos("2026-11-09T08:00").toISO());
    expect(dueAt(timing({ send_weekday: 3 }), wk).toISO()).toBe(lagos("2026-11-11T08:00").toISO());
    expect(dueAt(timing({ frequency: "MONTHLY", send_day: 5 }), periodContaining("MONTHLY", lagos("2026-10-10T00:00"))).toISO()).toBe(lagos("2026-11-05T08:00").toISO());
    expect(dueAt(timing({ frequency: "QUARTERLY", send_day: 3 }), periodContaining("QUARTERLY", lagos("2026-08-01T00:00"))).toISO()).toBe(lagos("2026-10-03T08:00").toISO());
    expect(dueAt(timing({ frequency: "ANNUAL", send_day: 10 }), periodContaining("ANNUAL", lagos("2025-06-01T00:00"))).toISO()).toBe(lagos("2026-01-10T08:00").toISO());
  });
  it("nothing is due before the time, the finished period is due after it, and a new schedule does not report on periods before it existed", () => {
    const created = lagos("2026-01-01T00:00");
    expect(duePeriods(timing(), lagos("2026-11-09T07:59"), created).map((p) => p.key)).toEqual(["2026-W44"]);   // Monday 08:00 has not come: only the week before is still due
    expect(duePeriods(timing(), lagos("2026-11-09T08:00"), created).map((p) => p.key)).toEqual(["2026-W44", "2026-W45"]);
    expect(duePeriods(timing(), lagos("2026-11-09T09:00"), lagos("2026-11-05T00:00")).map((p) => p.key)).toEqual(["2026-W45"]);
    expect(duePeriods(timing(), lagos("2026-11-09T09:00"), lagos("2026-11-09T08:30"))).toEqual([]);
  });
  it("next send is the finished period if its time is still ahead, otherwise the one running", () => {
    expect(nextDueAt(timing({ send_weekday: 3 }), lagos("2026-11-09T09:00")).toISO()).toBe(lagos("2026-11-11T08:00").toISO());
    expect(nextDueAt(timing({ send_weekday: 1 }), lagos("2026-11-09T09:00")).toISO()).toBe(lagos("2026-11-16T08:00").toISO());
  });
});

const week = (n: number, start: string, unit: string, score: number | null, over: Partial<WeeklyRow> = {}): WeeklyRow => ({
  business_unit_id: unit, business_unit: unit.toUpperCase(), week_number: n, week_year: 2026, week_start_at: `${start}T00:00:00+01:00`, week_status: "FINAL_LOCKED",
  reporting_state: "NORMAL", result_state: "SCORED", final_score: score, compliance_status: "COMPLIANT", submitted_before_content_lock: score !== null, ...over,
});

describe("summary", () => {
  const period = periodContaining("WEEKLY", lagos("2026-11-03T00:00"));          // week 45: 2 – 8 Nov
  const weekly = [
    week(44, "2026-10-26", "eng", 70), week(44, "2026-10-26", "ops", 80), week(44, "2026-10-26", "hr", 60),
    week(45, "2026-11-02", "eng", 85), week(45, "2026-11-02", "ops", 66), week(45, "2026-11-02", "hr", null, { result_state: "NOT_SUBMITTED", submitted_before_content_lock: false }),
  ];
  const s = buildSummary({ period, weekly, previousWeekly: weekly.filter((r) => r.week_number === 44), quarters: [], previousQuarters: [] });

  it("ranks units by score, with movement against the previous week", () => {
    expect(s.ranking.map((u) => [u.name, u.score, u.rank, u.movement, u.delta])).toEqual([["ENG", 85, 1, "UP", 15], ["OPS", 66, 2, "DOWN", -14], ["HR", null, null, "NONE", null]]);
  });
  it("headline figures: average, change, on-time share and misses", () => {
    expect(s.headlines).toMatchObject({ score: 75.5, previousScore: 70, delta: 5.5, units: 3, scoredUnits: 2, expected: 3, onTime: 2, missed: 1 });
    expect(s.headlines.onTimePct).toBeCloseTo(66.7, 1);
  });
  it("flags what needs attention: a missed report and a sharp fall", () => {
    expect(s.attention.map((a) => `${a.name}: ${a.issue}`)).toEqual(expect.arrayContaining(["HR: 1 week without an on-time report", expect.stringMatching(/^OPS: score down 14 points/), "HR: no score for this period"]));
  });
  it("highlights the top scores and the biggest improvement", () => {
    expect(s.highlights.top[0]).toEqual({ name: "ENG", score: 85 });
    expect(s.highlights.improved).toEqual([{ name: "ENG", delta: 15 }]);
  });
  it("a period with nothing in it is marked empty rather than shown as zeros", () => {
    const e = buildSummary({ period, weekly: [], previousWeekly: [], quarters: [], previousQuarters: [] });
    expect(e.empty).toBe(true);
    expect(e.headlines.score).toBeNull();
  });
  it("holiday weeks are not counted as missed reports", () => {
    const h = buildSummary({ period, weekly: [week(45, "2026-11-02", "eng", null, { reporting_state: "ORGANIZATION_HOLIDAY", result_state: "HOLIDAY", submitted_before_content_lock: null })], previousWeekly: [], quarters: [], previousQuarters: [] });
    expect(h.headlines).toMatchObject({ expected: 0, missed: 0, holidays: 1 });
  });
  it("quarterly uses the official quarter scores and compares with the previous quarter", () => {
    const q = periodContaining("QUARTERLY", lagos("2026-08-01T00:00"));
    const rows = (a: number, b: number): QuarterRow[] => [{ business_unit_id: "eng", business_unit: "ENG", score: a, denominator_count: 12, previous_score: null }, { business_unit_id: "ops", business_unit: "OPS", score: b, denominator_count: 12, previous_score: null }];
    const r = buildSummary({ period: q, weekly: [], previousWeekly: [], quarters: [rows(90, 72)], previousQuarters: [rows(80, 78)] });
    expect(r.ranking.map((u) => [u.name, u.score, u.delta])).toEqual([["ENG", 90, 10], ["OPS", 72, -6]]);
    expect(r.headlines).toMatchObject({ score: 81, previousScore: 79, delta: 2 });
    expect(r.empty).toBe(false);
  });
  it("annual averages the four quarters", () => {
    const y = periodContaining("ANNUAL", lagos("2026-06-01T00:00"));
    const rows = (v: number): QuarterRow[] => [{ business_unit_id: "eng", business_unit: "ENG", score: v, denominator_count: 12, previous_score: null }];
    const r = buildSummary({ period: y, weekly: [], previousWeekly: [], quarters: [rows(60), rows(70), rows(80), rows(90)], previousQuarters: [rows(50), rows(50), rows(50), rows(50)] });
    expect(r.ranking[0]).toMatchObject({ score: 75, previous: 50, delta: 25, movement: "UP" });
  });
});

describe("email", () => {
  const period = periodContaining("WEEKLY", lagos("2026-11-03T00:00"));
  const weekly = [week(45, "2026-11-02", "eng", 85), week(45, "2026-11-02", "ops", 66)];
  const s = buildSummary({ period, weekly, previousWeekly: [], quarters: [], previousQuarters: [] });
  const opts = { sections: ALL_SECTIONS, scheduleName: "Leadership weekly", appUrl: "https://okr.example.test/" };

  it("the subject names the kind of summary and the period", () => {
    expect(subjectFor(s)).toBe("4CORE OKR — Weekly summary · Week 45, 2–8 Nov 2026");
  });
  it("carries every section in HTML and in plain text, and links to the report", () => {
    const m = renderEmail(s, opts);
    for (const t of ["Headline numbers", "Business Unit ranking", "Trend", "Highlights", "Attention needed"]) { expect(m.html).toContain(t); expect(m.text.toUpperCase()).toContain(t.toUpperCase().replace(" (AVERAGE SCORE)", "")); }
    expect(m.html).toContain("https://okr.example.test/reports");
    expect(m.text).toContain("ENG — 85");
  });
  it("leaves out sections that were not chosen", () => {
    const m = renderEmail(s, { ...opts, sections: ["HEADLINES"] });
    expect(m.html).toContain("Headline numbers");
    expect(m.html).not.toContain("Business Unit ranking");
    expect(m.text).not.toContain("BUSINESS UNIT RANKING");
  });
  it("escapes everything that came from data, in the body and the footer", () => {
    const evil = buildSummary({ period, weekly: [week(45, "2026-11-02", "x", 50, { business_unit: "<script>alert(1)</script>" })], previousWeekly: [], quarters: [], previousQuarters: [] });
    const m = renderEmail(evil, { ...opts, scheduleName: "<img src=x onerror=1>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;script&gt;");
  });
  it("says so plainly when the period is empty", () => {
    const m = renderEmail(buildSummary({ period, weekly: [], previousWeekly: [], quarters: [], previousQuarters: [] }), opts);
    expect(m.html).toContain("nothing to summarise");
    expect(m.text).toContain("nothing to summarise");
    expect(m.html).not.toContain("Business Unit ranking");
  });
  it("a test email is labelled as one", () => {
    expect(renderEmail(s, { ...opts, testNotice: true }).html).toContain("Test email");
  });
  it("is table-based with inline styles, for mail clients: no scripts, no external images, no style sheets", () => {
    const { html } = renderEmail(s, opts);
    expect(html).toMatch(/<table role="presentation"/);
    expect(html).not.toMatch(/<script|<link|<img|@import|<style/i);
  });
});

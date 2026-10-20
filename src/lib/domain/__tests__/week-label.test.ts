import { describe, expect, it } from "vitest";
import { formatWeekLabel, formatWeekRange, isoWeekOf } from "../week-label";

// Lagos is UTC+1 all year, so Monday 00:00 in Lagos is Sunday 23:00 UTC: the exact trap a naive UTC formatter falls into.
const lagos = (isoDate: string) => `${new Date(`${isoDate}T00:00:00+01:00`).toISOString()}`;

describe("reporting-week label", () => {
  it("renders the agreed example exactly", () => {
    expect(formatWeekLabel({ week_number: 14, week_start_at: lagos("2026-03-30") })).toBe("Week 14, 30 Mar – 5 Apr 2026");
  });
  it("uses the compact form inside one month", () => {
    expect(formatWeekLabel({ week_number: 15, week_start_at: lagos("2026-04-06") })).toBe("Week 15, 6–12 Apr 2026");
  });
  it("spans two months", () => {
    expect(formatWeekLabel({ week_number: 18, week_start_at: lagos("2026-04-27") })).toBe("Week 18, 27 Apr – 3 May 2026");
  });
  it("shows both years when the week spans a year boundary", () => {
    expect(formatWeekLabel({ week_number: 1, week_start_at: lagos("2025-12-29") })).toBe("Week 1, 29 Dec 2025 – 4 Jan 2026");
    expect(formatWeekLabel({ week_number: 53, week_start_at: lagos("2020-12-28") })).toBe("Week 53, 28 Dec 2020 – 3 Jan 2021");
  });
  it("handles a leap day inside the week", () => {
    expect(formatWeekLabel({ week_number: 9, week_start_at: lagos("2028-02-28") })).toBe("Week 9, 28 Feb – 5 Mar 2028");
    expect(formatWeekRange(lagos("2028-02-21"))).toBe("21–27 Feb 2028");
  });
  it("is not shifted a day by the midnight time-zone trap", () => {
    // 2026-03-29T23:00:00Z is Monday 30 March 00:00 in Lagos
    expect(lagos("2026-03-30")).toBe("2026-03-29T23:00:00.000Z");
    expect(formatWeekRange("2026-03-29T23:00:00.000Z")).toBe("30 Mar – 5 Apr 2026");
    expect(formatWeekRange(new Date("2026-03-29T23:00:00.000Z"))).toBe("30 Mar – 5 Apr 2026");
  });
  it("abbreviates months consistently and never doubles the year inside one year", () => {
    const label = formatWeekLabel({ week_number: 36, week_start_at: lagos("2026-08-31") });
    expect(label).toBe("Week 36, 31 Aug – 6 Sep 2026");
    expect(label.match(/2026/g)).toHaveLength(1);
  });
  it("agrees with ISO week numbering at the year boundaries the calendar uses", () => {
    expect(isoWeekOf(lagos("2026-03-30"))).toEqual({ week: 14, year: 2026 });
    expect(isoWeekOf(lagos("2025-12-29"))).toEqual({ week: 1, year: 2026 });     // Monday 29 Dec 2025 belongs to ISO week 1 of 2026
    expect(isoWeekOf(lagos("2020-12-28"))).toEqual({ week: 53, year: 2020 });
    expect(isoWeekOf(lagos("2031-01-06"))).toEqual({ week: 2, year: 2031 });
  });
  it("returns empty text rather than 'Invalid DateTime' for bad input", () => {
    expect(formatWeekRange("not a date")).toBe("");
  });
});

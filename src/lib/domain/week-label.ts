import { DateTime } from "luxon";
import { BUSINESS_ZONE } from "./time";

/**
 * The one place a reporting week is turned into text (ADR-055). Every screen, report, export and notification uses it, so the same
 * week always reads the same way:
 *
 *   Week 14, 30 Mar – 5 Apr 2026          one year, two months
 *   Week 15, 6–12 Apr 2026                one month
 *   Week 1, 29 Dec 2025 – 4 Jan 2026      spans two calendar years (the year is shown on both dates)
 *
 * The week number is the stored ISO week number of the reporting week and the dates come from its stored start (Monday 00:00 in the
 * organisation's time zone, Africa/Lagos). The end date is the following Sunday, derived from the same start, so a week can never
 * disagree with the calendar it belongs to. Display only: no lock, deadline, score or compliance rule reads this text.
 */
export interface WeekLike {
  week_number: number;
  /** Stored start instant of the week (ISO string or Date): Monday 00:00 in the organisation's time zone. */
  week_start_at: string | Date;
}

const toZone = (v: string | Date) => (v instanceof Date ? DateTime.fromJSDate(v) : DateTime.fromISO(v)).setZone(BUSINESS_ZONE);

/** "30 Mar – 5 Apr 2026", "6–12 Apr 2026" or "29 Dec 2025 – 4 Jan 2026". The end is the Sunday of the same week. */
export function formatWeekRange(weekStartAt: string | Date): string {
  const start = toZone(weekStartAt).startOf("day");
  const end = start.plus({ days: 6 });
  if (!start.isValid) return "";
  if (start.year !== end.year) return `${start.toFormat("d LLL yyyy")} – ${end.toFormat("d LLL yyyy")}`;
  if (start.month !== end.month) return `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;
  return `${start.day}–${end.toFormat("d LLL yyyy")}`;
}

/** The standard label: "Week 14, 30 Mar – 5 Apr 2026". */
export function formatWeekLabel(week: WeekLike): string {
  return `Week ${week.week_number}, ${formatWeekRange(week.week_start_at)}`;
}

/** Compact form for tight axes and tick labels where the full range cannot fit: "W14". Never used as the only label of a week. */
export const formatWeekShort = (week: Pick<WeekLike, "week_number">) => `W${week.week_number}`;

/** ISO 8601 week number and week-year of an instant, in the organisation's time zone. Used only to verify stored week numbers. */
export function isoWeekOf(d: string | Date): { week: number; year: number } {
  const z = toZone(d);
  return { week: z.weekNumber, year: z.weekYear };
}

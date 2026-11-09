import { DateTime } from "luxon";
import { formatWeekLabel } from "@/lib/domain/week-label";
import { BUSINESS_ZONE } from "@/lib/domain/time";

/**
 * Which period a summary covers and when it is due (ADR-115). Pure: no clock, no database. All dates are calendar dates in the
 * organisation's time zone (Africa/Lagos). A period is always one that has ENDED; a summary never describes a period still in progress.
 */
export type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL";
export const FREQUENCIES: Frequency[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];

export interface Period {
  frequency: Frequency;
  /** Stable identity used to stop a period being emailed twice: 2026-W44, 2026-10, 2026-Q3, 2026. */
  key: string;
  /** First and last day, yyyy-mm-dd, both inclusive. */
  start: string;
  end: string;
  /** "Week 44, 26 Oct – 1 Nov 2026", "October 2026", "Q3 2026 (Jul–Sep)", "2026". */
  label: string;
  year: number;
  quarter?: number;
}

export interface ScheduleTiming { frequency: Frequency; send_weekday: number; send_day: number; send_time: string }

const iso = (d: DateTime) => d.toFormat("yyyy-LL-dd");
const inZone = (d: DateTime) => d.setZone(BUSINESS_ZONE);

/** The period of this frequency that contains the given day. */
export function periodContaining(frequency: Frequency, at: DateTime): Period {
  const d = inZone(at).startOf("day");
  if (frequency === "WEEKLY") {
    const start = d.startOf("week");                       // luxon weeks start on Monday, like the reporting weeks
    const end = start.plus({ days: 6 });
    return { frequency, key: `${start.weekYear}-W${String(start.weekNumber).padStart(2, "0")}`, start: iso(start), end: iso(end), year: start.weekYear,
      label: formatWeekLabel({ week_number: start.weekNumber, week_start_at: start.toISO()! }) };
  }
  if (frequency === "MONTHLY") {
    const start = d.startOf("month");
    return { frequency, key: start.toFormat("yyyy-LL"), start: iso(start), end: iso(start.endOf("month")), year: start.year, label: start.toFormat("LLLL yyyy") };
  }
  if (frequency === "QUARTERLY") {
    const q = Math.ceil(d.month / 3);
    const start = d.set({ month: (q - 1) * 3 + 1 }).startOf("month");
    const end = start.plus({ months: 2 }).endOf("month");
    return { frequency, key: `${d.year}-Q${q}`, start: iso(start), end: iso(end), year: d.year, quarter: q, label: `Q${q} ${d.year} (${start.toFormat("LLL")}–${end.toFormat("LLL")})` };
  }
  const start = d.startOf("year");
  return { frequency, key: String(d.year), start: iso(start), end: iso(start.endOf("year")), year: d.year, label: String(d.year) };
}

/** The period right before this one. */
export function previousPeriod(p: Period): Period {
  return periodContaining(p.frequency, DateTime.fromISO(p.start, { zone: BUSINESS_ZONE }).minus({ days: 1 }));
}

/** The most recent period that has fully ended as of `now`. */
export function latestCompletedPeriod(frequency: Frequency, now: DateTime): Period {
  return previousPeriod(periodContaining(frequency, now));
}

/**
 * The moment a period's summary goes out: weekly on the chosen weekday after the week ended; monthly, quarterly and annual on the chosen
 * day of the month after the period ended; always at the chosen time of day.
 */
export function dueAt(s: ScheduleTiming, p: Period): DateTime {
  const [hh, mm] = s.send_time.split(":").map(Number);
  const after = DateTime.fromISO(p.end, { zone: BUSINESS_ZONE }).plus({ days: 1 });         // the first day after the period
  if (s.frequency === "WEEKLY") {
    const ahead = (s.send_weekday - after.weekday + 7) % 7;
    return after.plus({ days: ahead }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  }
  return after.set({ day: s.send_day }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
}

/**
 * Periods whose summary is due now and not older than the schedule itself. Normally one; two when a run was missed (an outage over the
 * send time). A schedule never reports on periods that ended before it was created. The caller skips any that were already sent.
 */
export function duePeriods(s: ScheduleTiming, now: DateTime, createdAt: DateTime): Period[] {
  const out: Period[] = [];
  let p = latestCompletedPeriod(s.frequency, now);
  for (let i = 0; i < 2; i++) {
    const due = dueAt(s, p);
    if (due <= now && due >= createdAt) out.push(p);
    p = previousPeriod(p);
  }
  return out.reverse();                                                                     // oldest first, so a missed one goes out before the current one
}

/** The next moment this schedule will send: the latest finished period if its time has not come yet, otherwise the period still running. */
export function nextDueAt(s: ScheduleTiming, now: DateTime): DateTime {
  let p = latestCompletedPeriod(s.frequency, now);
  for (let i = 0; i < 3; i++) {
    const due = dueAt(s, p);
    if (due > now) return due;
    p = periodContaining(s.frequency, DateTime.fromISO(p.end, { zone: BUSINESS_ZONE }).plus({ days: 1 }));
  }
  return dueAt(s, p);
}

/** Whole weeks, months or quarters that make up the window used to draw the trend. */
export function trendWindow(p: Period): { from: string; to: string } {
  const end = DateTime.fromISO(p.end, { zone: BUSINESS_ZONE });
  const start = DateTime.fromISO(p.start, { zone: BUSINESS_ZONE });
  if (p.frequency === "WEEKLY") return { from: iso(start.minus({ weeks: 5 })), to: p.end };
  if (p.frequency === "MONTHLY") return { from: iso(start.minus({ months: 5 }).startOf("month")), to: p.end };
  if (p.frequency === "QUARTERLY") return { from: iso(start.minus({ months: 9 })), to: p.end };
  return { from: p.start, to: iso(end) };
}

/** The period a key such as 2026-W44, 2026-10, 2026-Q3 or 2026 names, for the given frequency; null when the key does not fit it. */
export function periodFromKey(frequency: Frequency, key: string): Period | null {
  let day: DateTime | null = null;
  let m: RegExpMatchArray | null;
  if (frequency === "WEEKLY" && (m = key.match(/^(\d{4})-W(\d{2})$/))) day = DateTime.fromObject({ weekYear: +m[1], weekNumber: +m[2] }, { zone: BUSINESS_ZONE });
  else if (frequency === "MONTHLY" && (m = key.match(/^(\d{4})-(\d{2})$/))) day = DateTime.fromObject({ year: +m[1], month: +m[2], day: 1 }, { zone: BUSINESS_ZONE });
  else if (frequency === "QUARTERLY" && (m = key.match(/^(\d{4})-Q([1-4])$/))) day = DateTime.fromObject({ year: +m[1], month: (+m[2] - 1) * 3 + 1, day: 1 }, { zone: BUSINESS_ZONE });
  else if (frequency === "ANNUAL" && (m = key.match(/^(\d{4})$/))) day = DateTime.fromObject({ year: +m[1], month: 1, day: 1 }, { zone: BUSINESS_ZONE });
  if (!day || !day.isValid) return null;
  const p = periodContaining(frequency, day);
  return p.key === key ? p : null;
}

import { DateTime } from "luxon";

export const BUSINESS_ZONE = "Africa/Lagos";
export type ReportPhase = "NOT_OPEN" | "OPEN" | "CONTENT_LOCKED" | "FINAL_LOCKED";

export interface WeekSchedule {
  weekStart: DateTime;
  weekEnd: DateTime;
  contentLockAt: DateTime;
  finalLockAt: DateTime;
}

/** Monday 00:00 WAT of the week containing `d`. */
export function mondayOf(d: DateTime): DateTime {
  const local = d.setZone(BUSINESS_ZONE).startOf("day");
  return local.minus({ days: local.weekday - 1 });
}

/** Content lock Tue 18:00 of the opening week; final lock the following Tue 11:00 (ADR-003/004). */
export function weekSchedule(monday: DateTime): WeekSchedule {
  const m = monday.setZone(BUSINESS_ZONE).startOf("day");
  return {
    weekStart: m,
    weekEnd: m.plus({ days: 7 }),
    contentLockAt: m.plus({ days: 1, hours: 18 }),
    finalLockAt: m.plus({ days: 8, hours: 11 }),
  };
}

/** Boundary rule mirrors SQL report_phase(): the lock instant itself is already locked. */
export function phaseAt(s: WeekSchedule, now: DateTime): ReportPhase {
  if (now >= s.finalLockAt) return "FINAL_LOCKED";
  if (now >= s.contentLockAt) return "CONTENT_LOCKED";
  if (now >= s.weekStart) return "OPEN";
  return "NOT_OPEN";
}

export function formatWat(d: DateTime | string | Date): string {
  const dt = typeof d === "string" ? DateTime.fromISO(d) : d instanceof Date ? DateTime.fromJSDate(d) : d;
  return dt.setZone(BUSINESS_ZONE).toFormat("ccc d LLL yyyy, HH:mm") + " WAT";
}

export function countdown(target: DateTime | string, now: DateTime = DateTime.now()): string {
  const t = typeof target === "string" ? DateTime.fromISO(target) : target;
  if (t <= now) return "passed";
  const diff = t.diff(now, ["days", "hours", "minutes"]).toObject();
  const parts: string[] = [];
  if (diff.days && diff.days >= 1) parts.push(`${Math.floor(diff.days)}d`);
  if (parts.length || (diff.hours ?? 0) >= 1) parts.push(`${Math.floor(diff.hours ?? 0)}h`);
  parts.push(`${Math.floor(diff.minutes ?? 0)}m`);
  return parts.join(" ");
}

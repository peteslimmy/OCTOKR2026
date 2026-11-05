/** The lock schedule as stored (reporting_schedule_versions) and the words used to describe it on screen. */
export interface LockSchedule {
  version: number;
  content_lock_dow: number; content_lock_time: string; content_lock_week_offset: number;
  final_lock_dow: number; final_lock_time: string; final_lock_week_offset: number;
  /** When reporting opens (absent on rows written before the opening became part of the policy: Monday 00:00). */
  open_dow?: number; open_time?: string; open_week_offset?: number;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const hhmm = (t: string) => t.slice(0, 5);

/** "Tuesday 18:00" for a lock in the opening week, "the following Tuesday 11:00" a week later, "two weeks later, Tuesday 11:00" and so on. */
export function lockPhrase(dow: number, time: string, weekOffset: number): string {
  const day = WEEKDAYS[dow - 1] ?? "?";
  if (weekOffset <= 0) return `${day} ${hhmm(time)}`;
  if (weekOffset === 1) return `the following ${day} ${hhmm(time)}`;
  return `${day} ${hhmm(time)}, ${weekOffset} weeks after the week starts`;
}

export const contentLockPhrase = (s: LockSchedule) => lockPhrase(s.content_lock_dow, s.content_lock_time, s.content_lock_week_offset);
export const finalLockPhrase = (s: LockSchedule) => lockPhrase(s.final_lock_dow, s.final_lock_time, s.final_lock_week_offset);

/** "Monday 00:00", or "Sunday 18:00 in the week before" when reporting opens ahead of the week. */
export function openPhrase(s: LockSchedule): string {
  const day = WEEKDAYS[(s.open_dow ?? 1) - 1] ?? "?";
  const time = hhmm(s.open_time ?? "00:00");
  const off = s.open_week_offset ?? 0;
  return off < 0 ? `${day} ${time} in the week before` : off === 0 ? `${day} ${time}` : lockPhrase(s.open_dow ?? 1, time, off);
}

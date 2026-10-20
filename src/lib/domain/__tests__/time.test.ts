import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { mondayOf, phaseAt, weekSchedule } from "../time";

// Week opening Monday 2026-10-12 (WAT is UTC+1, no DST).
const monday = DateTime.fromISO("2026-10-12T00:00:00", { zone: "Africa/Lagos" });
const s = weekSchedule(monday);
const at = (iso: string) => DateTime.fromISO(iso, { zone: "Africa/Lagos" });

describe("WAT lock schedule (exact boundaries)", () => {
  it("content lock is Tuesday 18:00 WAT; final lock the following Tuesday 11:00 WAT", () => {
    expect(s.contentLockAt.toISO()).toBe("2026-10-13T18:00:00.000+01:00");
    expect(s.finalLockAt.toISO()).toBe("2026-10-20T11:00:00.000+01:00");
  });
  it.each([
    ["2026-10-11T23:59:59", "NOT_OPEN"],
    ["2026-10-12T00:00:00", "OPEN"],
    ["2026-10-13T17:59:59", "OPEN"],
    ["2026-10-13T18:00:00", "CONTENT_LOCKED"],
    ["2026-10-13T18:00:01", "CONTENT_LOCKED"],
    ["2026-10-20T10:59:59", "CONTENT_LOCKED"],
    ["2026-10-20T11:00:00", "FINAL_LOCKED"],
    ["2026-10-20T11:00:01", "FINAL_LOCKED"],
  ])("%s -> %s", (iso, phase) => expect(phaseAt(s, at(iso))).toBe(phase));
  it("derives the Monday from any weekday in WAT", () => {
    expect(mondayOf(at("2026-10-18T23:30:00")).toISODate()).toBe("2026-10-12");
    // 23:30 UTC Sunday is 00:30 WAT Monday
    expect(mondayOf(DateTime.fromISO("2026-10-18T23:30:00Z")).toISODate()).toBe("2026-10-19");
  });
});

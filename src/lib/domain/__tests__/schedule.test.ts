import { describe, expect, it } from "vitest";
import { contentLockPhrase, finalLockPhrase, lockPhrase, type LockSchedule } from "../schedule";

const v1: LockSchedule = { version: 1, content_lock_dow: 2, content_lock_time: "18:00:00", content_lock_week_offset: 0, final_lock_dow: 2, final_lock_time: "11:00:00", final_lock_week_offset: 1 };

describe("lock schedule wording", () => {
  it("describes the original schedule as it was always worded", () => {
    expect(contentLockPhrase(v1)).toBe("Tuesday 18:00");
    expect(finalLockPhrase(v1)).toBe("the following Tuesday 11:00");
  });
  it("follows a changed schedule", () => {
    expect(contentLockPhrase({ ...v1, content_lock_dow: 3, content_lock_time: "17:30:00" })).toBe("Wednesday 17:30");
    expect(finalLockPhrase({ ...v1, final_lock_dow: 5, final_lock_time: "09:00:00", final_lock_week_offset: 2 })).toBe("Friday 09:00, 2 weeks after the week starts");
    expect(lockPhrase(7, "23:59", 0)).toBe("Sunday 23:59");
  });
});

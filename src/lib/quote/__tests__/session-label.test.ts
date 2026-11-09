import { describe, expect, it } from "vitest";
import { sessionLabel } from "../session-label";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const week = (over: Partial<Parameters<typeof sessionLabel>[0]> = {}) => ({ reporting_state: "NORMAL", session_outcome: null, week_start_at: "2026-11-09T00:00:00Z", turn: null, ...over });

describe("weekly quote allocation: the session column", () => {
  it("a presented quote means the session was held, even when the session was never marked", () => {
    expect(sessionLabel(week({ week_start_at: "2026-11-02T00:00:00Z", turn: { status: "PRESENTED" } }), NOW)).toBe("Held");
    expect(sessionLabel(week({ turn: { status: "PRESENTED" } }), NOW)).toBe("Held");
  });
  it("a session marked held or skipped says so, and a holiday is a holiday", () => {
    expect(sessionLabel(week({ session_outcome: "HELD" }), NOW)).toBe("Held");
    expect(sessionLabel(week({ session_outcome: "SKIPPED" }), NOW)).toBe("Skipped");
    expect(sessionLabel(week({ reporting_state: "HOLIDAY", turn: { status: "PRESENTED" } }), NOW)).toBe("Holiday");
  });
  it("a week still to come is Coming; a week that has passed with nothing recorded is Not recorded", () => {
    expect(sessionLabel(week({ week_start_at: "2026-11-16T00:00:00Z" }), NOW)).toBe("Coming");
    expect(sessionLabel(week({ week_start_at: "2026-11-09T00:00:00Z" }), NOW)).toBe("Coming");           // this week
    expect(sessionLabel(week({ week_start_at: "2026-11-02T00:00:00Z" }), NOW)).toBe("Not recorded");     // last week
    expect(sessionLabel(week({ week_start_at: "2026-11-02T00:00:00Z", turn: { status: "ASSIGNED" } }), NOW)).toBe("Not recorded");
  });
});

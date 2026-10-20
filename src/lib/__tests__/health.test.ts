import { describe, expect, it } from "vitest";
import { healthAlerts, type HealthContext, type HealthFigures } from "../health";

const ok: HealthFigures = { scheduler_last_run_at: "2026-10-20T10:00:00Z", scheduler_age_seconds: 30, email_pending: 0, email_oldest_pending_minutes: null, email_failed: 0, job_failures_24h: 0, clock_override_present: false, schedule_version: 1 };
const prod: HealthContext = { production: true, rateLimitStore: "database", emailTransport: "smtp" };
const codes = (h: Partial<HealthFigures>, ctx = prod) => healthAlerts({ ...ok, ...h }, ctx).map((a) => a.code);

describe("health alerts", () => {
  it("raises nothing when everything is in order", () => expect(codes({})).toEqual([]));
  it("pages when the scheduler goes silent or never ran in production", () => {
    expect(codes({ scheduler_age_seconds: 301 })).toEqual(["SCHEDULER_SILENT"]);
    expect(codes({ scheduler_age_seconds: 300 })).toEqual([]);
    expect(healthAlerts({ ...ok, scheduler_age_seconds: null, scheduler_last_run_at: null }, prod)[0]).toMatchObject({ code: "SCHEDULER_NEVER_RAN", severity: "critical" });
    expect(healthAlerts({ ...ok, scheduler_age_seconds: null }, { ...prod, production: false })[0].severity).toBe("info");
  });
  it("reports failed jobs and stuck or failed mail", () => {
    expect(codes({ job_failures_24h: 2 })).toEqual(["JOB_FAILURES"]);
    expect(codes({ email_oldest_pending_minutes: 61 })).toEqual(["EMAIL_STUCK"]);
    expect(codes({ email_failed: 1 })).toEqual(["EMAIL_FAILED"]);
  });
  it("refuses a development clock in production but allows it elsewhere", () => {
    expect(codes({ clock_override_present: true })).toEqual(["CLOCK_OVERRIDE_IN_PRODUCTION"]);
    expect(codes({ clock_override_present: true }, { ...prod, production: false })).toEqual([]);
  });
  it("warns when attempt limits are not shared in production, and says when mail is off", () => {
    expect(codes({}, { ...prod, rateLimitStore: "memory" })).toEqual(["RATE_LIMIT_NOT_SHARED"]);
    expect(codes({}, { ...prod, emailTransport: "none" })).toEqual(["EMAIL_NOT_CONFIGURED"]);
  });
  it("watches webhooks, the integration the server cannot use, and internal addresses left open in production", () => {
    expect(codes({ webhook_failed: 2 })).toEqual(["WEBHOOK_FAILED"]);
    expect(codes({ webhook_oldest_pending_minutes: 61 })).toEqual(["WEBHOOK_STUCK"]);
    expect(codes({ webhook_oldest_pending_minutes: 59, webhook_failed: 0 })).toEqual([]);
    expect(codes({}, { ...prod, privateHostsAllowed: true })).toEqual(["PRIVATE_HOSTS_ALLOWED"]);
    expect(codes({}, { ...prod, privateHostsAllowed: true }).length).toBe(1);
    expect(healthAlerts({ ...ok }, { ...prod, production: false, privateHostsAllowed: true })).toEqual([]);   // fine on a developer's machine
    expect(healthAlerts({ ...ok }, { ...prod, emailTransport: "unusable" })[0]).toMatchObject({ code: "EMAIL_INTEGRATION_UNUSABLE", severity: "critical" });
  });
});

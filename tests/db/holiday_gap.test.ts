import { describe, expect, it } from "vitest";
import { W1, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * Characterisation of a gap found while advising the owner on weeks that were already past when a quarter was activated (audit F-033).
 * A week whose final-lock TIME has passed but which the finalisation job has not processed yet is "closed" for the ordinary holiday route
 * (report_phase is derived from the clock) yet "not closed" for the amendment route (it checks the stored week status). So for that window
 * neither route can declare the week an organisation holiday. This test pins today's behaviour; if the gap is closed, update it.
 */
async function world(c: Ctx) {
  const bu = await c.bu("ALPHA");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const hr = await c.user(["HR"], bu, "hr");
  await seedStrategy(c, admin);
  return { admin, sa, hr, wk: await weekId(c) };
}

describe("holiday declaration for a week past its final lock that has not been finalised yet", () => {
  it("is refused by both routes until the finalisation job has run, and then works through the amendment route", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow("2031-01-14T11:05:00+01:00");                 // five minutes after final lock; the job has not run
      expect((await c.q<{ status: string }>("select status from reporting_weeks where id = $1", [w.wk]))[0].status).not.toBe("FINAL_LOCKED");
      // route 1 (direct) says: it is locked, use the amendment route
      await c.expectError("HOLIDAY_AMENDMENT_REQUIRED", () => c.rpc("declare_organization_holiday", w.hr, [w.wk], "Public holiday", "gap-1"));
      // route 2 (amendment request) says: it is not closed, amend it directly
      await c.expectError("HOLIDAY_REQUEST_NOT_NEEDED", () => c.rpc("request_holiday_amendment", w.sa, w.wk, "DECLARE", "Public holiday", "gap-request-1"));
      // once the job has finalised the week, the amendment route is open
      await c.rpc("finalize_reporting_week", w.wk);
      const r = await c.rpc<{ status: string }>("request_holiday_amendment", w.sa, w.wk, "DECLARE", "Public holiday", "gap-request-2");
      expect(r.status).toBe("PENDING");
    });
  });
});

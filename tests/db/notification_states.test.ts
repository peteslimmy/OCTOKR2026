import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("NS");
  const admin = await c.user(["ADMIN"], bu, "admin"); const admin2 = await c.user(["ADMIN"], bu, "admin2"); const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead"); const other = await c.user(["BU_LEAD"], bu, "other");
  const strat = await seedStrategy(c, admin);
  return { bu, admin, admin2, sa, lead, other, strat, wk: await weekId(c) };
}
const states = async (c: Ctx, user: string, ids: string[]) => c.asUser(user, () => c.rpc<Record<string, string>>("read_notification_states", ids));
const mine = async (c: Ctx, user: string, event: string) => (await c.q<{ id: string }>("select id from notifications where user_id = $1 and event_type = $2 order by created_at desc limit 1", [user, event]))[0].id;

describe("notification states", () => {
  it("say whether a request that was asked of you is still waiting or has been dealt with", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.open);
      // a holiday amendment request (needs a closed week)
      await c.setNow(W1.finalLock); await c.rpc("finalize_reporting_week", w.wk);
      const req = await c.rpc<{ request_id: string }>("request_holiday_amendment", w.admin, w.wk, "DECLARE", "Public holiday", "ns-key-0001");
      const n = await mine(c, w.admin2, "HOLIDAY_AMENDMENT_REQUESTED");
      expect(await states(c, w.admin2, [n])).toEqual({ [n]: "WAITING" });
      await c.rpc("decide_holiday_amendment_request", w.sa, req.request_id, "REJECT", "Not company-wide", "ns-dec-00001");
      expect(await states(c, w.admin2, [n])).toEqual({ [n]: "DONE" });
      // a strategy change request
      const sc = await c.rpc<{ request_id: string }>("request_strategy_change", w.admin, "EDIT", "KR", w.strat.krIds[0], null, "Reworded", null, "Clearer", "ns-key-0002");
      const m = await mine(c, w.sa, "STRATEGY_CHANGE_REQUESTED");
      expect((await states(c, w.sa, [m]))[m]).toBe("WAITING");
      await c.rpc("decide_strategy_change", w.sa, sc.request_id, "APPROVE", null, "ns-dec-00002");
      expect((await states(c, w.sa, [m]))[m]).toBe("DONE");
    });
  });

  it("shows a report reminder as waiting until the unit submits or the lock passes", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(new Date(new Date(W1.contentLock).getTime() - 5 * 3_600_000).toISOString());
      expect(await c.rpc<number>("send_report_reminders")).toBe(2);
      const n = await mine(c, w.lead, "REPORT_DUE_REMINDER");
      expect((await states(c, w.lead, [n]))[n]).toBe("WAITING");
      await c.setNow(W1.open);
      const g = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["t"], "Publish the pricing sheets by Friday");
      await c.rpc("submit_weekly_report", w.lead, g.reportId, null, null);
      expect((await states(c, w.lead, [n]))[n]).toBe("DONE");
      const o = await mine(c, w.other, "REPORT_DUE_REMINDER");
      await c.setNow(W1.afterContentLock);
      expect((await states(c, w.other, [o]))[o]).toBe("DONE");                        // too late to act on it
    });
  });

  it("reveals nothing about other people's notifications, and ignores events that need no action and entity ids that are not records", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select notify_users(array[$1::uuid], 'REPORT_DUE_REMINDER', 'reporting_week', 'not-a-uuid', 'T', 'M', 'ns-x1')", [w.lead]);
      await c.q("select notify_users(array[$1::uuid], 'PASSWORD_CHANGED', 'user', $1::text, 'T2', 'M2', 'ns-x2')", [w.lead]);
      const bad = await mine(c, w.lead, "REPORT_DUE_REMINDER"); const info = await mine(c, w.lead, "PASSWORD_CHANGED");
      expect(await states(c, w.lead, [bad, info])).toEqual({});                       // neither has a state
      await c.q("select notify_users(array[$1::uuid], 'REPORT_DUE_REMINDER', 'reporting_week', $2, 'T3', 'M3', 'ns-x3')", [w.lead, w.wk]);
      const real = (await c.q<{ id: string }>("select id from notifications where dedupe_key = 'ns-x3'"))[0].id;
      expect(await states(c, w.other, [real])).toEqual({});                           // someone else asking about it learns nothing
      expect(Object.keys(await states(c, w.lead, [real]))).toEqual([real]);
      expect(await states(c, w.lead, [])).toEqual({});
    });
  });
});

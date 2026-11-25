import { describe, expect, it } from "vitest";
import { seedStrategy, withTx, type Ctx } from "./helpers";

/** Business Unit quarterly goals: Admin and Super Admin lock them; afterwards a change needs a request that an Executive, Admin or HR approves (ADR-127). */
async function world(c: Ctx) {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await c.bu(`GF${tag}`), ops = await c.bu(`GO${tag}`), hq = await c.bu(`GH${tag}`);
  const admin = await c.user(["ADMIN"], hq, "admin");
  const sa = await c.user(["SUPER_ADMIN"], hq, "sa");
  const exec = await c.user(["EXECUTIVE"], hq, "exec");
  const hr = await c.user(["HR"], hq, "hr");
  const finance = await c.user(["FINANCE"], hq, "finance");
  const finLead = await c.user(["BU_LEAD"], fin, "finlead");
  const opsLead = await c.user(["BU_LEAD"], ops, "opslead");
  const s = await seedStrategy(c, admin);
  await c.setNow("2031-01-08T09:00:00+01:00");
  return { fin, ops, hq, admin, sa, exec, hr, finance, finLead, opsLead, q: s.quarterId };
}
const goal = (c: Ctx, who: string, bu: string, q: string, title: string) => c.rpc<string>("save_bu_goal", who, null, bu, q, title, "ACTIVE");

describe("locking a quarter's Business Unit goals", () => {
  it("only Admin and Super Admin lock and unlock, with a reason to unlock; a BU Lead cannot change a locked goal but can before", () => withTx(async (c) => {
    const w = await world(c);
    const g1 = await goal(c, w.finLead, w.fin, w.q, "Grow partner revenue");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("lock_bu_goals", w.finLead, w.q, null, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("lock_bu_goals", w.hr, w.q, null, null));
    await c.rpc("lock_bu_goals", w.admin, w.q, w.fin, "Approved by management");              // one unit
    await c.expectError("BU_GOALS_LOCKED", () => goal(c, w.finLead, w.fin, w.q, "A new goal"));
    await c.expectError("BU_GOALS_LOCKED", () => c.rpc("save_bu_goal", w.finLead, g1, null, null, "Renamed", "ACTIVE"));
    await c.expectError("BU_GOALS_LOCKED", () => c.rpc("save_bu_goal", w.finLead, g1, null, null, "Grow partner revenue", "RETIRED"));
    await goal(c, w.opsLead, w.ops, w.q, "Ops goal");                                         // another unit is not locked
    await c.rpc("lock_bu_goals", w.sa, w.q, null, null);                                       // every unit
    await c.expectError("BU_GOALS_LOCKED", () => goal(c, w.opsLead, w.ops, w.q, "Another ops goal"));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("unlock_bu_goals", w.admin, w.q, null, "  "));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("unlock_bu_goals", w.finLead, w.q, null, "please"));
    await c.rpc("unlock_bu_goals", w.admin, w.q, null, "Reopened for corrections");
    await goal(c, w.finLead, w.fin, w.q, "Now allowed");
    expect((await c.q("select 1 from audit_logs where action in ('BU_GOALS_LOCKED', 'BU_GOALS_UNLOCKED')")).length).toBeGreaterThanOrEqual(3);
  }));

  it("the Super Admin, who can lift a lock, is not blocked by it", () => withTx(async (c) => {
    const w = await world(c);
    await c.rpc("lock_bu_goals", w.admin, w.q, null, null);
    await goal(c, w.sa, w.fin, w.q, "Added by the Super Admin while locked");
    expect((await c.q("select 1 from bu_goals where title = 'Added by the Super Admin while locked'")).length).toBe(1);
  }));
});

describe("a change to locked goals is requested and approved", () => {
  it("the BU Lead asks, an Executive, Admin or HR approves, and the change is then in place; nobody decides their own request", () => withTx(async (c) => {
    const w = await world(c);
    const g1 = await goal(c, w.finLead, w.fin, w.q, "Grow partner revenue");
    await c.expectError("VALIDATION_ERROR", () => c.rpc("request_bu_goal_change", w.finLead, w.fin, w.q, "ADD", null, "Early", "not locked yet"));
    await c.rpc("lock_bu_goals", w.admin, w.q, null, null);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("request_bu_goal_change", w.finance, w.fin, w.q, "ADD", null, "x", "y"));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("request_bu_goal_change", w.opsLead, w.fin, w.q, "ADD", null, "x", "y"));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("request_bu_goal_change", w.finLead, w.fin, w.q, "ADD", null, "New goal", " "));
    const add = await c.rpc<string>("request_bu_goal_change", w.finLead, w.fin, w.q, "ADD", null, "Open a second office", "New market opportunity");
    const ren = await c.rpc<string>("request_bu_goal_change", w.finLead, w.fin, w.q, "RENAME", g1, "Grow partner revenue by 20%", "Target agreed with the board");
    await c.expectError("VALIDATION_ERROR", () => c.rpc("request_bu_goal_change", w.finLead, w.fin, w.q, "RETIRE", g1, null, "No longer relevant"));   // a retirement has its own workflow (ADR-134)
    const ret = await c.rpc<string>("request_bu_goal_change", w.finLead, w.fin, w.q, "RENAME", g1, "Something else", "Not the right wording");
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_CHANGE_REQUESTED' and user_id = $1", [w.exec])).length).toBeGreaterThan(0);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_change", w.finLead, add, true, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_change", w.finance, add, true, null));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("decide_bu_goal_change", w.exec, add, false, " "));
    await c.rpc("decide_bu_goal_change", w.exec, add, true, null);                              // an Executive approves
    await c.rpc("decide_bu_goal_change", w.hr, ren, true, null);                                // HR approves
    await c.rpc("decide_bu_goal_change", w.admin, ret, false, "Keep it until the quarter ends"); // an Admin rejects
    expect((await c.q<{ title: string; status: string }>("select title, status from bu_goals where business_unit_id = $1 order by position", [w.fin])).map((r) => `${r.title}|${r.status}`))
      .toEqual(["Grow partner revenue by 20%|ACTIVE", "Open a second office|ACTIVE"]);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_bu_goal_change", w.exec, add, true, null));
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_CHANGE_APPROVED' and user_id = $1", [w.finLead])).length).toBe(2);
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_CHANGE_REJECTED' and user_id = $1", [w.finLead])).length).toBe(1);
    await c.expectError("BU_GOALS_LOCKED", () => goal(c, w.finLead, w.fin, w.q, "Direct change still refused"));   // the lock stays
  }));

  it("an Admin who asks cannot approve their own request; a request can be withdrawn only by its author; the lists show what each person may see", () => withTx(async (c) => {
    const w = await world(c);
    const g1 = await goal(c, w.finLead, w.fin, w.q, "Grow partner revenue");
    await c.rpc("lock_bu_goals", w.admin, w.q, null, null);
    const r = await c.rpc<string>("request_bu_goal_change", w.finLead, w.fin, w.q, "RENAME", g1, "Dropped wording", "Dropped");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("withdraw_bu_goal_change", w.opsLead, r));
    const mine = await c.asUser(w.finLead, () => c.rpc<{ id: string; mine: boolean }[]>("read_bu_goal_change_requests", w.q, null));
    expect(mine.map((x) => x.id)).toEqual([r]);
    expect(await c.asUser(w.opsLead, () => c.rpc<unknown[]>("read_bu_goal_change_requests", w.q, null))).toHaveLength(0);
    expect(await c.asUser(w.exec, () => c.rpc<unknown[]>("read_bu_goal_change_requests", w.q, null))).toHaveLength(1);
    const state = await c.asUser(w.finLead, () => c.rpc<{ locked: boolean; scope: string }>("read_bu_goal_lock_state", w.q, w.fin));
    expect(state).toMatchObject({ locked: true, scope: "ALL_UNITS" });
    await c.rpc("withdraw_bu_goal_change", w.finLead, r);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_bu_goal_change", w.exec, r, true, null));
  }));
});

describe("bulk upload of quarterly goals", () => {
  it("adds every goal in one step for the BU Lead's own unit, refuses a duplicate with nothing added, and respects a lock", () => withTx(async (c) => {
    const w = await world(c);
    const out = await c.rpc<{ created: number }>("bulk_save_bu_goals", w.finLead, w.fin, w.q, JSON.stringify(["Goal one", "Goal two", "Goal three"]));
    expect(out.created).toBe(3);
    expect((await c.q("select 1 from bu_goals where business_unit_id = $1", [w.fin])).length).toBe(3);
    await c.expectError("VALIDATION_ERROR", () => c.rpc("bulk_save_bu_goals", w.finLead, w.fin, w.q, JSON.stringify(["Brand new", "Goal one"])));   // one duplicate: nothing is added
    expect((await c.q("select 1 from bu_goals where business_unit_id = $1", [w.fin])).length).toBe(3);
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("bulk_save_bu_goals", w.opsLead, w.fin, w.q, JSON.stringify(["Not mine"])));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("bulk_save_bu_goals", w.finance, w.fin, w.q, JSON.stringify(["x"])));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("bulk_save_bu_goals", w.finLead, w.fin, w.q, JSON.stringify([])));
    await c.rpc("lock_bu_goals", w.admin, w.q, w.fin, null);
    await c.expectError("BU_GOALS_LOCKED", () => c.rpc("bulk_save_bu_goals", w.finLead, w.fin, w.q, JSON.stringify(["After the lock"])));
    expect((await c.q("select 1 from audit_logs where action = 'BU_GOALS_UPLOADED'")).length).toBe(1);
  }));
});

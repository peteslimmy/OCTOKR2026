import { describe, expect, it } from "vitest";
import { seedStrategy, withTx, type Ctx } from "./helpers";

/** A Business Unit goal is retired only when the executive the BU Lead chose approves (ADR-134). */
async function world(c: Ctx) {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await c.bu(`RF${tag}`), ops = await c.bu(`RO${tag}`), hq = await c.bu(`RH${tag}`);
  const admin = await c.user(["ADMIN"], hq, "admin");
  const sa = await c.user(["SUPER_ADMIN"], hq, "sa");
  const exec = await c.user(["EXECUTIVE"], hq, "exec");
  const exec2 = await c.user(["EXECUTIVE"], hq, "exectwo");
  const director = await c.user(["DIRECTOR"], hq, "director");
  const hr = await c.user(["HR"], hq, "hr");
  const finLead = await c.user(["BU_LEAD"], fin, "finlead");
  const opsLead = await c.user(["BU_LEAD"], ops, "opslead");
  const s = await seedStrategy(c, admin);
  await c.setNow("2031-01-08T09:00:00+01:00");
  const goal = (who: string, bu: string, title: string) => c.rpc<string>("save_bu_goal", who, null, bu, s.quarterId, title, "ACTIVE");
  const ask = (who: string, g: string, exec_: string, why: string | null = "No longer relevant", key: string | null = null) =>
    c.rpc<{ id: string; status: string; existing: boolean; executive_id: string }>("request_bu_goal_retirement", who, g, exec_, why, key);
  const status = async (g: string) => (await c.q<{ status: string }>("select status from bu_goals where id = $1", [g]))[0].status;
  return { fin, ops, hq, admin, sa, exec, exec2, director, hr, finLead, opsLead, q: s.quarterId, goal, ask, status };
}

describe("who may be chosen", () => {
  it("lists only active people with the Executive role, by name, never a Director, the Super Admin, the requester, HR or a suspended person", () => withTx(async (c) => {
    const w = await world(c);
    await c.q("update users set status = 'SUSPENDED' where id = $1", [w.exec2]);
    const list = await c.asUser(w.finLead, () => c.rpc<{ id: string; name: string; role: string }[]>("read_bu_goal_retirement_executives"));
    const ids = list.map((x) => x.id);
    expect(ids).toContain(w.exec);
    expect(ids).not.toContain(w.director);                                                  // only the Executive role may approve (owner, 2026-11-25)
    expect(ids).not.toContain(w.sa);
    expect(ids).not.toContain(w.hr);
    expect(ids).not.toContain(w.admin);
    expect(ids).not.toContain(w.exec2);
    expect(list.find((x) => x.id === w.exec)).toMatchObject({ role: "EXECUTIVE" });
    expect(list.every((x) => x.role === "EXECUTIVE")).toBe(true);
    expect(list.find((x) => x.id === w.exec)?.name).toMatch(/\S+ \S+/);
    await c.expectError("PERMISSION_DENIED", () => c.asUser(w.hr, () => c.rpc("read_bu_goal_retirement_executives")));   // only people who keep goals
  }));
});

describe("asking for a retirement", () => {
  it("needs permission, the lead's own unit, an executive from the list and a justification; the goal does not change", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    await c.expectError("PERMISSION_DENIED", () => w.ask(w.hr, g, w.exec));
    await c.expectError("BU_SCOPE_DENIED", () => w.ask(w.opsLead, g, w.exec));                    // another unit's goal
    await c.expectError("VALIDATION_ERROR", () => w.ask(w.finLead, g, w.exec, "  "));              // a justification is required
    await c.expectError("VALIDATION_ERROR", () => w.ask(w.finLead, g, w.hr));                       // not an executive
    await c.expectError("VALIDATION_ERROR", () => w.ask(w.finLead, g, w.sa));                       // the Super Admin is never offered
    await c.expectError("VALIDATION_ERROR", () => w.ask(w.finLead, g, w.finLead));                  // not yourself
    await c.expectError("NOT_FOUND", () => w.ask(w.finLead, "11111111-1111-4111-8111-111111111111", w.exec));
    const r = await w.ask(w.finLead, g, w.exec, "The unit no longer works on this");
    expect(r).toMatchObject({ status: "PENDING", existing: false, executive_id: w.exec });
    expect(await w.status(g)).toBe("ACTIVE");                                                        // until approval the goal stays exactly as it is
    const audit = await c.q("select 1 from audit_logs where action = 'BU_GOAL_RETIREMENT_REQUESTED' and entity_id = $1", [r.id]);
    expect(audit.length).toBe(1);
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_RETIREMENT_REQUESTED' and user_id = $1", [w.exec])).length).toBe(1);
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_RETIREMENT_REQUESTED' and user_id = $1", [w.exec2])).length).toBe(0);   // only the chosen executive is told
  }));

  it("allows one open request per goal: a repeat returns the existing one; a retired goal or a locked quarter cannot be asked about", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const first = await w.ask(w.finLead, g, w.exec, "Reason one", "key-one-aaaa");
    const again = await w.ask(w.finLead, g, w.exec2, "Reason two", "key-two-bbbb");                   // even naming someone else
    expect(again).toMatchObject({ id: first.id, existing: true, executive_id: w.exec });
    expect((await c.q("select 1 from bu_goal_retirement_requests where bu_goal_id = $1", [g])).length).toBe(1);
  }));

  it("a goal that is already retired cannot be asked about", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Old goal");
    await c.rpc("save_bu_goal", w.sa, g, null, null, "Old goal", "RETIRED");                           // the Super Admin has no limit (ADR-112)
    await c.expectError("VALIDATION_ERROR", () => w.ask(w.finLead, g, w.exec));
  }));
});

describe("no direct retirement", () => {
  it("a BU Lead cannot retire a goal directly, nor add one already retired; the old locked-goal request no longer takes RETIRE", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    await c.expectError("BU_GOAL_RETIRE_REQUIRES_APPROVAL", () => c.rpc("save_bu_goal", w.finLead, g, null, null, "Grow partner revenue", "RETIRED"));
    await c.expectError("BU_GOAL_RETIRE_REQUIRES_APPROVAL", () => c.rpc("save_bu_goal", w.finLead, null, w.fin, w.q, "Born retired", "RETIRED"));
    expect(await w.status(g)).toBe("ACTIVE");
    await c.rpc("lock_bu_goals", w.admin, w.q, null, null);
    await c.expectError("VALIDATION_ERROR", () => c.rpc("request_bu_goal_change", w.finLead, w.fin, w.q, "RETIRE", g, null, "Dropped", w.exec));
    expect(await w.status(g)).toBe("ACTIVE");
  }));

  it("an old pending RETIRE change request cannot be approved (it can be rejected)", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    await c.rpc("lock_bu_goals", w.admin, w.q, null, null);
    // a request raised before the workflow existed
    const old = (await c.q<{ id: string }>("insert into bu_goal_change_requests (business_unit_id, quarter_id, kind, bu_goal_id, reason, requested_by) values ($1, $2, 'RETIRE', $3, 'old', $4) returning id", [w.fin, w.q, g, w.finLead]))[0].id;
    
    // a request raised before the workflow has no executive named, so only the Super Admin decides it (ADR-135)
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_change", w.exec, old, true, null));
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_bu_goal_change", w.sa, old, true, null));
    expect(await w.status(g)).toBe("ACTIVE");
    await c.rpc("decide_bu_goal_change", w.sa, old, false, "Use the retirement request");
  }));
});

describe("the decision", () => {
  it("only the chosen executive decides; another executive, HR and Admin are refused; the lead cannot approve their own", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const r = await w.ask(w.finLead, g, w.exec);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_retirement", w.exec2, r.id, true, null));    // another executive
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_retirement", w.director, r.id, true, null)); // a director who was not chosen
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_retirement", w.hr, r.id, true, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_retirement", w.admin, r.id, true, null));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_retirement", w.finLead, r.id, true, null));
    expect(await w.status(g)).toBe("ACTIVE");
    expect((await c.q("select 1 from bu_goal_retirement_requests where id = $1 and status = 'PENDING'", [r.id])).length).toBe(1);
  }));

  it("approval retires the goal exactly as before: status only, weekly goals and history stay, audit and the lead's notice are written", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const before = (await c.q<{ title: string; code: string; position: number; created_at: string }>("select title, code, position, created_at from bu_goals where id = $1", [g]))[0];
    const r = await w.ask(w.finLead, g, w.exec);
    const out = await c.rpc<{ decision: string; replay: boolean }>("decide_bu_goal_retirement", w.exec, r.id, true, null);
    expect(out).toMatchObject({ decision: "APPROVED", replay: false });
    const after = (await c.q<{ title: string; code: string; position: number; created_at: string; status: string }>("select title, code, position, created_at, status from bu_goals where id = $1", [g]))[0];
    expect(after.status).toBe("RETIRED");
    expect({ title: after.title, code: after.code, position: after.position, created_at: after.created_at }).toEqual(before);   // nothing rewritten
    expect((await c.q("select 1 from bu_goals where id = $1", [g])).length).toBe(1);                                             // nothing deleted
    expect((await c.q("select 1 from audit_logs where action = 'BU_GOAL_RETIRED' and entity_id = $1", [g])).length).toBe(1);
    expect((await c.q("select 1 from audit_logs where action = 'BU_GOAL_RETIREMENT_APPROVED' and entity_id = $1", [r.id])).length).toBe(1);
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_RETIREMENT_APPROVED' and user_id = $1", [w.finLead])).length).toBe(1);
    const row = (await c.q<{ status: string; decided_by: string; decided_at: string }>("select status, decided_by, decided_at from bu_goal_retirement_requests where id = $1", [r.id]))[0];
    expect(row).toMatchObject({ status: "APPROVED", decided_by: w.exec });
    expect(row.decided_at).not.toBeNull();
    // a repeat by the same executive is a replay; the other way round is refused; a decided request never changes
    expect((await c.rpc<{ replay: boolean }>("decide_bu_goal_retirement", w.exec, r.id, true, null)).replay).toBe(true);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_bu_goal_retirement", w.exec, r.id, false, "changed my mind"));
    await c.expectError("IMMUTABLE_RECORD", () => c.q("update bu_goal_retirement_requests set status = 'REJECTED', decision_comment = 'x' where id = $1", [r.id]));
    await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from bu_goal_retirement_requests where id = $1", [r.id]));
    // an already retired goal cannot be asked about again
    await c.expectError("VALIDATION_ERROR", () => w.ask(w.finLead, g, w.exec));
  }));

  it("a rejection needs a comment; the goal stays active; the lead is told and may ask again", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const r = await w.ask(w.finLead, g, w.exec);
    await c.expectError("VALIDATION_ERROR", () => c.rpc("decide_bu_goal_retirement", w.exec, r.id, false, null));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("decide_bu_goal_retirement", w.exec, r.id, false, "   "));
    expect(await w.status(g)).toBe("ACTIVE");
    await c.rpc("decide_bu_goal_retirement", w.exec, r.id, false, "Still needed for the audit");
    expect(await w.status(g)).toBe("ACTIVE");
    const row = (await c.q<{ status: string; decision_comment: string }>("select status, decision_comment from bu_goal_retirement_requests where id = $1", [r.id]))[0];
    expect(row).toMatchObject({ status: "REJECTED", decision_comment: "Still needed for the audit" });
    const note = await c.q<{ message: string }>("select message from notifications where event_type = 'BU_GOAL_RETIREMENT_REJECTED' and user_id = $1", [w.finLead]);
    expect(note).toHaveLength(1);
    expect(note[0].message).toContain("Still needed for the audit");
    expect((await c.q("select 1 from audit_logs where action = 'BU_GOAL_RETIREMENT_REJECTED' and entity_id = $1", [r.id])).length).toBe(1);
    // a rejected goal can be asked about again (a new request, the old one stays as history)
    const again = await w.ask(w.finLead, g, w.exec2, "New reason");
    expect(again.existing).toBe(false);
    expect((await c.q("select 1 from bu_goal_retirement_requests where bu_goal_id = $1", [g])).length).toBe(2);
  }));

  it("the Super Admin has no limit (ADR-112): may decide for the chosen executive, recorded as done on their behalf, without being named to the lead", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const r = await w.ask(w.finLead, g, w.exec);
    await c.rpc("decide_bu_goal_retirement", w.sa, r.id, true, null);
    expect(await w.status(g)).toBe("RETIRED");
    const a = await c.q<{ after: { decided_on_behalf_of_chosen_executive: boolean; chosen_executive_id: string } }>("select new_values as after from audit_logs where action = 'BU_GOAL_RETIREMENT_APPROVED' and entity_id = $1", [r.id]);
    expect(a[0].after).toMatchObject({ decided_on_behalf_of_chosen_executive: true, chosen_executive_id: w.exec });
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_RETIREMENT_DECIDED' and user_id = $1", [w.exec])).length).toBe(1);
    const seen = await c.asUser(w.finLead, () => c.rpc<{ decider: string }[]>("read_bu_goal_retirements", w.q, w.fin, false));
    expect(seen[0].decider).toBe("An administrator");
  }));
});

describe("cancelling and the lists", () => {
  it("only the lead who asked cancels, only while pending; the goal is unchanged and the executive is told", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const r = await w.ask(w.finLead, g, w.exec);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("cancel_bu_goal_retirement", w.opsLead, r.id));
    await c.expectError("PERMISSION_DENIED", () => c.rpc("cancel_bu_goal_retirement", w.exec, r.id));
    await c.rpc("cancel_bu_goal_retirement", w.finLead, r.id);
    expect(await w.status(g)).toBe("ACTIVE");
    expect((await c.rpc<{ replay: boolean }>("cancel_bu_goal_retirement", w.finLead, r.id)).replay).toBe(true);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_bu_goal_retirement", w.exec, r.id, true, null));    // a cancelled request cannot be approved
    expect(await w.status(g)).toBe("ACTIVE");
    expect((await c.q("select 1 from audit_logs where action = 'BU_GOAL_RETIREMENT_CANCELLED' and entity_id = $1", [r.id])).length).toBe(1);
    expect((await c.q("select 1 from notifications where event_type = 'BU_GOAL_RETIREMENT_CANCELLED' and user_id = $1", [w.exec])).length).toBe(1);
    const done = await w.ask(w.finLead, g, w.exec2, "Another executive this time");                                           // reassignment = cancel and ask again
    expect(done.executive_id).toBe(w.exec2);
    // an approved request cannot be cancelled
    await c.rpc("decide_bu_goal_retirement", w.exec2, done.id, true, null);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("cancel_bu_goal_retirement", w.finLead, done.id));
  }));

  it("each person sees only what is theirs: the unit's lead, the chosen executive and the Super Admin", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const r = await w.ask(w.finLead, g, w.exec);
    const list = (who: string, toDecide = false) => c.asUser(who, () => c.rpc<{ id: string; can_decide: boolean; mine: boolean; executive: string }[]>("read_bu_goal_retirements", null, null, toDecide));
    expect((await list(w.finLead)).map((x) => [x.id, x.mine, x.can_decide])).toEqual([[r.id, true, false]]);
    expect((await list(w.exec, true)).map((x) => [x.id, x.can_decide])).toEqual([[r.id, true]]);
    expect(await list(w.exec2, true)).toHaveLength(0);
    expect(await list(w.opsLead)).toHaveLength(0);
    expect((await list(w.sa, true)).map((x) => x.id)).toEqual([r.id]);
    expect((await list(w.finLead))[0].executive).toMatch(/\S+ \S+/);
  }));

  it("a suspended chosen executive leaves the request pending; the lead sees it and can cancel and choose again", () => withTx(async (c) => {
    const w = await world(c);
    const g = await w.goal(w.finLead, w.fin, "Grow partner revenue");
    const r = await w.ask(w.finLead, g, w.exec);
    await c.q("update users set status = 'SUSPENDED' where id = $1", [w.exec]);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_bu_goal_retirement", w.exec, r.id, true, null));
    const seen = await c.asUser(w.finLead, () => c.rpc<{ executive_active: boolean; status: string }[]>("read_bu_goal_retirements", w.q, w.fin, false));
    expect(seen[0]).toMatchObject({ status: "PENDING", executive_active: false });
    await c.rpc("cancel_bu_goal_retirement", w.finLead, r.id);
    expect((await w.ask(w.finLead, g, w.exec2)).existing).toBe(false);
  }));
});

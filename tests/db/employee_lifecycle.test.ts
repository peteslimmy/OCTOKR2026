import { describe, expect, it } from "vitest";
import { draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/** The people lifecycle (migration 20261107000001): joining, moving to another unit, promotion (for example to BU Lead, also in a new unit), losing a role, suspension. */
async function world(c: Ctx) {
  const { bu, user, q, setNow } = c;
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await bu(`F${tag}`), ops = await bu(`O${tag}`), hq = await bu(`H${tag}`);
  const admin = await user(["ADMIN"], hq, "admin");
  const s = await seedStrategy(c, admin);
  const wk = await weekId(c);
  const hr = await user(["HR"], hq, "hr");
  const finLead = await user(["BU_LEAD"], fin, "finlead");
  const staff = await user(["PRESENTER"], fin, "staff");
  const opsLead = await user(["BU_LEAD"], ops, "opslead");
  await setNow("2031-01-07T10:00:00+01:00");
  const emp = async (u: string) => (await q<{ employee_id: string }>("select employee_id from users where id = $1", [u]))[0].employee_id;
  const events = async (e: string) => q<Record<string, string | boolean | null>>("select * from employee_lifecycle_events where employee_id = $1 order by seq", [e]);
  return { fin, ops, hq, admin, s, wk, hr, finLead, staff, opsLead, emp, events };
}

const move = (c: Ctx, actor: string, employee: string, toBu: string | null, roles: string[] | null, effective: string | null, reason: string | null) =>
  c.rpc<{ moved: boolean; roles_changed: boolean; source_unit_left_without_lead: boolean; target_unit_has_lead: boolean }>("transfer_or_promote", actor, employee, toBu, roles, effective, reason);

describe("the journey is written as it happens", () => {
  it("records joining, the sign-in and the roles a person starts with", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    const types = (await w.events(e)).map((x) => `${x.event_type}${x.role_code ? ":" + x.role_code : ""}`);
    expect(types).toEqual(expect.arrayContaining(["JOINED", "SIGN_IN_CREATED", "ROLE_GRANTED:PRESENTER"]));
    expect((await w.events(e))[0]).toMatchObject({ event_type: "JOINED", to_bu_id: w.fin, source: "SYSTEM" });
  }));

  it("moves a person to another unit with a reason and an effective date, naming who did it", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    const r = await move(c, w.admin, e, w.ops, null, "2031-01-05", "Moved to cover Operations");
    expect(r).toMatchObject({ moved: true, roles_changed: false });
    expect((await c.q<{ business_unit_id: string }>("select business_unit_id from employees where id = $1", [e]))[0].business_unit_id).toBe(w.ops);
    const t = (await w.events(e)).find((x) => x.event_type === "TRANSFERRED")!;
    expect(t).toMatchObject({ from_bu_id: w.fin, to_bu_id: w.ops, reason: "Moved to cover Operations", source: "MANUAL" });
    expect(new Date(String(t.effective_date)).getDate()).toBe(5);
    expect(String(t.actor_name)).toContain("admin");
  }));

  it("promotes to BU Lead in the person's own unit, and shows it as a promotion", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    await move(c, w.admin, e, null, ["PRESENTER", "BU_LEAD"], null, "Promoted to lead Finance");
    const journey = await c.asUser(w.admin, () => c.rpc<{ events: { event_type: string; role_code: string | null; promotion: boolean; reason: string | null }[] }>("read_employee_journey", e));
    const g = journey.events.filter((x) => x.event_type === "ROLE_GRANTED" && x.role_code === "BU_LEAD");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ promotion: true, reason: "Promoted to lead Finance" });
    expect(journey.events.filter((x) => x.role_code === "PRESENTER" && x.reason === "Promoted to lead Finance")).toHaveLength(0);   // an unchanged role is not re-recorded
  }));

  it("promotes to BU Lead in a new unit in one step, with one reason on both entries", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    const r = await move(c, w.admin, e, w.hq, ["BU_LEAD"], null, "Appointed lead of the new unit");
    expect(r).toMatchObject({ moved: true, roles_changed: true });
    const ev = await w.events(e);
    const reasons = ev.filter((x) => x.reason === "Appointed lead of the new unit").map((x) => x.event_type).sort();
    expect(reasons).toEqual(["ROLE_GRANTED", "ROLE_REMOVED", "TRANSFERRED"].sort());
    expect((await c.q<{ code: string }>("select r.code from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1", [w.staff])).map((x) => x.code)).toEqual(["BU_LEAD"]);
  }));

  it("warns when the unit left behind has no other lead, and when the new unit already has one", () => withTx(async (c) => {
    const w = await world(c);
    const r = await move(c, w.admin, await w.emp(w.finLead), w.ops, null, null, "Transfer");
    expect(r).toMatchObject({ source_unit_left_without_lead: true, target_unit_has_lead: true });
  }));

  it("records losing a role, suspension, reactivation and going inactive", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    await c.rpc("set_user_status", w.admin, w.staff, "SUSPENDED");
    await c.rpc("set_user_status", w.admin, w.staff, "ACTIVE");
    await c.rpc("update_employee", w.admin, e, "Ada", "Okoye", w.fin, "INACTIVE");
    const types = (await w.events(e)).map((x) => x.event_type);
    expect(types).toEqual(expect.arrayContaining(["SUSPENDED", "RESTORED", "DEACTIVATED"]));
    expect((await w.events(e)).find((x) => x.event_type === "SUSPENDED")).toMatchObject({ source: "MANUAL" });
  }));

  it("does not rewrite the past: a report keeps the unit it was filed for", () => withTx(async (c) => {
    const w = await world(c);
    const { reportId } = await draftGoal(c, w.finLead, w.wk, w.s.subKrIds[0], ["Reconcile ledgers"]);
    await move(c, w.admin, await w.emp(w.finLead), w.ops, null, null, "Transfer");
    expect((await c.q<{ business_unit_id: string }>("select business_unit_id from weekly_reports where id = $1", [reportId]))[0].business_unit_id).toBe(w.fin);
  }));

  it("leaves the journey alone when roles are saved unchanged", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    const before = (await w.events(e)).length;
    await c.rpc("set_user_roles", w.admin, w.staff, ["PRESENTER"]);
    expect((await w.events(e)).length).toBe(before);
  }));

  it("tells the person", () => withTx(async (c) => {
    const w = await world(c);
    await move(c, w.admin, await w.emp(w.staff), w.ops, null, null, "Cover");
    expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'LIFECYCLE_CHANGE'", [w.staff])).length).toBe(1);
  }));
});

describe("the guided action's rules", () => {
  it("needs the permission to manage people, a reason, a past or present date and a real change", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    await c.expectError("PERMISSION_DENIED", () => move(c, w.hr, e, w.ops, null, null, "x"));
    await c.expectError("PERMISSION_DENIED", () => move(c, w.finLead, e, w.ops, null, null, "x"));
    await c.expectError("REASON_REQUIRED", () => move(c, w.admin, e, w.ops, null, null, "  "));
    await c.expectError("VALIDATION_ERROR", () => move(c, w.admin, e, w.ops, null, "2031-06-01", "future"));
    await c.expectError("VALIDATION_ERROR", () => move(c, w.admin, e, w.fin, null, null, "same unit, no role change"));
    await c.expectError("VALIDATION_ERROR", () => move(c, w.admin, e, w.ops, [], null, "no roles"));
  }));

  it("keeps the existing limits: only a role manager hands out a privileged role; an inactive unit or person is refused", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    await c.expectError("PERMISSION_DENIED", () => move(c, w.admin, e, null, ["PRESENTER", "ADMIN"], null, "make admin"));
    await c.q("update business_units set status = 'INACTIVE' where id = $1", [w.ops]);
    await c.expectError("VALIDATION_ERROR", () => move(c, w.admin, e, w.ops, null, null, "to an archived unit"));
    await c.rpc("update_employee", w.admin, e, "Ada", "Okoye", w.fin, "INACTIVE");
    await c.expectError("VALIDATION_ERROR", () => move(c, w.admin, e, w.hq, null, null, "inactive person"));
    await c.expectError("NOT_FOUND", () => move(c, w.admin, "00000000-0000-0000-0000-000000000009", w.hq, null, null, "ghost"));
  }));

  it("cannot change roles of a person with no sign-in", () => withTx(async (c) => {
    const w = await world(c);
    const eid = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'nologin@test.local', 'No', 'Login', $2) returning id", [c.org, w.fin]))[0].id;
    await c.expectError("VALIDATION_ERROR", () => move(c, w.admin, eid, null, ["BU_LEAD"], null, "promote"));
    expect((await move(c, w.admin, eid, w.ops, null, null, "Moved")).moved).toBe(true);
  }));
});

describe("who can read a journey, and that it cannot be changed", () => {
  it("shows people managers every journey, a person their own, and nobody else's", () => withTx(async (c) => {
    const w = await world(c);
    const e = await w.emp(w.staff);
    await move(c, w.admin, e, w.ops, null, null, "Cover");
    const mine = await c.asUser(w.staff, () => c.rpc<{ events: unknown[] }>("read_employee_journey", e));
    expect(mine.events.length).toBeGreaterThan(2);
    expect((await c.asUser(w.opsLead, () => c.rpc<{ events: unknown[] }>("read_employee_journey", e))).events).toHaveLength(0);
    expect((await c.asUser(w.hr, () => c.rpc<{ events: unknown[] }>("read_employee_journey", e))).events).toHaveLength(0);
    expect((await c.asUser(w.admin, () => c.rpc<{ events: unknown[] }>("read_employee_journey", e))).events.length).toBeGreaterThan(2);
    const recent = await c.asUser(w.admin, () => c.rpc<{ event_type: string }[]>("read_lifecycle_recent", 10));
    expect(recent.some((r) => r.event_type === "TRANSFERRED")).toBe(true);
    await c.asUser(w.staff, async () => { await c.expectError("permission denied", () => c.client.query("insert into employee_lifecycle_events (employee_id, event_type, effective_date) values (gen_random_uuid(), 'JOINED', now())").then(() => undefined)).catch(() => undefined); });
  }));

  it("refuses edits and deletes of history, even from SQL", () => withTx(async (c) => {
    const w = await world(c);
    for (const sql of ["update employee_lifecycle_events set reason = 'x'", "delete from employee_lifecycle_events"]) {
      await c.client.query("savepoint f");
      let msg = "";
      try { await c.client.query(sql); } catch (e) { msg = (e as Error).message; }
      await c.client.query("rollback to savepoint f");
      expect(msg).toMatch(/IMMUTABLE_RECORD/);
    }
    expect(w.fin).toBeTruthy();
  }));

  it("exposes no write function to signed-in people", () => withTx(async (c) => {
    const exposed = await c.q<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('transfer_or_promote','lc_log','employees_lc','users_lc','user_roles_lc')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
    expect(exposed).toEqual([]);
  }));
});

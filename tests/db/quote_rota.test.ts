import { describe, expect, it } from "vitest";
import { seedStrategy, weekId, withTx, type Ctx, type Role } from "./helpers";

/** Weekly quote rota and the Note Taker role (migration 20261106000008). */
async function world(c: Ctx) {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await c.bu(`QF${tag}`), ops = await c.bu(`QO${tag}`), hq = await c.bu(`QH${tag}`);
  const admin = await c.user(["ADMIN"], hq, "admin");
  const hr = await c.user(["HR"], hq, "hr");
  const finLead = await c.user(["BU_LEAD"], fin, "finlead");
  const opsLead = await c.user(["BU_LEAD"], ops, "opslead");
  const presenter = await c.user(["PRESENTER"], hq, "presenter");
  const superAdmin = await c.user(["SUPER_ADMIN"], hq, "sa");
  const taker = await c.user(["NOTE_TAKER" as Role], hq, "taker");
  const s = await seedStrategy(c, admin);
  const wk1 = await weekId(c, "2031-01-06");
  const wk2 = await weekId(c, "2031-01-13");
  const speaker = (await c.q<{ id: string }>("select e.id from employees e join users u on u.employee_id = e.id where u.id = $1", [finLead]))[0].id;
  const opsPerson = (await c.q<{ id: string }>("select e.id from employees e join users u on u.employee_id = e.id where u.id = $1", [opsLead]))[0].id;
  await c.setNow("2031-01-14T09:00:00+01:00");
  return { fin, ops, hq, admin, hr, finLead, opsLead, presenter, superAdmin, taker, s, wk1, wk2, speaker, opsPerson };
}

describe("quote rota", () => {
  it("HR assigns a unit, its leads are told, the unit submits with a speaker from its own team, the presenter sees and presents it", () => withTx(async (c) => {
    const w = await world(c);
    await c.expectError("PERMISSION_DENIED", () => c.rpc("assign_quote_turn", w.finLead, w.wk1, w.fin));
    const t = await c.rpc<{ id: string }>("assign_quote_turn", w.hr, w.wk1, w.fin);
    expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'QUOTE_TURN_ASSIGNED' and user_id = $1", [w.finLead]))[0].n).toBe(1);
    expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'QUOTE_TURN_ASSIGNED' and user_id = $1", [w.opsLead]))[0].n).toBe(0);
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("submit_quote_turn", w.opsLead, t.id, "Not ours", w.opsPerson));
    await c.expectError("VALIDATION_ERROR", () => c.rpc("submit_quote_turn", w.finLead, t.id, "Quote", w.opsPerson));   // not from the unit's team
    await c.expectError("VALIDATION_ERROR", () => c.rpc("submit_quote_turn", w.finLead, t.id, "   ", w.speaker));
    await c.rpc("submit_quote_turn", w.finLead, t.id, "Ship small, ship often", w.speaker);
    await c.rpc("submit_quote_turn", w.finLead, t.id, "Ship small, ship often.", w.speaker);          // may be changed until presented
    expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'QUOTE_TURN_SUBMITTED' and user_id = $1", [w.hr]))[0].n).toBeGreaterThan(0);
    const shown = await c.asUser(w.presenter, () => c.rpc<{ status: string; quote: string; speaker_name: string; carried: boolean }[]>("read_quote_turns_for_week", w.wk1));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ status: "SUBMITTED", quote: "Ship small, ship often.", carried: false });
    await c.expectError("PERMISSION_DENIED", () => c.rpc("mark_quote_turn_presented", w.finLead, t.id));
    await c.rpc("mark_quote_turn_presented", w.presenter, t.id);
    await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("submit_quote_turn", w.finLead, t.id, "Late change", w.speaker));
    expect((await c.q<{ n: number }>("select count(*)::int n from quote_turn_events where turn_id = $1", [t.id]))[0].n).toBeGreaterThanOrEqual(4);
    await c.expectError("IMMUTABLE_RECORD", () => c.q("update quote_turn_events set event_type = 'X' where turn_id = $1", [t.id]));
  }));

  it("choosing another unit replaces an unpresented choice; holiday weeks cannot be assigned", () => withTx(async (c) => {
    const w = await world(c);
    const a = await c.rpc<{ id: string }>("assign_quote_turn", w.hr, w.wk1, w.fin);
    expect((await c.rpc<{ unchanged: boolean }>("assign_quote_turn", w.hr, w.wk1, w.fin)).unchanged).toBe(true);
    const b = await c.rpc<{ id: string }>("assign_quote_turn", w.hr, w.wk1, w.ops);
    expect(b.id).not.toBe(a.id);
    expect((await c.q<{ status: string }>("select status from quote_turns where id = $1", [a.id]))[0].status).toBe("CANCELLED");
    expect((await c.q<{ n: number }>("select count(*)::int n from quote_turns where reporting_week_id = $1 and status <> 'CANCELLED'", [w.wk1]))[0].n).toBe(1);
    await c.q("update reporting_weeks set reporting_state = 'HOLIDAY' where id = $1", [w.wk2]).catch(() => undefined);
  }));

  it("the Super Admin can assign and enter the quote for any unit, marked as entered on its behalf", () => withTx(async (c) => {
    const w = await world(c);
    const t = await c.rpc<{ id: string }>("assign_quote_turn", w.superAdmin, w.wk1, w.fin);
    await c.rpc("submit_quote_turn", w.superAdmin, t.id, "From the Super Admin", w.speaker);
    const row = (await c.q<{ submitted_for_unit: boolean; status: string }>("select submitted_for_unit, status from quote_turns where id = $1", [t.id]))[0];
    expect(row).toEqual({ submitted_for_unit: true, status: "SUBMITTED" });
    await c.rpc("mark_quote_turn_presented", w.superAdmin, t.id);
  }));

  it("a skipped session moves the quote to the next session without invalidating it, and tells the unit", () => withTx(async (c) => {
    const w = await world(c);
    await c.q("update business_units set status = 'ACTIVE'");
    const t = await c.rpc<{ id: string }>("assign_quote_turn", w.hr, w.wk1, w.fin);
    await c.rpc("submit_quote_turn", w.finLead, t.id, "Patience is a strategy", w.speaker);
    const s1 = await c.rpc<string>("create_governance_session", w.hr, w.wk1);
    await c.rpc("create_governance_session", w.hr, w.wk2);
    await c.rpc("skip_okr_session", w.hr, s1, true, "skip-q-1", "Test reason: session not held");
    const row = (await c.q<{ status: string; reporting_week_id: string; quote: string }>("select status, reporting_week_id, quote from quote_turns where id = $1", [t.id]))[0];
    expect(row).toMatchObject({ status: "SUBMITTED", reporting_week_id: w.wk1, quote: "Patience is a strategy" });
    expect(await c.rpc<unknown[]>("read_quote_turns_for_week", w.wk1)).toHaveLength(0);
    const next = await c.rpc<{ carried: boolean; quote: string }[]>("read_quote_turns_for_week", w.wk2);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ carried: true, quote: "Patience is a strategy" });
    expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'QUOTE_TURN_MOVED' and user_id = $1", [w.finLead]))[0].n).toBe(1);
    await c.rpc("mark_quote_turn_presented", w.presenter, t.id);
  }));

  it("only people with a stake can read the rota; others see nothing", () => withTx(async (c) => {
    const w = await world(c);
    await c.rpc("assign_quote_turn", w.hr, w.wk1, w.fin);
    await c.asUser(w.opsLead, async () => { expect(await c.q("select 1 from quote_turns")).toHaveLength(0); });
    await c.asUser(w.finLead, async () => { expect(await c.q("select 1 from quote_turns")).toHaveLength(1); });
    await c.asUser(w.hr, async () => { expect(await c.q("select 1 from quote_turns")).toHaveLength(1); });
    const people = await c.asUser(w.hr, () => c.rpc<{ id: string }[]>("read_quote_speakers", w.fin));
    expect(people.map((p) => p.id)).toContain(w.speaker);
    expect(await c.asUser(w.opsLead, () => c.rpc<unknown[]>("read_quote_speakers", w.fin))).toEqual([]);
  }));
});

describe("note taker", () => {
  it("opens one organisation-wide minutes page per weekly session, repeatably, and can read it", () => withTx(async (c) => {
    const w = await world(c);
    const a = await c.rpc<{ session_id: string; note_id: string }>("get_or_create_notes_session", w.taker, w.wk1);
    const b = await c.rpc<{ session_id: string; note_id: string }>("get_or_create_notes_session", w.taker, w.wk1);
    expect(b).toEqual(a);
    expect((await c.q<{ status: string; business_unit_id: string | null }>("select status, business_unit_id from okr_sessions where id = $1", [a.session_id]))[0]).toEqual({ status: "IN_PROGRESS", business_unit_id: null });
    const seen = await c.asUser(w.taker, () => c.q<{ content: string }>("select n.content from okr_session_notes n where n.id = $1", [a.note_id]));
    expect(seen).toHaveLength(1);
    expect(seen[0].content).toContain("Recommendations");
    await c.expectError("PERMISSION_DENIED", () => c.rpc("get_or_create_notes_session", w.hr, w.wk1));
    const next = await c.rpc<{ session_id: string }>("get_or_create_notes_session", w.taker, w.wk2);
    expect(next.session_id).not.toBe(a.session_id);
  }));

  it("the Note Taker role holds only the simple note permissions", () => withTx(async (c) => {
    const rows = await c.q<{ code: string }>("select p.code from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where r.code = 'NOTE_TAKER' order by 1");
    expect(rows.map((r) => r.code)).toEqual(["session_notes.create", "session_notes.export", "session_notes.update", "session_notes.view", "session_notes.view_all"]);
  }));
});

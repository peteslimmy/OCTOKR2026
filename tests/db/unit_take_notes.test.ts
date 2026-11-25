import { describe, expect, it } from "vitest";
import { seedStrategy, weekId, withTx, type Ctx, type Role } from "./helpers";

/**
 * Take Notes is a unit's or department's OWN notes from a weekly session (ADR-133); Session Notes are the official notes, written by the people who write them and read
 * by everyone (ADR-126). The database decides who may read and write; these tests pin the rules the two screens rely on.
 */
async function world(c: Ctx) {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await c.bu(`TF${tag}`), ops = await c.bu(`TO${tag}`), hq = await c.bu(`TH${tag}`);
  const finLead = await c.user(["BU_LEAD"], fin, "finlead");
  const finLead2 = await c.user(["BU_LEAD"], fin, "finlead2");        // another person of the same unit
  const opsLead = await c.user(["BU_LEAD"], ops, "opslead");
  const hr = await c.user(["HR"], hq, "hr");
  const finance = await c.user(["FINANCE"], hq, "finance");
  const presenter = await c.user(["PRESENTER"], hq, "presenter");
  const admin = await c.user(["ADMIN"], hq, "admin");
  const superAdmin = await c.user(["SUPER_ADMIN"], hq, "sa");
  const exec = await c.user(["EXECUTIVE"], hq, "exec");
  const director = await c.user(["DIRECTOR"], hq, "director");
  const taker = await c.user(["NOTE_TAKER" as Role], hq, "taker");
  await seedStrategy(c, admin);
  const wk = await weekId(c, "2031-01-06");
  await c.setNow("2031-01-08T09:00:00+01:00");
  return { fin, ops, hq, finLead, finLead2, opsLead, hr, finance, presenter, admin, superAdmin, exec, director, taker, wk };
}
type Opened = { session_id: string; note_id: string };
const open = (c: Ctx, who: string, wk: string, bu?: string) => (bu ? c.rpc<Opened>("get_or_create_notes_session", who, wk, bu) : c.rpc<Opened>("get_or_create_notes_session", who, wk));
const sees = (c: Ctx, who: string, noteId: string) => c.asUser(who, () => c.q("select 1 from okr_session_notes where id = $1", [noteId])).then((r) => r.length);

describe("Take Notes: a unit's own notes", () => {
  it("a unit's lead opens the unit's notes for the week (repeatably); the unit's people and the roles that see every unit read them; other units, HR and Finance do not", () => withTx(async (c) => {
    const w = await world(c);
    const a = await open(c, w.finLead, w.wk, w.fin);
    const again = await open(c, w.finLead, w.wk, w.fin);
    expect(again).toEqual(a);                                                                           // never a second page
    expect((await c.q<{ business_unit_id: string; reporting_week_id: string }>("select business_unit_id, reporting_week_id from okr_sessions where id = $1", [a.session_id]))[0])
      .toEqual({ business_unit_id: w.fin, reporting_week_id: w.wk });
    for (const who of [w.finLead, w.finLead2, w.presenter, w.admin, w.superAdmin, w.exec, w.director, w.taker]) expect(await sees(c, who, a.note_id), "should read").toBe(1);
    for (const who of [w.opsLead, w.hr, w.finance]) expect(await sees(c, who, a.note_id), "must not read").toBe(0);
  }));

  it("a lead cannot open another unit's notes, and the people who only read (Executive, HR, Finance) cannot start them", () => withTx(async (c) => {
    const w = await world(c);
    await open(c, w.finLead, w.wk, w.fin);
    await c.expectError("BU_SCOPE_DENIED", () => open(c, w.opsLead, w.wk, w.fin));                       // another unit, with the unit's page already there
    await c.expectError("BU_SCOPE_DENIED", () => open(c, w.finLead, w.wk, w.ops));                       // another unit, before it has a page
    for (const who of [w.exec, w.hr, w.finance]) await c.expectError("PERMISSION_DENIED", () => open(c, who, w.wk, w.fin));
    // people who write for every unit may open any unit's page
    expect((await open(c, w.presenter, w.wk, w.ops)).session_id).toBeTruthy();
    expect((await open(c, w.taker, w.wk, w.fin)).session_id).toBe((await open(c, w.finLead, w.wk, w.fin)).session_id);
  }));

  it("a department is scoped exactly like a business unit", () => withTx(async (c) => {
    const w = await world(c);
    await c.rpc("change_business_unit_type", w.superAdmin, w.fin, "DEPARTMENT", "Make this unit a department for the test");
    const a = await open(c, w.finLead, w.wk, w.fin);
    expect(await sees(c, w.finLead2, a.note_id)).toBe(1);
    expect(await sees(c, w.opsLead, a.note_id)).toBe(0);
    await c.expectError("BU_SCOPE_DENIED", () => open(c, w.opsLead, w.wk, w.fin));
  }));
});

describe("Session Notes: the official notes", () => {
  it("only a person who writes notes for every unit opens them; a unit's lead is refused whether or not the page exists", () => withTx(async (c) => {
    const w = await world(c);
    await c.expectError("BU_SCOPE_DENIED", () => open(c, w.finLead, w.wk));                              // before the page exists: a lead may not create the organisation-wide page
    const official = await open(c, w.taker, w.wk);
    expect((await open(c, w.presenter, w.wk)).session_id).toBe(official.session_id);
    expect((await open(c, w.superAdmin, w.wk)).session_id).toBe(official.session_id);
    await c.expectError("BU_SCOPE_DENIED", () => open(c, w.finLead, w.wk));                              // once it exists: the lead is not part of it
    for (const who of [w.exec, w.director, w.admin, w.hr, w.finance]) await c.expectError("PERMISSION_DENIED", () => open(c, who, w.wk));
    expect((await c.q<{ business_unit_id: string | null }>("select business_unit_id from okr_sessions where id = $1", [official.session_id]))[0].business_unit_id).toBeNull();
  }));

  it("everyone reads the official notes and never a unit's own notes; the official notes carry nothing of a unit", () => withTx(async (c) => {
    const w = await world(c);
    const unit = await open(c, w.finLead, w.wk, w.fin);
    const official = await open(c, w.taker, w.wk);
    await c.q("update okr_session_notes set content = 'Finance only: renegotiate the vendor contract' where id = $1", [unit.note_id]);
    await c.q("update okr_session_notes set content = 'Official: ship the pilot in March' where id = $1", [official.note_id]);
    for (const who of [w.finLead, w.opsLead, w.hr, w.finance, w.presenter, w.admin, w.superAdmin, w.exec, w.director, w.taker]) {
      const rows = await c.asUser(who, () => c.rpc<{ session_id: string; content: string }[]>("read_general_session_notes", 5));
      expect(rows.map((r) => r.session_id)).toEqual([official.session_id]);
      expect(rows[0].content).toContain("ship the pilot");
      expect(JSON.stringify(rows)).not.toContain("vendor contract");
    }
  }));

  it("a unit's lead cannot change the official notes or another unit's notes", () => withTx(async (c) => {
    const w = await world(c);
    const official = await open(c, w.taker, w.wk);
    const unit = await open(c, w.finLead, w.wk, w.fin);
    // the note functions refuse a person who cannot see the session or is not the note's author, facilitator or creator (version 1 is the one just created)
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("update_okr_note", w.finLead, official.note_id, 1, null, null, "Edited by a unit lead", null, "Trying to change the official notes", false));
    await c.expectError("BU_SCOPE_DENIED", () => c.rpc("update_okr_note", w.opsLead, unit.note_id, 1, null, null, "Edited by another unit", null, "Trying to change another unit's notes", false));
    // the person who opened the unit's page may change it
    const saved = await c.rpc<{ unchanged?: boolean }>("update_okr_note", w.finLead, unit.note_id, 1, null, null, "## Notes\n\nOur own notes", null, null, false);
    expect(saved.unchanged).not.toBe(true);
  }));
});

import { describe, expect, it } from "vitest";
import { seedStrategy, weekId, withTx, type Ctx, type Role } from "./helpers";

/** Session notes: the general note is for everybody, each unit's notes stay private to the unit (ADR-126). */
async function world(c: Ctx) {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const fin = await c.bu(`NF${tag}`), ops = await c.bu(`NO${tag}`), hq = await c.bu(`NH${tag}`);
  const finLead = await c.user(["BU_LEAD"], fin, "finlead");
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
  return { fin, ops, hq, finLead, opsLead, hr, finance, presenter, admin, superAdmin, exec, director, taker, wk };
}
const seeUnitNote = (c: Ctx, who: string, noteId: string) => c.asUser(who, () => c.q("select 1 from okr_session_notes where id = $1", [noteId])).then((r) => r.length);

describe("the general note is for everybody", () => {
  it("every signed-in role can read the Note Taker's general note, and only that", () => withTx(async (c) => {
    const w = await world(c);
    const g = await c.rpc<{ session_id: string; note_id: string }>("get_or_create_notes_session", w.taker, w.wk);
    await c.q("update okr_session_notes set content = 'General: ship the pilot' where id = $1", [g.note_id]);
    for (const who of [w.finLead, w.opsLead, w.hr, w.finance, w.presenter, w.admin, w.superAdmin, w.exec, w.director, w.taker]) {
      const rows = await c.asUser(who, () => c.rpc<{ session_id: string; content: string }[]>("read_general_session_notes", 5));
      expect(rows.map((r) => r.session_id)).toEqual([g.session_id]);
      expect(rows[0].content).toContain("ship the pilot");
    }
  }));
});

describe("each unit's notes stay private to the unit", () => {
  it("only the unit, and Super Admin, Admin, Executive and Director (and the Presenter), read a unit's notes; other units, HR and Finance cannot", () => withTx(async (c) => {
    const w = await world(c);
    const type = (await c.q<{ id: string }>("select id from okr_session_types where code = 'WEEKLY_OKR_REVIEW'"))[0].id;
    const s = (await c.q<{ id: string }>("select (create_okr_session($1, 'Finance unit session', $2, '2031-01-08'::date, $3, $4, null, null, null, $1, null, null, '[]'::jsonb, $5) ->> 'id') as id", [w.finLead, type, w.wk, w.fin, `fin-${Date.now()}`]))[0].id;
    const note = (await c.q<{ id: string }>("select (create_okr_note($1, $2, 'GENERAL_DISCUSSION', 'Finance only', 'Private to Finance', 'SHARED', '[]'::jsonb, $3, null) ->> 'id') as id", [w.finLead, s, `note-${Date.now()}`]))[0].id;
    for (const who of [w.finLead, w.superAdmin, w.admin, w.exec, w.director, w.presenter]) expect(await seeUnitNote(c, who, note)).toBe(1);
    for (const who of [w.opsLead, w.hr, w.finance]) expect(await seeUnitNote(c, who, note)).toBe(0);
    for (const who of [w.opsLead, w.hr, w.presenter]) {
      const general = await c.asUser(who, () => c.rpc<{ session_id: string }[]>("read_general_session_notes", 5));
      expect(general.map((r) => r.session_id)).not.toContain(s);                                     // a unit's session is never in the general list
    }
  }));

  it("the roles that see every unit's notes are Super Admin, Admin, Executive and Director, plus the Presenter (who runs every unit's session) and the Note Taker", () => withTx(async (c) => {
    const rows = await c.q<{ code: string }>("select r.code from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where p.code = 'session_notes.view_all' order by 1");
    expect(rows.map((r) => r.code)).toEqual(["ADMIN", "DIRECTOR", "EXECUTIVE", "NOTE_TAKER", "PRESENTER", "SUPER_ADMIN"]);
  }));
});

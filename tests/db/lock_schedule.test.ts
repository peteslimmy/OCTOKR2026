import { describe, expect, it } from "vitest";
import { seedStrategy, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("LS");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const admin2 = await c.user(["ADMIN"], bu, "admin2");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  return { bu, admin, admin2, sa, hr, lead };
}
let seq = 0;
const key = () => `ls-key-${Date.now()}-${++seq}`;
interface Res { request_id: string; status: string }
const same = { contentLockDay: 2, contentLockTime: "18:00", contentLockWeekOffset: 0, finalLockDay: 2, finalLockTime: "11:00", finalLockWeekOffset: 1 };
const ask = (c: Ctx, actor: string, proposed: unknown, reason = "Management decision") => c.rpc<Res>("request_config_change", actor, "LOCK_SCHEDULE", null, JSON.stringify(proposed), reason, key());
const decide = (c: Ctx, actor: string, id: string) => c.rpc<Res>("decide_config_change", actor, id, "APPROVE", null, key());
const weekRow = async (c: Ctx, monday: string) => (await c.q<{ content: string; final: string; v: number }>(
  `select to_char(content_lock_at at time zone 'Africa/Lagos', 'Dy HH24:MI') content, to_char(final_lock_at at time zone 'Africa/Lagos', 'Dy HH24:MI') final, v.version v
     from reporting_weeks w join reporting_schedule_versions v on v.id = w.schedule_version_id where (w.week_start_at at time zone 'Africa/Lagos')::date = $1::date`, [monday]))[0];

describe("lock schedule is a versioned, approved setting (ADR-070)", () => {
  it("version 1 reproduces the times that were fixed in code, for generated and newly generated weeks", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await seedStrategy(c, w.admin);                                                      // Q1 2031 and all its weeks
      expect(await weekRow(c, "2031-01-06")).toEqual({ content: "Tue 18:00", final: "Tue 11:00", v: 1 });
      expect(await weekRow(c, "2031-03-24")).toEqual({ content: "Tue 18:00", final: "Tue 11:00", v: 1 });
      expect((await c.q<{ version: number; n: number }>("select version, (select count(*)::int from reporting_weeks) n from reporting_schedule_versions"))[0]).toEqual({ version: 1, n: 13 });
    });
  });

  it("a change needs a second person; it never touches a generated week; it applies to weeks generated afterwards and says which", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await seedStrategy(c, w.admin);
      const before = await weekRow(c, "2031-01-06");
      const r = await ask(c, w.admin, { contentLockDay: 3, contentLockTime: "17:30", contentLockWeekOffset: 0, finalLockDay: 3, finalLockTime: "10:00", finalLockWeekOffset: 1 });
      await c.expectError("CONFIG_CHANGE_SELF_APPROVAL", () => decide(c, w.admin, r.request_id));
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.hr, r.request_id));
      expect((await c.q("select 1 from reporting_schedule_versions")).length).toBe(1);        // asking changes nothing
      expect(await decide(c, w.admin2, r.request_id)).toMatchObject({ status: "APPLIED" });
      expect(await weekRow(c, "2031-01-06")).toEqual(before);                                    // generated weeks keep their times and their version
      expect(await weekRow(c, "2031-03-24")).toEqual({ content: "Tue 18:00", final: "Tue 11:00", v: 1 });

      const view = await c.rpc<{ active: { version: number }; first_affected_week: string; weeks_by_version: Record<string, number> }>("read_lock_schedule");
      expect(view.active.version).toBe(2);
      expect(view.first_affected_week).toBe("2031-04-01");                                        // the first quarter with no weeks yet
      expect(view.weeks_by_version).toMatchObject({ "1": 13, "2": 0 });

      await c.rpc("create_year_quarters", w.admin, 2032);                                         // a quarter generated after the change uses the new schedule
      const q = (await c.q<{ id: string }>("select id from quarters where year = 2031 and quarter_number = 2"))[0].id;
      const obj = await c.rpc<string>("create_objective", w.admin, q, "Second quarter", null);
      for (const t of ["A", "B", "C"]) { const kr = await c.rpc<string>("create_key_result", w.admin, obj, `KR ${t}`, null); await c.rpc("create_sub_key_result", w.admin, kr, `S ${t}`, null); }
      await c.setNow("2031-03-30T10:00:00+01:00");
      await c.rpc("activate_quarter", w.admin, q);
      expect(await weekRow(c, "2031-04-07")).toEqual({ content: "Wed 17:30", final: "Wed 10:00", v: 2 });
      expect((await c.q<{ version: number }>("select version from reporting_schedule_versions order by version")).map((v) => v.version)).toEqual([1, 2]);
    });
  });

  it("is validated when asked, with plain reasons", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.hr, { ...same, contentLockTime: "17:00" }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { ...same }));                                                        // nothing changes
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { ...same, contentLockDay: 9 }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { ...same, contentLockTime: "25:99" }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { ...same, finalLockWeekOffset: 4 }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { ...same, finalLockWeekOffset: 0, finalLockTime: "09:00" }));        // final lock before the content lock
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { ...same, contentLockDay: 1, contentLockTime: "00:00" }));            // content lock at the very start of the week
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, { contentLockDay: 2 }));
      expect((await c.q("select 1 from config_change_requests")).length).toBe(0);
    });
  });

  it("versions are immutable, readable by everyone signed in, and report owners are told", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.admin, { ...same, contentLockTime: "17:00" });
      await decide(c, w.sa, r.request_id);
      await c.client.query("savepoint s1");
      await expect(c.client.query("update reporting_schedule_versions set content_lock_time = '09:00' where version = 1")).rejects.toThrow();
      await c.client.query("rollback to savepoint s1");
      await expect(c.client.query("delete from reporting_schedule_versions where version = 2")).rejects.toThrow();
      await c.client.query("rollback to savepoint s1").catch(() => undefined);
      const seen = await c.asUser(w.lead, async () => (await c.q<{ n: number }>("select count(*)::int n from reporting_schedule_versions"))[0].n);
      expect(seen).toBe(2);
      expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'LOCK_SCHEDULE_CHANGED'", [w.lead])).length).toBe(1);
      expect((await c.q("select 1 from audit_logs where action = 'LOCK_SCHEDULE_CHANGED'")).length).toBe(1);
    });
  });
});

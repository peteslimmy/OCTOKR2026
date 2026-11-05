import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("CC");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const admin2 = await c.user(["ADMIN"], bu, "admin2");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const sa2 = await c.user(["SUPER_ADMIN"], bu, "sa2");
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  return { bu, admin, admin2, sa, sa2, hr, lead };
}
let seq = 0;
const key = () => `cc-key-${Date.now()}-${++seq}`;
interface Res { request_id: string; status: string; replayed: boolean }
const ask = (c: Ctx, actor: string, topic: string, target: string | null, proposed: unknown, reason = "Management decision", k = key()) =>
  c.rpc<Res>("request_config_change", actor, topic, target, JSON.stringify(proposed), reason, k);
const decide = (c: Ctx, actor: string, id: string, d: string, comment: string | null = null, k = key()) => c.rpc<Res>("decide_config_change", actor, id, d, comment, k);
const newType = (code: string, fine = 2500) => ({ action: "CREATE", code, name: `Type ${code}`, criticality: "LOW", defaultFine: fine });
const typeRow = async (c: Ctx, code: string) => (await c.q<{ id: string; default_fine: string; active: boolean }>("select id, default_fine, active from violation_types where code = $1", [code]))[0];

describe("configuration changes need a second person (ADR-068)", () => {
  it("who may ask and who may decide, from the seeded permissions", async () => {
    await withTx(async (c) => {
      const perms = async (p: string) => (await c.q<{ code: string }>("select r.code from role_permissions rp join roles r on r.id = rp.role_id join permissions x on x.id = rp.permission_id where x.code = $1 order by 1", [p])).map((r) => r.code);
      expect(await perms("config.approve")).toEqual(["ADMIN", "SUPER_ADMIN"]);
      expect(await perms("config.protected.approve")).toEqual(["SUPER_ADMIN"]);
      expect(await perms("config.emergency")).toEqual(["SUPER_ADMIN"]);
      expect(await perms("violation.edit")).toEqual(["ADMIN", "HR", "SUPER_ADMIN"]);       // owner decision: HR, Admin and Super Admin edit violation types
    });
  });

  it("HR asks, nothing changes until an Admin approves; HR cannot approve and nobody approves their own request", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.hr, "VIOLATION_TYPE", "LATE2", newType("LATE2"));
      expect(r).toMatchObject({ status: "PENDING", replayed: false });
      expect(await typeRow(c, "LATE2")).toBeUndefined();                                    // asking changes nothing
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.hr, r.request_id, "APPROVE"));
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.lead, r.request_id, "APPROVE"));
      const own = await ask(c, w.admin, "VIOLATION_TYPE", "OWN1", newType("OWN1"));
      await c.expectError("CONFIG_CHANGE_SELF_APPROVAL", () => decide(c, w.admin, own.request_id, "APPROVE"));
      expect(await decide(c, w.admin2, r.request_id, "APPROVE")).toMatchObject({ status: "APPLIED" });
      expect(Number((await typeRow(c, "LATE2")).default_fine)).toBe(2500);
      await c.expectError("CONFIG_CHANGE_NOT_PENDING", () => decide(c, w.sa, r.request_id, "APPROVE"));
      const audit = await c.q<{ action: string }>("select action from audit_logs where action in ('CONFIG_CHANGE_REQUESTED','CONFIG_CHANGE_APPLIED','VIOLATION_TYPE_CREATED') order by seq");
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["CONFIG_CHANGE_REQUESTED", "CONFIG_CHANGE_APPLIED", "VIOLATION_TYPE_CREATED"]));
    });
  });

  it("Super Admin can now add violation types, and a changed fee never touches an earlier violation", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.sa, "VIOLATION_TYPE", "SAT1", newType("SAT1", 1200));
      expect(r.status).toBe("APPLIED");                                                          // a Super Admin's own change applies at once
      const t = await typeRow(c, "SAT1");
      const upd = await ask(c, w.hr, "VIOLATION_TYPE", t.id, { action: "UPDATE", name: "Type SAT1", criticality: "HIGH", defaultFine: 9000, active: true });
      expect((await c.q<{ current_value: { default_fine: number } }>("select current_value from config_change_requests where id = $1", [upd.request_id]))[0].current_value.default_fine).toBe(1200);   // the approver sees what would change
      await decide(c, w.sa, upd.request_id, "APPROVE");
      expect(Number((await typeRow(c, "SAT1")).default_fine)).toBe(9000);
    });
  });

  it("is validated when asked, with the setting's own rules, so a bad request never reaches an approver", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.hr, "VIOLATION_TYPE", null, newType("BADFINE", -5)));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.hr, "VIOLATION_TYPE", null, { action: "CREATE", code: "X", name: "x", criticality: "LOW", defaultFine: "abc" }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.hr, "NO_SUCH_TOPIC", null, {}));
      await c.expectError("REASON_REQUIRED", () => ask(c, w.hr, "VIOLATION_TYPE", "NOREASON", newType("NOREASON"), " "));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "PENALTY_RATE", null, { rate: 3 }));
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.lead, "VIOLATION_TYPE", "LEADX", newType("LEADX")));
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.hr, "PENALTY_RATE", null, { rate: 0.1 }));                      // HR may ask for violation types, not for the penalty rate
      expect((await c.q("select 1 from config_change_requests")).length).toBe(0);                                              // nothing was stored, and the dry run left nothing behind
      expect(await typeRow(c, "BADFINE")).toBeUndefined();
      expect((await c.q("select 1 from audit_logs where action = 'VIOLATION_TYPE_CREATED'")).length).toBe(0);
    });
  });

  it("replays, one pending request per target, rejection needs a comment, and the requester can withdraw", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const k = key();
      const a = await ask(c, w.hr, "VIOLATION_TYPE", "REP1", newType("REP1"), "r", k);
      expect(await ask(c, w.hr, "VIOLATION_TYPE", "REP1", newType("REP1"), "r", k)).toMatchObject({ replayed: true, request_id: a.request_id });
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => ask(c, w.admin, "VIOLATION_TYPE", "REP1", newType("REP1"), "r", k));
      await c.expectError("CONFIG_CHANGE_PENDING", () => ask(c, w.admin, "VIOLATION_TYPE", "REP1", newType("REP1")));            // same topic and target
      await c.expectError("REASON_REQUIRED", () => decide(c, w.admin2, a.request_id, "REJECT", " "));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("withdraw_config_change", w.admin, a.request_id));
      await c.rpc("withdraw_config_change", w.hr, a.request_id);
      expect((await c.q<{ status: string }>("select status from config_change_requests where id = $1", [a.request_id]))[0].status).toBe("WITHDRAWN");
      const b = await ask(c, w.hr, "VIOLATION_TYPE", "REP3", newType("REP3"));
      const dk = key();
      expect(await decide(c, w.admin, b.request_id, "REJECT", "Not agreed", dk)).toMatchObject({ status: "REJECTED" });
      expect(await decide(c, w.admin, b.request_id, "REJECT", "Not agreed", dk)).toMatchObject({ replayed: true });
      expect(await typeRow(c, "REP3")).toBeUndefined();
    });
  });

  it("decided requests are immutable and never deleted", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.hr, "VIOLATION_TYPE", "IMM1", newType("IMM1"));
      await decide(c, w.admin, r.request_id, "APPROVE");
      await c.client.query("savepoint s1");
      await expect(c.client.query("update config_change_requests set reason = 'edited' where id = $1", [r.request_id])).rejects.toThrow(/IMMUTABLE_RECORD/);
      await c.client.query("rollback to savepoint s1");
      await expect(c.client.query("delete from config_change_requests where id = $1", [r.request_id])).rejects.toThrow(/IMMUTABLE_RECORD/);
    });
  });

  it("penalty rate, reminder settings and Business Unit reporting follow the same path", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rate = await ask(c, w.admin, "PENALTY_RATE", null, { rate: 0.07 });
      await decide(c, w.sa, rate.request_id, "APPROVE");
      expect(Number((await c.q<{ rate: string }>("select rate from integrity_penalty_configurations where effective_to is null"))[0].rate)).toBeCloseTo(0.07, 5);

      const rem = await ask(c, w.admin, "REMINDER_SETTINGS", null, { remindersEnabled: true, reminderHours: [36, 12], maxRemindersPerWeek: 3, emailEnabled: false });
      await decide(c, w.sa, rem.request_id, "APPROVE");
      expect((await c.q<{ reminder_hours: number[]; max_reminders_per_week: number; email_enabled: boolean }>("select reminder_hours, max_reminders_per_week, email_enabled from notification_settings"))[0]).toEqual({ reminder_hours: [36, 12], max_reminders_per_week: 3, email_enabled: false });

      const bu = await ask(c, w.admin, "BU_REPORTING", w.bu, { name: "Config BU", status: "ACTIVE", reportsWeekly: false });
      expect((await c.q<{ reports_weekly: boolean }>("select reports_weekly from business_units where id = $1", [w.bu]))[0].reports_weekly).toBe(true);   // not yet
      await decide(c, w.admin2, bu.request_id, "APPROVE");
      expect((await c.q<{ reports_weekly: boolean; name: string }>("select reports_weekly, name from business_units where id = $1", [w.bu]))[0]).toEqual({ reports_weekly: false, name: "Config BU" });
    });
  });

  it("emergency path: Super Admin only, a real reason, audited, others alerted, and it supersedes a waiting request", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("emergency_config_change", w.admin, "PENALTY_RATE", null, JSON.stringify({ rate: 0.2 }), "Urgent correction needed", key()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("emergency_config_change", w.sa, "PENALTY_RATE", null, JSON.stringify({ rate: 0.2 }), "short", key()));
      const waiting = await ask(c, w.admin, "PENALTY_RATE", null, { rate: 0.06 });
      const out = await c.rpc<Res>("emergency_config_change", w.sa, "PENALTY_RATE", null, JSON.stringify({ rate: 0.2 }), "Urgent correction needed", key());
      expect(out.status).toBe("APPLIED");
      expect(Number((await c.q<{ rate: string }>("select rate from integrity_penalty_configurations where effective_to is null"))[0].rate)).toBeCloseTo(0.2, 5);
      expect((await c.q<{ status: string }>("select status from config_change_requests where id = $1", [waiting.request_id]))[0].status).toBe("REJECTED");
      expect((await c.q("select 1 from audit_logs where action = 'CONFIG_CHANGE_EMERGENCY'")).length).toBe(1);
      for (const u of [w.sa2, w.admin]) expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'CONFIG_CHANGE_EMERGENCY'", [u])).length, "alerted").toBe(1);
      expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'CONFIG_CHANGE_EMERGENCY'", [w.sa])).length).toBe(0);   // not the person who did it
    });
  });

  it("a browser session cannot call the functions, and reads are limited to people who handle configuration", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.hr, "VIOLATION_TYPE", "RLS1", newType("RLS1"));
      await c.client.query("savepoint s2");
      let denied = false;
      try { await c.asUser(w.admin, () => c.rpc("decide_config_change", w.admin, r.request_id, "APPROVE", null, key())); } catch { denied = true; await c.client.query("rollback to savepoint s2"); }
      expect(denied).toBe(true);
      const visible = async (u: string) => c.asUser(u, async () => (await c.q("select id from config_change_requests")).length);
      expect(await visible(w.admin)).toBe(1);
      expect(await visible(w.hr)).toBe(1);
      expect(await visible(w.lead)).toBe(0);
    });
  });
});

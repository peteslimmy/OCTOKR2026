import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function enrol(c: Ctx, userId: string) {
  await c.q("insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values ($1, $2, 'test', 'totp', 'verified', now(), now(), 'x')", [randomUUID(), userId]);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const batch = (tag: string) => Array.from({ length: 10 }, (_, i) => hash(`${tag}-${i}`));
const issue = (c: Ctx, user: string, hashes = batch("a")) => c.rpc<{ issued: number; replaced_unused: number }>("issue_recovery_codes", user, hashes);
const consume = (c: Ctx, user: string, h: string) => c.rpc<boolean>("consume_recovery_code", user, h);
const remaining = async (c: Ctx, user: string) => (await c.asUser(user, () => c.rpc<{ remaining: number }>("read_my_recovery_status"))).remaining;

async function world(c: Ctx) {
  const bu = await c.bu("RC");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const other = await c.user(["BU_LEAD"], bu, "other");
  const admin = await c.user(["ADMIN"], bu, "admin");
  await enrol(c, lead); await enrol(c, other); await enrol(c, admin);
  return { lead, other, admin };
}

describe("recovery codes", () => {
  it("issues ten at a time, only for an active authenticator, and a new set cancels the old one", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const bu2 = await c.bu("RC2");
      const noFactor = await c.user(["BU_LEAD"], bu2, "nofactor");
      await c.expectError("MFA_NOT_ENROLLED", () => issue(c, noFactor));
      await c.expectError("VALIDATION_ERROR", () => issue(c, w.lead, batch("a").slice(0, 9)));
      await c.expectError("VALIDATION_ERROR", () => issue(c, w.lead, ["not-a-hash", ...batch("a").slice(1)]));
      expect(await issue(c, w.lead)).toMatchObject({ issued: 10, replaced_unused: 0 });
      expect(await remaining(c, w.lead)).toBe(10);
      expect(await issue(c, w.lead, batch("b"))).toMatchObject({ issued: 10, replaced_unused: 10 });
      expect(await remaining(c, w.lead)).toBe(10);
      expect(await consume(c, w.lead, batch("a")[0])).toBe(false);                      // the old set no longer works
      expect(await consume(c, w.lead, batch("b")[0])).toBe(true);
      expect((await c.q<{ action: string }>("select action from audit_logs where actor_user_id = $1 and action like 'AUTH_RECOVERY%' order by seq", [w.lead])).map((a) => a.action))
        .toEqual(["AUTH_RECOVERY_CODES_ISSUED", "AUTH_RECOVERY_CODES_ISSUED", "AUTH_RECOVERY_CODE_USED"]);
    });
  });

  it("spends a code exactly once, belongs to one user, notifies, and never appears in the audit log", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await issue(c, w.lead, batch("lead")); await issue(c, w.other, batch("other"));
      expect(await consume(c, w.lead, batch("lead")[3])).toBe(true);
      expect(await remaining(c, w.lead)).toBe(9);
      expect(await consume(c, w.lead, batch("lead")[3])).toBe(false);                   // not twice
      expect(await consume(c, w.lead, batch("other")[0])).toBe(false);                  // not someone else's
      expect(await remaining(c, w.other)).toBe(10);                                     // and theirs are untouched
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'MFA_RECOVERED' and user_id = $1", [w.lead]))[0].n).toBe(1);
      const audit = JSON.stringify(await c.q("select old_values, new_values, reason from audit_logs where action like 'AUTH_RECOVERY%'"));
      for (const h of [...batch("lead"), ...batch("other")]) expect(audit).not.toContain(h);
    });
  });

  it("counts wrong codes toward the account lockout, and a locked account cannot use even a right one", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await issue(c, w.lead, batch("lead"));
      for (let i = 0; i < 5; i++) expect(await consume(c, w.lead, hash(`wrong-${i}`))).toBe(false);
      expect(await c.rpc<boolean>("user_is_locked", w.lead)).toBe(true);
      expect(await consume(c, w.lead, batch("lead")[0])).toBe(false);
      expect(await remaining(c, w.lead)).toBe(10);                                      // the valid code was not spent while locked
    });
  });

  it("is never readable by a browser session and never editable", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await issue(c, w.lead, batch("lead"));
      await c.client.query("savepoint s");
      let denied = false;
      try { await c.asUser(w.lead, () => c.q("select code_hash from mfa_recovery_codes")); } catch { denied = true; await c.client.query("rollback to savepoint s"); }
      expect(denied).toBe(true);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from mfa_recovery_codes"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update mfa_recovery_codes set code_hash = $1", [hash("x")]));
      await consume(c, w.lead, batch("lead")[0]);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update mfa_recovery_codes set used_at = null where used_at is not null"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update mfa_recovery_codes set revoked_at = now() where used_at is not null"));
    });
  });

  it("revoking cancels unused codes only, and ending sessions spares the one asked to be kept", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await issue(c, w.lead, batch("lead"));
      await consume(c, w.lead, batch("lead")[0]);
      await c.rpc("revoke_recovery_codes", w.lead);
      expect(await remaining(c, w.lead)).toBe(0);
      expect((await c.q<{ n: number }>("select count(*)::int n from mfa_recovery_codes where user_id = $1 and used_at is not null and revoked_at is null", [w.lead]))[0].n).toBe(1);   // the spent one stays "used"
      expect(await consume(c, w.lead, batch("lead")[1])).toBe(false);
      const keep = randomUUID(), gone = randomUUID();
      for (const id of [keep, gone]) await c.q("insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())", [id, w.lead]);
      await c.q("insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())", [randomUUID(), w.other]);
      expect(await c.rpc<number>("revoke_user_sessions", w.lead, keep)).toBe(1);
      expect((await c.q<{ id: string }>("select id from auth.sessions where user_id = $1", [w.lead])).map((r) => r.id)).toEqual([keep]);
      expect((await c.q<{ n: number }>("select count(*)::int n from auth.sessions where user_id = $1", [w.other]))[0].n).toBe(1);   // other accounts are untouched
      expect(await c.rpc<number>("revoke_user_sessions", w.lead, null)).toBe(1);
    });
  });

  it("break-glass is audited under its own action with the operator and reason, and alerts every Super Admin", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const bu = await c.bu("RC3");
      const sa1 = await c.user(["SUPER_ADMIN"], bu, "sa1");
      const sa2 = await c.user(["SUPER_ADMIN"], bu, "sa2");
      await issue(c, w.admin, batch("admin"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("record_break_glass", sa1, "Operator One, DevOps", "short"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("record_break_glass", sa1, " ", "Both Super Admins lost their devices"));
      await c.expectError("NOT_FOUND", () => c.rpc("record_break_glass", "11111111-1111-4111-8111-111111111111", "Operator One, DevOps", "Both Super Admins lost their devices"));
      await c.rpc("record_break_glass", sa1, "Operator One, DevOps", "Both Super Admins lost their devices");
      const a = (await c.q<{ actor_user_id: string | null; reason: string; new_values: { operator: string } }>("select actor_user_id, reason, new_values from audit_logs where action = 'AUTH_BREAK_GLASS_MFA_RESET'"))[0];
      expect([a.actor_user_id, a.reason, a.new_values.operator]).toEqual([null, "Both Super Admins lost their devices", "Operator One, DevOps"]);
      expect((await c.q<{ user_id: string }>("select user_id from notifications where event_type = 'BREAK_GLASS' order by user_id")).map((r) => r.user_id).sort()).toEqual([sa1, sa2].sort());
      await issue(c, w.admin, batch("again"));
      await c.rpc("record_break_glass", w.admin, "Operator One, DevOps", "Admin locked out after a lost phone");
      expect(await remaining(c, w.admin)).toBe(0);                                        // unused codes are cancelled with the reset
    });
  });
});

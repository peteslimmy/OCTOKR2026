import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function base(c: Ctx) {
  const bu = await c.bu("HQ");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  return { bu, admin, sa };
}

async function authId(c: Ctx): Promise<string> {
  const id = randomUUID();
  await c.q("insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())", [id, `${id.slice(0, 8)}@t.local`]);
  return id;
}

describe("privilege escalation guards (THREAT-007)", () => {
  it("an Admin cannot grant or remove ADMIN/SUPER_ADMIN; a SuperAdmin can; nobody can strip their own SuperAdmin role", async () => {
    await withTx(async (c) => {
      const w = await base(c);
      const id = await authId(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("provision_user", w.admin, id, "x1@t.local", "X", "One", w.bu, ["ADMIN"]));
      await c.rpc("provision_user", w.admin, id, "x1@t.local", "X", "One", w.bu, ["BU_LEAD", "HR"]);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_user_roles", w.admin, id, ["SUPER_ADMIN"]));
      await c.rpc("set_user_roles", w.sa, id, ["ADMIN"]);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_user_roles", w.admin, id, ["BU_LEAD"])); // cannot demote an Admin
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_user_status", w.admin, w.sa, "SUSPENDED"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_user_roles", w.sa, w.sa, ["ADMIN"]));
      const trail = (await c.q("select action from audit_logs where entity_id = $1 order by seq", [id])).map((r) => r.action);
      expect(trail).toEqual(["USER_CREATED", "USER_ROLES_CHANGED"]);
    });
  });

  it("an HR / BU Lead user cannot manage users or BUs", async () => {
    await withTx(async (c) => {
      const w = await base(c);
      const hr = await c.user(["HR", "BU_LEAD"], w.bu, "hr");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_business_unit", hr, "NEW", "New BU"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_employee", hr, "e@t.local", "E", "E", w.bu));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_integrity_penalty_rate", hr, 0.5));
    });
  });
});

describe("login throttling and bootstrap", () => {
  it("locks an account after 5 failures (generic, audited) and resets on success", async () => {
    await withTx(async (c) => {
      const w = await base(c);
      const lead = await c.user(["BU_LEAD"], w.bu, "lead");
      const email = (await c.q<{ email: string }>("select email from users where id = $1", [lead]))[0].email;
      for (let i = 0; i < 4; i++) expect(await c.rpc<boolean>("record_login_failure", email)).toBe(false);
      expect(await c.rpc<boolean>("login_lock_status", email)).toBe(false);
      expect(await c.rpc<boolean>("record_login_failure", email)).toBe(true);
      expect(await c.rpc<boolean>("login_lock_status", email)).toBe(true);
      await c.setNow(new Date(Date.now() + 16 * 60_000).toISOString());
      expect(await c.rpc<boolean>("login_lock_status", email)).toBe(false);
      await c.rpc("record_login_success", lead);
      expect((await c.q("select failed_attempts, locked_until from users where id = $1", [lead]))[0]).toEqual({ failed_attempts: 0, locked_until: null });
      expect((await c.q("select count(*)::int n from audit_logs where action in ('AUTH_LOGIN_FAILED','AUTH_ACCOUNT_LOCKED') and outcome = 'DENIED'"))[0].n).toBe(5);
      // unknown account: same shape, no error, no enumeration signal
      expect(await c.rpc<boolean>("record_login_failure", "nobody@t.local")).toBe(false);
    });
  });

  it("bootstrap refuses to run twice", async () => {
    await withTx(async (c) => {
      await base(c); // organisation already exists in this transaction
      const id = await authId(c);
      await c.expectError("ALREADY_BOOTSTRAPPED", () => c.rpc("bootstrap_organisation", "Org", "ORG", "HQ2", "HQ2", id, "boot@t.local", "B", "S"));
    });
  });
});

describe("read models run under the caller's RLS", () => {
  it("read_report_view returns derived goal status, SMART, sub-KR path and score preview; other BUs get nothing", async () => {
    await withTx(async (c) => {
      const w = await base(c);
      const buB = await c.bu("BRAVO");
      const lead = await c.user(["BU_LEAD"], w.bu, "lead");
      const other = await c.user(["BU_LEAD"], buB, "other");
      const strat = await seedStrategy(c, w.admin);
      await c.setNow(W1.open);
      const wk = await weekId(c);
      const { reportId } = await draftGoal(c, lead, wk, strat.subKrIds[1], ["a", "b"]);
      const mine = await c.asUser(lead, () => c.rpc<Record<string, unknown> | null>("read_report_view", reportId));
      expect(mine).toMatchObject({ phase: "OPEN", session_outcome: "SCHEDULED" });
      const goals = (mine as { goals: { status: string; sub_key_result: { code: string }; evaluation: { overall_score: string }; tasks: unknown[] }[] }).goals;
      expect(goals).toHaveLength(1);
      expect(goals[0]).toMatchObject({ status: "NOT_DONE", sub_key_result: { code: "KR2.1" } });
      expect(goals[0].tasks).toHaveLength(2);
      expect(Number(goals[0].evaluation.overall_score)).toBe(73);
      expect(await c.asUser(other, () => c.rpc("read_report_view", reportId))).toBeNull();
    });
  });

  it("read_active_weeks follows the database clock, never the browser's", async () => {
    await withTx(async (c) => {
      const w = await base(c);
      const lead = await c.user(["BU_LEAD"], w.bu, "lead");
      await seedStrategy(c, w.admin);
      await c.setNow("2031-01-08T09:00:00+01:00");
      const weeks = await c.asUser(lead, () => c.rpc<{ phase: string }[]>("read_active_weeks"));
      expect(weeks.map((x) => x.phase)).toEqual(["CONTENT_LOCKED"]); // week of 6 Jan is past content lock; 13 Jan not yet open
      await c.setNow("2031-01-13T09:00:00+01:00");
      const two = await c.asUser(lead, () => c.rpc<{ phase: string }[]>("read_active_weeks"));
      expect(two.map((x) => x.phase)).toEqual(["OPEN", "CONTENT_LOCKED"]);
    });
  });

  it("executive dashboard requires its permission and ranks BUs by quarterly score", async () => {
    await withTx(async (c) => {
      const w = await base(c);
      const lead = await c.user(["BU_LEAD"], w.bu, "lead");
      const exec = await c.user(["EXECUTIVE"], w.bu, "exec");
      const strat = await seedStrategy(c, w.admin);
      await c.expectError("PERMISSION_DENIED", () => c.asUser(lead, () => c.rpc("read_executive_dashboard", strat.quarterId)));
      const d = await c.asUser(exec, () => c.rpc<{ ranking: { name: string }[]; strategy: { key_results: unknown[] } }>("read_executive_dashboard", strat.quarterId));
      expect(d.ranking.length).toBeGreaterThanOrEqual(1);
      expect(d.strategy.key_results).toHaveLength(3);
    });
  });
});

describe("dev clock isolation", () => {
  it("app_now ignores app.dev_clock unless app.environment is 'development'", async () => {
    await withTx(async (c) => {
      await c.q("select set_config('app.dev_clock', '2040-01-01T00:00:00Z', true)");
      const now = (await c.q<{ n: string }>("select app_now()::text n"))[0].n;
      expect(now.startsWith("2040")).toBe(false);
      await c.q("select set_config('app.environment', 'development', true)");
      expect((await c.q<{ n: string }>("select app_now()::text n"))[0].n.startsWith("2040")).toBe(true);
    });
  });
});

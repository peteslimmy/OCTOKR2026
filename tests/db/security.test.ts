import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const finance = await c.bu("FINANCE");
  const hrBu = await c.bu("HR");
  const admin = await c.user(["ADMIN"], hrBu, "admin");
  const leadFin = await c.user(["BU_LEAD"], finance, "leadFin");
  const leadHr = await c.user(["BU_LEAD"], hrBu, "leadHr");
  const presenter = await c.user(["PRESENTER"], hrBu, "presenter");
  const exec = await c.user(["EXECUTIVE"], hrBu, "exec");
  const hr = await c.user(["HR"], hrBu, "hr");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  const hrReport = await draftGoal(c, leadHr, wk, strat.subKrIds[0]);
  return { finance, hrBu, admin, leadFin, leadHr, presenter, exec, hr, strat, wk, hrReport };
}

describe("RLS and privilege boundaries (SEC-RLS-001..005, AC-SEC-*)", () => {
  it("SEC-RLS-001/002: Finance BU Lead cannot read the HR BU report by UUID or by changing a BU filter", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const byId = await c.asUser(w.leadFin, () => c.q("select id from weekly_reports where id = $1", [w.hrReport.reportId]));
      expect(byId).toEqual([]);
      const byFilter = await c.asUser(w.leadFin, () => c.q("select id from smart_goals where business_unit_id = $1", [w.hrBu]));
      expect(byFilter).toEqual([]);
      const tasks = await c.asUser(w.leadFin, () => c.q("select id from tasks"));
      expect(tasks).toEqual([]);
      const evals = await c.asUser(w.leadFin, () => c.q("select id from smart_evaluations"));
      expect(evals).toEqual([]);
    });
  });

  it("SEC-RLS-003: authenticated users have no table INSERT/UPDATE/DELETE grants (all writes are service RPCs)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("permission denied", () => c.asUser(w.leadHr, () => c.q("update weekly_reports set version = 99")));
      await c.expectError("permission denied", () => c.asUser(w.leadHr, () => c.q("delete from smart_goals")));
      await c.expectError("permission denied", () => c.asUser(w.admin, () => c.q("insert into integrity_corrections (task_id) values (gen_random_uuid())")));
      await c.expectError("permission denied", () => c.asUser(w.admin, () => c.q("update annual_themes set theme = 'x'")));
    });
  });

  it("authenticated users cannot execute mutation RPCs directly, even with a valid actor id", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("permission denied", () => c.asUser(w.leadHr, () => c.rpc("execute_task", w.leadHr, w.hrReport.goalId, "DONE")));
      await c.expectError("permission denied", () => c.asUser(w.leadHr, () => c.rpc("write_audit", w.leadHr, "FORGED", "x", "1")));
      await c.expectError("permission denied", () => c.asUser(w.leadHr, () => c.rpc("finalize_reporting_week", w.wk)));
    });
  });

  it("SEC-RLS-004/005: Executive and Presenter read cross-BU data but cannot edit goal content", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const u of [w.exec, w.presenter]) {
        const seen = await c.asUser(u, () => c.q("select id from weekly_reports"));
        expect(seen).toHaveLength(1);
      }
      for (const u of [w.exec, w.presenter]) {
        await c.expectError("PERMISSION_DENIED", () => c.rpc("create_goal", u, w.hrReport.reportId, "STRETCH", null, "g", null, [{ description: "t" }], { overall: 1 }, null));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("delete_goal", u, w.hrReport.goalId, null));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("submit_weekly_report", u, w.hrReport.reportId, null, null));
      }
    });
  });

  it("AC-SEC-004: audit rows cannot be updated or deleted by anyone, including a superuser session", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update audit_logs set action = 'TAMPERED'"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from audit_logs"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("truncate audit_logs"));
      // audit read is permission-gated
      expect(await c.asUser(w.leadHr, () => c.q("select id from audit_logs"))).toEqual([]);
      expect((await c.asUser(w.admin, () => c.q("select id from audit_logs"))).length).toBeGreaterThan(0);
    });
  });

  it("users cannot see other users' notifications and cannot escalate roles through RLS-visible tables", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("notify_users", [w.leadHr], "T", null, null, "t", "m", "k");
      expect(await c.asUser(w.leadFin, () => c.q("select id from notifications"))).toEqual([]);
      expect(await c.asUser(w.leadHr, () => c.q("select id from notifications"))).toHaveLength(1);
      await c.expectError("permission denied", () => c.asUser(w.leadHr, () => c.q("insert into user_roles (user_id, role_id) select $1, id from roles where code = 'SUPER_ADMIN'", [w.leadHr])));
      const visibleUsers = await c.asUser(w.leadHr, () => c.q("select id from users"));
      expect(visibleUsers).toEqual([{ id: w.leadHr }]);
    });
  });

  it("a suspended user loses every permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("update users set status = 'SUSPENDED' where id = $1", [w.leadHr]);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("acquire_edit_lease", w.leadHr, w.hrReport.reportId, 300));
    });
  });
});

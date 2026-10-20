import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

interface CellRow {
  business_unit_id: string; bu_code: string; reports_weekly: boolean; tasks_total: number; tasks_done: number; tasks_not_done: number; tasks_undefined: number;
  goals_total: number; goals_done: number; final_score: string | null; compliance_status: string | null; submission_status: string; submitted_on_time: boolean | null;
}

/** ALPHA files one goal with one task and completes it; BRAVO files nothing; DEPT is a Department that does not report weekly. */
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const alpha = await c.bu("ALPHA"); const bravo = await c.bu("BRAVO");
  const dept = await c.bu("DEPT"); await c.q("update business_units set reports_weekly = false where id = $1", [dept]);
  const admin = await c.user(["ADMIN"], alpha, "admin"); const sa = await c.user(["SUPER_ADMIN"], alpha, "sa");
  const hr = await c.user(["HR"], alpha, "hr"); const exec = await c.user(["EXECUTIVE"], alpha, "exec");
  const leadA = await c.user(["BU_LEAD"], alpha, "leadA"); const leadB = await c.user(["BU_LEAD"], bravo, "leadB");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  const { reportId, goalId } = await draftGoal(c, leadA, wk, strat.subKrIds[0], ["task"], "Publish the pricing sheets by Friday");
  await c.rpc("submit_weekly_report", leadA, reportId, null, null);
  await c.setNow(W1.afterContentLock);
  const t = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1", [goalId]))[0].id;
  await c.rpc("execute_task", leadA, t, "DONE");
  await c.setNow(W1.finalLock);
  await c.rpc("finalize_reporting_week", wk);
  return { alpha, bravo, dept, admin, sa, hr, exec, leadA, leadB, quarterId: strat.quarterId };
}

describe("dashboard read model (ADR-074)", () => {
  it("gives one row per unit per week with tasks, score and compliance as the engine stored them", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.asUser(w.exec, () => c.rpc<CellRow[]>("read_dashboard_cells", w.quarterId));
      const byCode = (code: string) => rows.filter((r) => r.bu_code === code);
      const firstWeek = (code: string) => byCode(code).sort((a, b) => 0)[0];
      const alpha = rows.find((r) => r.bu_code === "ALPHA" && r.goals_total > 0)!;
      expect(alpha).toMatchObject({ reports_weekly: true, tasks_total: 1, tasks_done: 1, tasks_not_done: 0, goals_total: 1, goals_done: 1, submission_status: "SUBMITTED", compliance_status: "COMPLIANT" });
      expect(Number(alpha.final_score)).toBe(100);
      const bravo = rows.find((r) => r.bu_code === "BRAVO" && r.compliance_status === "NON_COMPLIANT")!;
      expect(bravo).toMatchObject({ tasks_total: 0, submission_status: "NOT_SUBMITTED" });
      expect(Number(bravo.final_score)).toBe(0);
      // a Department appears (so it can be listed) but carries no tasks and is never marked non-compliant
      expect(firstWeek("DEPT")).toMatchObject({ reports_weekly: false, tasks_total: 0, compliance_status: null });
      expect(byCode("DEPT").every((r) => r.compliance_status === null)).toBe(true);
    });
  });

  it("shows a Business Unit Lead only their own unit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.asUser(w.leadB, () => c.rpc<CellRow[]>("read_dashboard_cells", w.quarterId));
      expect(new Set(rows.map((r) => r.bu_code))).toEqual(new Set(["BRAVO"]));
    });
  });

  it("does not let a signed-out caller read it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("set local role anon");
      await expect(c.q("select read_dashboard_cells($1)", [w.quarterId])).rejects.toThrow();
    });
  });
});

describe("branding (ADR-074)", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("lets an Admin or Super Admin change the name, short mark and colour, and records it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("set_branding", w.admin, "Acme OKR", "A", "#0f4c81");
      const row = (await c.q<{ app_name: string; short_name: string; primary_color: string }>("select app_name, short_name, primary_color from app_branding"))[0];
      expect(row).toEqual({ app_name: "Acme OKR", short_name: "A", primary_color: "#0f4c81" });
      const audit = await c.q<{ old_values: { appName: string }; new_values: { appName: string } }>("select old_values, new_values from audit_logs where action = 'BRANDING_CHANGED' order by seq desc limit 1");
      expect(audit[0].old_values.appName).toBe("4CORE-OKR");
      expect(audit[0].new_values.appName).toBe("Acme OKR");
    });
  });

  it("refuses everyone without the branding permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const who of [w.hr, w.leadA, w.exec]) {
        await c.expectError("PERMISSION_DENIED", () => c.rpc("set_branding", who, "Hijacked", "H", "#000000"));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("set_branding_asset", who, "LOGO", "image/png", PNG));
        await c.expectError("PERMISSION_DENIED", () => c.rpc("clear_branding_asset", who, "LOGO"));
      }
    });
  });

  it("rejects a malformed colour or an over-long name", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_branding", w.admin, "Ok", "O", "red"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_branding", w.admin, "x".repeat(61), "O", "#000000"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_branding", w.admin, "Ok", "TOOLONG", "#000000"));
    });
  });

  it("stores a logo, bumps its version so caches refresh, and removes it again", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await c.rpc<number>("set_branding_asset", w.sa, "LOGO", "image/png", PNG)).toBe(1);
      expect(await c.rpc<number>("set_branding_asset", w.sa, "LOGO", "image/png", PNG)).toBe(2);
      expect((await c.q<{ logo_version: number }>("select logo_version from app_branding"))[0].logo_version).toBe(2);
      await c.rpc("clear_branding_asset", w.sa, "LOGO");
      expect((await c.q("select 1 from app_branding_assets where kind = 'LOGO'")).length).toBe(0);
      expect((await c.q<{ logo_version: number }>("select logo_version from app_branding"))[0].logo_version).toBe(0);
      // the image itself never goes into the audit trail, only its type and size
      const audit = await c.q<{ new_values: Record<string, unknown> }>("select new_values from audit_logs where action = 'BRANDING_ASSET_CHANGED' limit 1");
      expect(audit[0].new_values).toMatchObject({ kind: "LOGO", mime: "image/png" });
      expect(JSON.stringify(audit[0].new_values)).not.toContain(PNG);
    });
  });

  it("only accepts raster image types (no SVG)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await expect(c.rpc("set_branding_asset", w.sa, "LOGO", "image/svg+xml", PNG)).rejects.toThrow();
    });
  });

  it("is readable without signing in, so the sign-in page can show the name", async () => {
    await withTx(async (c) => {
      await c.q("set local role anon");
      expect((await c.q<{ app_name: string }>("select app_name from app_branding"))[0].app_name).toBe("4CORE-OKR");
    });
  });
});

describe("Business Units and Departments", () => {
  it("creates a Department when the unit is not required to report weekly", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await c.rpc<string>("create_business_unit", w.admin, "FACIL", "Facilities", false);
      expect((await c.q<{ reports_weekly: boolean }>("select reports_weekly from business_units where id = $1", [id]))[0].reports_weekly).toBe(false);
      const bu = await c.rpc<string>("create_business_unit", w.admin, "OPS", "Operations", true);
      expect((await c.q<{ reports_weekly: boolean }>("select reports_weekly from business_units where id = $1", [bu]))[0].reports_weekly).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("strategy hierarchy (BR-STR-*, AC-STR-*)", () => {
  it("enforces one Annual Theme per year and the SuperAdmin-only exceptional change with reason + history", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("HQ");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const id = await c.rpc<string>("create_annual_theme", sa, 2031, "Year of Reliability");
      await c.expectError("ANNUAL_THEME_EXISTS", () => c.rpc("create_annual_theme", sa, 2031, "Another"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("change_annual_theme", admin, id, "New", "why"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("change_annual_theme", sa, id, "New", "  "));
      await c.rpc("change_annual_theme", sa, id, "Year of Focus", "Board reprioritised");
      const hist = await c.q("select old_theme, new_theme, reason from annual_theme_changes where annual_theme_id = $1", [id]);
      expect(hist).toEqual([{ old_theme: "Year of Reliability", new_theme: "Year of Focus", reason: "Board reprioritised" }]);
      const audit = await c.q("select action from audit_logs where entity_id = $1 order by seq", [id]);
      expect(audit.map((a) => a.action)).toEqual(["ANNUAL_THEME_CREATED", "ANNUAL_THEME_CHANGED"]);
    });
  });

  it("a quarter cannot be activated with <3 KRs, >4 KRs, or a KR without a Sub-KR", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("HQ");
      const admin = await c.user(["ADMIN"], bu, "admin");
      await c.setNow("2030-12-01T09:00:00+01:00");
      await c.rpc("create_year_quarters", admin, 2031);
      const q = (await c.q<{ id: string }>("select id from quarters where year = 2031 and quarter_number = 1"))[0].id;
      await c.expectError("QUARTER_NOT_READY", () => c.rpc("activate_quarter", admin, q)); // no objective
      const obj = await c.rpc<string>("create_objective", admin, q, "Objective", null);
      await c.expectError("OBJECTIVE_EXISTS", () => c.rpc("create_objective", admin, q, "Second", null));
      const krs: string[] = [];
      for (let i = 1; i <= 2; i++) krs.push(await c.rpc<string>("create_key_result", admin, obj, `KR ${i}`, null));
      for (const k of krs) await c.rpc("create_sub_key_result", admin, k, "sub", null);
      await c.expectError("QUARTER_NOT_READY", () => c.rpc("activate_quarter", admin, q)); // 2 KRs
      krs.push(await c.rpc<string>("create_key_result", admin, obj, "KR 3", null));
      await c.expectError("QUARTER_NOT_READY", () => c.rpc("activate_quarter", admin, q)); // KR3 has no Sub-KR
      await c.rpc("create_sub_key_result", admin, krs[2], "sub", null);
      krs.push(await c.rpc<string>("create_key_result", admin, obj, "KR 4", null));
      await c.expectError("KR_LIMIT_EXCEEDED", () => c.rpc("create_key_result", admin, obj, "KR 5", null));
      await c.expectError("QUARTER_NOT_READY", () => c.rpc("activate_quarter", admin, q)); // KR4 has no Sub-KR
      await c.rpc("create_sub_key_result", admin, krs[3], "sub", null);
      await c.rpc("activate_quarter", admin, q);
      expect((await c.q("select status from quarters where id = $1", [q]))[0].status).toBe("ACTIVE");
      // activation materialises the fixed calendar: 13 Mondays in Q1 2031 (Jan 6 .. Mar 31)
      expect((await c.q("select count(*)::int n from reporting_weeks where quarter_id = $1", [q]))[0].n).toBe(13);
    });
  });

  it("past quarter becomes read-only when the next quarter starts, even before the job runs; rows are never deleted", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("HQ");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const q = await seedQ(c, admin);
      await c.setNow("2031-04-01T00:00:00+01:00"); // next quarter begins, job has NOT run
      await c.expectError("QUARTER_LOCKED", () => c.rpc("update_objective", admin, q.objectiveId, "Edited", null));
      await c.expectError("QUARTER_LOCKED", () => c.rpc("create_sub_key_result", admin, q.krIds[0], "late", null));
      await c.rpc("roll_quarters");
      expect((await c.q("select status from quarters where id = $1", [q.quarterId]))[0].status).toBe("LOCKED");
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from key_results where id = $1", [q.krIds[0]]));
    });
  });

  it("BU Lead cannot change strategy (explicit denial)", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("HQ");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_annual_theme", lead, 2031, "x"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_year_quarters", lead, 2031));
    });
  });
});

async function seedQ(c: Parameters<Parameters<typeof withTx>[0]>[0], admin: string) {
  const { seedStrategy } = await import("./helpers");
  return seedStrategy(c, admin);
}

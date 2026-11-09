import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("BASE");
  const root = await c.user(["SUPER_ADMIN"], bu, "root"); const admin = await c.user(["ADMIN"], bu, "admin"); const lead = await c.user(["BU_LEAD"], bu, "lead");
  return { bu, root, admin, lead };
}
const change = (c: Ctx, actor: string, id: string, type: string | null, reason: string | null = "Reorganisation") => c.rpc<Record<string, unknown>>("change_business_unit_type", actor, id, type, reason);
const row = async (c: Ctx, id: string) => (await c.q<{ unit_type: string; reports_weekly: boolean; status: string; parent_unit_id: string | null }>("select unit_type, reports_weekly, status, parent_unit_id from business_units where id = $1", [id]))[0];

describe("changing a unit between Business Unit and Department (ADR-114)", () => {
  it("only the Super Admin holds the permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const who = async (code: string) => (await c.q<{ code: string }>("select r.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where p.code = $1 order by 1", [code])).map((x) => x.code);
      expect(await who("business_units.change_type")).toEqual(["SUPER_ADMIN"]);
      await c.expectError("PERMISSION_DENIED", () => change(c, w.admin, w.bu, "DEPARTMENT"));
      await c.expectError("PERMISSION_DENIED", () => change(c, w.lead, w.bu, "DEPARTMENT"));
      expect((await row(c, w.bu)).unit_type).toBe("BUSINESS_UNIT");
    });
  });

  it("promotes and demotes in both directions, changing only the type, and audits each change with the reason", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = await row(c, w.bu);
      expect(await change(c, w.root, w.bu, "DEPARTMENT", "HR is a department")).toMatchObject({ from: "BUSINESS_UNIT", to: "DEPARTMENT" });
      expect(await row(c, w.bu)).toEqual({ ...before, unit_type: "DEPARTMENT" });
      expect(await change(c, w.root, w.bu, "BUSINESS_UNIT", "Now a full unit")).toMatchObject({ from: "DEPARTMENT", to: "BUSINESS_UNIT" });
      expect(await row(c, w.bu)).toEqual(before);
      const audit = await c.q<{ reason: string; old_values: { unit_type: string }; new_values: { unit_type: string }; actor_user_id: string }>(
        "select reason, old_values, new_values, actor_user_id from audit_logs where action = 'BU_TYPE_CHANGED' and entity_id = $1 order by occurred_at, id", [w.bu]);
      expect(audit.map((a) => [a.reason, a.old_values.unit_type, a.new_values.unit_type])).toEqual([["HR is a department", "BUSINESS_UNIT", "DEPARTMENT"], ["Now a full unit", "DEPARTMENT", "BUSINESS_UNIT"]]);
      expect(audit.every((a) => a.actor_user_id === w.root)).toBe(true);
    });
  });

  it("refuses a missing reason, an invalid or unchanged type and an unknown unit, writing nothing", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => change(c, w.root, w.bu, "DEPARTMENT", "  "));
      await c.expectError("VALIDATION_ERROR", () => change(c, w.root, w.bu, "DEPARTMENT", null));
      await c.expectError("VALIDATION_ERROR", () => change(c, w.root, w.bu, "DIVISION"));
      await c.expectError("VALIDATION_ERROR", () => change(c, w.root, w.bu, null));
      await c.expectError("VALIDATION_ERROR", () => change(c, w.root, w.bu, "BUSINESS_UNIT"));
      await c.expectError("NOT_FOUND", () => change(c, w.root, "11111111-1111-4111-8111-111111111111", "DEPARTMENT"));
      expect((await row(c, w.bu)).unit_type).toBe("BUSINESS_UNIT");
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'BU_TYPE_CHANGED'"))[0].n).toBe(0);
    });
  });

  it("leaves reporting, status, parent and children alone", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const child = await c.rpc<string>("create_business_unit", w.root, "KID", "Child", false, "DEPARTMENT", w.bu, null, null);
      expect(await change(c, w.root, w.bu, "DEPARTMENT")).toMatchObject({ childUnits: 1, reportsWeekly: true });
      expect(await row(c, child)).toMatchObject({ unit_type: "DEPARTMENT", reports_weekly: false, parent_unit_id: w.bu });
      expect(await row(c, w.bu)).toMatchObject({ reports_weekly: true, status: "ACTIVE" });
    });
  });

  it("the general unit update can no longer change the type for anyone without the permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("update_business_unit", w.admin, w.bu, "Base", "ACTIVE", true, "DEPARTMENT"));
      await c.rpc("update_business_unit", w.admin, w.bu, "Base renamed", "ACTIVE", true, "BUSINESS_UNIT");   // same type: still allowed
      await c.rpc("update_business_unit", w.root, w.bu, "Base renamed", "ACTIVE", true, "DEPARTMENT");
      expect((await row(c, w.bu)).unit_type).toBe("DEPARTMENT");
    });
  });
});

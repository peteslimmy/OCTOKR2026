import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("unit hierarchy", () => {
  it("creates a child unit with description and location, and reads them back", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const parent = await c.rpc<string>("create_business_unit", admin, "OPS", "Operations", true, "DEPARTMENT", null, "Runs things", "Lagos");
      const child = await c.rpc<string>("create_business_unit", admin, "OPS1", "Operations North", true, null, parent, null, null);
      const rows = await c.rpc<{ id: string; parent_unit_id: string | null; description: string | null; location: string | null }[]>("read_business_units");
      expect(rows.find((r) => r.id === parent)).toMatchObject({ parent_unit_id: null, description: "Runs things", location: "Lagos" });
      expect(rows.find((r) => r.id === child)).toMatchObject({ parent_unit_id: parent });
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_business_unit", admin, "BAD", "Bad", true, null, "00000000-0000-0000-0000-000000000000", null, null));
    });
  });

  it("refuses cycles and self-parenting", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const a = await c.rpc<string>("create_business_unit", admin, "UA", "Unit A", true, null, null, null, null);
      const b = await c.rpc<string>("create_business_unit", admin, "UB", "Unit B", true, null, a, null, null);
      const d = await c.rpc<string>("create_business_unit", admin, "UC", "Unit C", true, null, b, null, null);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("update_business_unit", admin, a, "Unit A", "ACTIVE", true, null, true, a, null, null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("update_business_unit", admin, a, "Unit A", "ACTIVE", true, null, true, d, null, null));
    });
  });

  it("update only touches the hierarchy when asked, and null then clears it", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      const p = await c.rpc<string>("create_business_unit", admin, "PP", "Parent", true, null, null, null, null);
      const u = await c.rpc<string>("create_business_unit", admin, "KK", "Kid", true, null, p, "desc", "loc");
      const get = async () => (await c.q<Record<string, unknown>>("select parent_unit_id, description, location, name from business_units where id = $1", [u]))[0];
      // a caller that does not know about the hierarchy (import, older approvals) leaves it alone
      await c.rpc("update_business_unit", admin, u, "Kid renamed", "ACTIVE", true);
      expect(await get()).toMatchObject({ name: "Kid renamed", parent_unit_id: p, description: "desc", location: "loc" });
      await c.expectError("PERMISSION_DENIED", () => c.rpc("update_business_unit", lead, u, "x", "ACTIVE", true, null, true, null, null, null));
      await c.rpc("update_business_unit", admin, u, "Kid renamed", "ACTIVE", true, null, true, null, null, null);
      expect(await get()).toMatchObject({ parent_unit_id: null, description: null, location: null });
      const audit = await c.q("select 1 from audit_logs where action = 'BU_UPDATED' and entity_id = $1", [u]);
      expect(audit.length).toBe(2);
    });
  });
});

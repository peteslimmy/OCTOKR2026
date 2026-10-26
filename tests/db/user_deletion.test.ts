import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("ALPHA");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const victim = await c.user(["BU_LEAD"], bu, "victim");
  return { bu, admin, sa, lead, victim };
}

describe("user deletion is audited with a reason (audit finding F-007)", () => {
  it("deletes the user and records who, why and what they held", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("delete_user", w.admin, w.victim, "  Left the organisation  ");
      expect(await c.q("select 1 from users where id = $1", [w.victim])).toEqual([]);
      const audit = await c.q<{ actor_user_id: string; reason: string; old_values: { roles: string[] } }>(
        "select actor_user_id, reason, old_values from audit_logs where action = 'USER_DELETED' and entity_id = $1", [w.victim]);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_user_id: w.admin, reason: "Left the organisation" });
      expect(audit[0].old_values.roles).toContain("BU_LEAD");
    });
  });

  it("refuses a missing or blank reason and changes nothing", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("delete_user", w.admin, w.victim));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("delete_user", w.admin, w.victim, "   "));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("delete_user", w.admin, w.victim, "x".repeat(2001)));
      expect(await c.q("select 1 from users where id = $1", [w.victim])).toHaveLength(1);
    });
  });

  it("needs users.manage, and refuses self-deletion and the last Super Admin", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("delete_user", w.lead, w.victim, "no right"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("delete_user", w.admin, w.admin, "myself"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("delete_user", w.admin, w.sa, "the only Super Admin"));
      expect(await c.q("select 1 from users where id in ($1, $2)", [w.admin, w.sa])).toHaveLength(2);
    });
  });
});

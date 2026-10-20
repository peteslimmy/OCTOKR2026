import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("refused attempts are audited (AC-OP-9)", () => {
  it("records who was refused, on which route and why, without identifiers or request content; repeats within a minute collapse", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AD");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      const other = await c.user(["BU_LEAD"], bu, "other");
      expect(await c.rpc<boolean>("record_access_denied", lead, "POST", "/api/v1/governance-sessions/:id/skip-okr", "PERMISSION_DENIED")).toBe(true);
      expect(await c.rpc<boolean>("record_access_denied", lead, "POST", "/api/v1/governance-sessions/:id/skip-okr", "PERMISSION_DENIED")).toBe(false);      // a repeat is collapsed
      expect(await c.rpc<boolean>("record_access_denied", lead, "POST", "/api/v1/admin/penalty-rate", "PERMISSION_DENIED")).toBe(true);                     // another route is not
      expect(await c.rpc<boolean>("record_access_denied", other, "POST", "/api/v1/governance-sessions/:id/skip-okr", "BU_SCOPE_DENIED")).toBe(true);        // another person is not
      const rows = await c.q<{ actor_user_id: string; entity_id: string; outcome: string; new_values: { method: string; code: string } }>("select actor_user_id, entity_id, outcome, new_values from audit_logs where action = 'ACCESS_DENIED' order by seq");
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ actor_user_id: lead, entity_id: "/api/v1/governance-sessions/:id/skip-okr", outcome: "DENIED", new_values: { method: "POST", code: "PERMISSION_DENIED" } });
    });
  });

  it("ignores calls with no person or no route, cuts very long routes, and is never callable from a browser session", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("AD2");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      expect(await c.rpc<boolean>("record_access_denied", null, "POST", "/x", "PERMISSION_DENIED")).toBe(false);
      expect(await c.rpc<boolean>("record_access_denied", lead, "POST", "", "PERMISSION_DENIED")).toBe(false);
      expect(await c.rpc<boolean>("record_access_denied", lead, "POST", "x".repeat(500), "PERMISSION_DENIED")).toBe(true);
      expect((await c.q<{ n: number }>("select length(entity_id)::int n from audit_logs where action = 'ACCESS_DENIED'"))[0].n).toBe(200);
      await c.client.query("savepoint s");
      let denied = false;
      try { await c.asUser(lead, () => c.rpc("record_access_denied", lead, "POST", "/x", "PERMISSION_DENIED")); } catch { denied = true; await c.client.query("rollback to savepoint s"); }
      expect(denied).toBe(true);                                                                                                                       // a person cannot write their own refusals or anyone else's
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("invitation audit (ADR-117)", () => {
  it("records the outcome of an invitation, for someone who manages users, and never anything else", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("INVBU");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      const person = await c.user(["BU_LEAD"], bu, "person");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_user_invitation", lead, person, "SENT"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_user_invitation", admin, person, "MAYBE"));
      await c.expectError("NOT_FOUND", () => c.rpc("record_user_invitation", admin, "11111111-1111-4111-8111-111111111111", "SENT"));
      for (const outcome of ["SENT", "NO_PROVIDER", "FAILED"]) await c.rpc("record_user_invitation", admin, person, outcome);
      const rows = await c.q<{ action: string }>("select action from audit_logs where entity_id = $1 and action like 'USER_INVITATION_%' order by occurred_at, id", [person]);
      expect(rows.map((r) => r.action).sort()).toEqual(["USER_INVITATION_FAILED", "USER_INVITATION_NO_PROVIDER", "USER_INVITATION_SENT"]);
    });
  });

  it("is closed to signed-in users: only the server can call it", async () => {
    await withTx(async (c) => {
      const [r] = await c.q<{ a: boolean; s: boolean }>("select has_function_privilege('authenticated', 'record_user_invitation(uuid,uuid,text)', 'execute') a, has_function_privilege('service_role', 'record_user_invitation(uuid,uuid,text)', 'execute') s");
      expect(r).toEqual({ a: false, s: true });
    });
  });
});

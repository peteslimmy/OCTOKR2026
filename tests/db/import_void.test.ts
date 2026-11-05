import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

// Rolling back employee and Business Unit imports (ADR-087). Nothing is deleted; created rows are deactivated, changed rows restored.
const SHA = "c".repeat(64);
let seq = 0; const key = () => `void-key-${Date.now()}-${++seq}`;
const at = (c: Ctx, iso: string) => c.q("select set_config('app.test_now', $1, true)", [iso]);

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("ALPHA"); const bu2 = await c.bu("BRAVO");
  const admin = await c.user(["ADMIN"], bu, "admin"); const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  await at(c, "2031-03-03T10:00:00Z");
  return { bu, bu2, admin, sa };
}
const row = (email: string, o: Record<string, string> = {}) => ({ email, firstName: "Pat", lastName: "Person", businessUnit: "ALPHA", status: "", ...o });
const importEmployees = (c: Ctx, actor: string, rows: unknown[], policy = "SKIP_EXISTING", sha = SHA) => c.rpc<{ batchId: string }>("commit_employee_import", actor, rows, policy, key(), "people.csv", sha);
const voidIt = (c: Ctx, actor: string, batch: string, reason = "Uploaded the wrong sheet by mistake", confirm = "VOID IMPORT") => c.rpc<{ restored: number; deactivated: number; replayed: boolean }>("void_import", actor, batch, reason, confirm, key());
const emp = async (c: Ctx, email: string) => (await c.q<{ first_name: string; business_unit_id: string; employment_status: string }>("select first_name, business_unit_id, employment_status from employees where email = $1", [email]))[0];

describe("rolling back an employee import", () => {
  it("deactivates the people it added and restores the ones it changed, keeps every record, and writes the void record and audit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await importEmployees(c, w.admin, [row("old@t.local", { firstName: "Olu" })], "SKIP_EXISTING", "d".repeat(64));
      const batch = await importEmployees(c, w.admin, [row("old@t.local", { firstName: "Changed", businessUnit: "BRAVO" }), row("new@t.local")], "UPDATE_EXISTING");
      expect(await emp(c, "old@t.local")).toMatchObject({ first_name: "Changed", business_unit_id: w.bu2 });
      const out = await voidIt(c, w.sa, batch.batchId);
      expect([out.restored, out.deactivated, out.replayed]).toEqual([1, 1, false]);
      expect(await emp(c, "old@t.local")).toEqual({ first_name: "Olu", business_unit_id: w.bu, employment_status: "ACTIVE" });
      expect((await emp(c, "new@t.local")).employment_status).toBe("INACTIVE");                                    // deactivated, not deleted
      expect((await c.q<{ n: number }>("select count(*)::int n from import_voids where batch_id = $1", [batch.batchId]))[0].n).toBe(1);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'IMPORT_VOIDED' and entity_id = $1", [batch.batchId]))[0].n).toBe(1);
      expect((await voidIt(c, w.sa, batch.batchId)).replayed).toBe(true);                              // idempotent
      const listed = (await c.rpc<{ id: string; voided_at: string | null; voidable: boolean }[]>("read_import_batches")).find((b) => b.id === batch.batchId)!;
      expect([listed.voided_at !== null, listed.voidable]).toEqual([true, false]);
    });
  });

  it("is for Super Admins only, needs the typed confirmation and a real reason", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const batch = await importEmployees(c, w.admin, [row("a@t.local")]);
      await c.expectError("PERMISSION_DENIED", () => voidIt(c, w.admin, batch.batchId));
      await c.expectError("VALIDATION_ERROR", () => voidIt(c, w.sa, batch.batchId, "Uploaded the wrong sheet by mistake", "yes"));
      await c.expectError("REASON_REQUIRED", () => voidIt(c, w.sa, batch.batchId, "oops"));
      expect((await emp(c, "a@t.local")).employment_status).toBe("ACTIVE");                                          // nothing happened
    });
  });

  it("is refused after the 72-hour window", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const batch = await importEmployees(c, w.admin, [row("a@t.local")]);
      await at(c, "2031-03-06T10:00:01Z");                                                                         // 72 h and one second later
      await c.expectError("IMPORT_VOID_WINDOW_CLOSED", () => voidIt(c, w.sa, batch.batchId));
      await at(c, "2031-03-06T09:59:59Z");                                                                         // still inside
      expect((await voidIt(c, w.sa, batch.batchId)).deactivated).toBe(1);
    });
  });

  it("is refused, listing why, when a record was changed since or the new person now has a sign-in", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const batch = await importEmployees(c, w.admin, [row("a@t.local"), row("b@t.local")]);
      await at(c, "2031-03-03T12:00:00Z");
      await c.q("update employees set last_name = 'Edited', updated_at = app_now() where email = 'a@t.local'");
      await c.expectError("IMPORT_VOID_BLOCKED", () => voidIt(c, w.sa, batch.batchId));
      expect((await emp(c, "b@t.local")).employment_status).toBe("ACTIVE");                                          // all or nothing
      expect((await c.q<{ n: number }>("select count(*)::int n from import_voids"))[0].n).toBe(0);
    });
  });
});

describe("rolling back a Business Unit import", () => {
  it("deactivates new units and restores changed ones; refuses when a new unit already has people", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await c.rpc<{ batchId: string }>("commit_business_unit_import", w.admin, [{ code: "NEWU", name: "New Unit", status: "", reportsWeekly: "" }, { code: "ALPHA", name: "Alpha Renamed", status: "", reportsWeekly: "" }],
        "UPDATE_EXISTING", key(), "units.csv", "e".repeat(64));
      const undone = await voidIt(c, w.sa, first.batchId);
      expect([undone.restored, undone.deactivated]).toEqual([1, 1]);
      expect((await c.q<{ status: string }>("select status from business_units where code = 'NEWU'"))[0].status).toBe("INACTIVE");
      expect((await c.q<{ name: string }>("select name from business_units where id = $1", [w.bu]))[0].name).not.toBe("Alpha Renamed");

      const second = await c.rpc<{ batchId: string }>("commit_business_unit_import", w.admin, [{ code: "BUSY", name: "Busy Unit", status: "", reportsWeekly: "" }], "SKIP_EXISTING", key(), "units2.csv", "f".repeat(64));
      const busy = (await c.q<{ id: string }>("select id from business_units where code = 'BUSY'"))[0].id;
      await c.q("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'x@t.local', 'X', 'Y', $2)", [c.org, busy]);
      await c.expectError("IMPORT_VOID_BLOCKED", () => voidIt(c, w.sa, second.batchId));
    });
  });
});

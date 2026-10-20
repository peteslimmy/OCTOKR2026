import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

const SHA = "a".repeat(64);
interface Out { batchId: string; rowCount: number; created: number; updated: number; unchanged: number; skipped: number; replayed: boolean; rows: { row: number; email: string; outcome: string; detail: string | null }[] }
const r = (code: string, o: Record<string, string> = {}) => ({ code, name: `Unit ${code}`, reportsWeekly: "", status: "", ...o });

async function world(c: Ctx) {
  const bu = await c.bu("BASE");
  const admin = await c.user(["ADMIN"], bu, "admin"); const hr = await c.user(["HR"], bu, "hr"); const lead = await c.user(["BU_LEAD"], bu, "lead");
  return { admin, hr, lead };
}
const commit = (c: Ctx, actor: string, rows: unknown[], policy = "SKIP_EXISTING", key = "bu-key-0001", sha = SHA) =>
  c.rpc<Out>("commit_business_unit_import", actor, rows, policy, key, "units.csv", sha);
const count = async (c: Ctx) => (await c.q<{ n: number }>("select count(*)::int n from business_units"))[0].n;

describe("Business Unit import commit", () => {
  it("creates units with reporting and status, records the batch and audits every unit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = await count(c);
      const out = await commit(c, w.admin, [r("ops"), r("fin", { reportsWeekly: "No", status: "inactive" })]);
      expect([out.created, out.updated, out.skipped, out.replayed]).toEqual([2, 0, 0, false]);
      expect(await count(c)).toBe(before + 2);
      expect((await c.q("select code, status, reports_weekly from business_units where code in ('OPS','FIN') order by code"))).toEqual([
        { code: "FIN", status: "INACTIVE", reports_weekly: false }, { code: "OPS", status: "ACTIVE", reports_weekly: true }]);
      expect((await c.q<{ item_key: string; business_unit_id: string }>("select item_key, business_unit_id from import_batch_rows where batch_id = $1 order by row_number", [out.batchId])).map((x) => x.item_key)).toEqual(["OPS", "FIN"]);
      expect((await c.q<{ action: string }>("select action from audit_logs where entity_type = 'import_batch' and entity_id = $1", [out.batchId])).map((a) => a.action)).toEqual(["BUSINESS_UNIT_IMPORT_COMMITTED"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'BU_CREATED'"))[0].n).toBe(2);
    });
  });

  it("a unit is a Business Unit or a Department independently of reporting; empty follows the flag; anything else is refused", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await commit(c, w.admin, [r("hre", { unitType: "Department" }), r("ops", { unitType: "Business Unit", reportsWeekly: "No" }), r("auto1"), r("auto2", { reportsWeekly: "No" })]);
      expect(await c.q("select code, unit_type, reports_weekly from business_units where code in ('HRE','OPS','AUTO1','AUTO2') order by code")).toEqual([
        { code: "AUTO1", unit_type: "BUSINESS_UNIT", reports_weekly: true }, { code: "AUTO2", unit_type: "DEPARTMENT", reports_weekly: false },
        { code: "HRE", unit_type: "DEPARTMENT", reports_weekly: true }, { code: "OPS", unit_type: "BUSINESS_UNIT", reports_weekly: false }]);
      await c.expectError("IMPORT_INVALID", () => commit(c, w.admin, [r("bad", { unitType: "Division" })], "SKIP_EXISTING", "bu-key-type1", "d".repeat(64)));
    });
  });

  it("applies the three conflict policies", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await commit(c, w.admin, [r("ops", { name: "Operations" })], "SKIP_EXISTING", "bu-key-seed1");
      const skip = await commit(c, w.admin, [r("OPS", { name: "Changed" }), r("new")], "SKIP_EXISTING", "bu-key-skip1", "b".repeat(64));
      expect([skip.created, skip.skipped]).toEqual([1, 1]);
      expect((await c.q<{ name: string }>("select name from business_units where code = 'OPS'"))[0].name).toBe("Operations");
      const upd = await commit(c, w.admin, [r("ops", { name: "Operations 2", reportsWeekly: "no" }), r("new")], "UPDATE_EXISTING", "bu-key-upd01", "c".repeat(64));
      expect([upd.updated, upd.unchanged, upd.created]).toEqual([1, 1, 0]);
      expect(upd.rows.find((x) => x.email === "OPS")?.detail).toBe("name, weekly reporting changed");
      const before = await count(c);
      await c.expectError("IMPORT_INVALID", () => commit(c, w.admin, [r("brandnew"), r("ops")], "ABORT_ON_CONFLICT", "bu-key-abort", "d".repeat(64)));
      expect(await count(c)).toBe(before);
    });
  });

  it("is all-or-nothing and reports every problem", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = await count(c);
      let detail = "";
      try {
        await c.client.query("savepoint s");
        await commit(c, w.admin, [r("ok1"), r("x"), r("ok2", { name: "=bad" }), r("ok3", { reportsWeekly: "maybe" }), r("ok4", { status: "paused" }), r("ok1")]);
      } catch (e) { detail = String((e as { detail?: string }).detail ?? ""); await c.client.query("rollback to savepoint s"); }
      const problems = JSON.parse(detail) as { row: number; code: string }[];
      expect(problems.map((p) => `${p.row}:${p.code}`).sort()).toEqual(["2:INVALID_CODE", "3:INVALID_TEXT", "4:INVALID_FLAG", "5:INVALID_STATUS", "6:DUPLICATE_IN_FILE"]);
      expect(await count(c)).toBe(before);
    });
  });

  it("is idempotent per key and refuses the key for another file, policy or entity", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await commit(c, w.admin, [r("idem")], "SKIP_EXISTING", "bu-key-idem1");
      const again = await commit(c, w.admin, [r("idem")], "SKIP_EXISTING", "bu-key-idem1");
      expect(again).toMatchObject({ replayed: true, batchId: first.batchId });
      expect((await c.q<{ n: number }>("select count(*)::int n from business_units where code = 'IDEM'"))[0].n).toBe(1);
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => commit(c, w.admin, [r("idem")], "SKIP_EXISTING", "bu-key-idem1", "e".repeat(64)));
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => c.rpc("commit_employee_import", w.admin, [{ email: "a@t.local", firstName: "A", lastName: "B", businessUnit: "BASE", status: "" }], "SKIP_EXISTING", "bu-key-idem1", "units.csv", SHA));
    });
  });

  it("needs business_units.manage; people and reports are untouched; history visible to managers only", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => commit(c, w.hr, [r("a1")]));
      await c.expectError("PERMISSION_DENIED", () => commit(c, w.lead, [r("a1")]));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, []));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, [r("a1")], "WIPE"));
      const people = (await c.q<{ n: number }>("select count(*)::int n from employees"))[0].n;
      const out = await commit(c, w.admin, [r("a1")]);
      expect((await c.q<{ n: number }>("select count(*)::int n from employees"))[0].n).toBe(people);
      const seen = (u: string) => c.asUser(u, async () => (await c.q<{ n: number }>("select count(*)::int n from import_batches"))[0].n);
      expect(await seen(w.admin)).toBe(1);
      expect(await seen(w.hr)).toBe(0);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update import_batch_rows set detail = 'x' where batch_id = $1", [out.batchId]));
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
interface Out { batchId: string; rowCount: number; created: number; updated: number; unchanged: number; skipped: number; replayed: boolean; rows: { row: number; email: string; outcome: string; detail: string | null }[] }
const r = (email: string, o: Record<string, string> = {}) => ({ email, firstName: "Pat", lastName: "Person", businessUnit: "ALPHA", status: "", ...o });

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"); const buB = await c.bu("BRAVO");
  const dead = await c.bu("DEAD"); await c.q("update business_units set status = 'INACTIVE' where id = $1", [dead]);
  const admin = await c.user(["ADMIN"], buA, "admin"); const hr = await c.user(["HR"], buA, "hr"); const lead = await c.user(["BU_LEAD"], buA, "lead");
  return { buA, buB, admin, hr, lead };
}
const commit = (c: Ctx, actor: string, rows: unknown[], policy = "SKIP_EXISTING", key = "key-0000001", sha = SHA, file = "people.csv") =>
  c.rpc<Out>("commit_employee_import", actor, rows, policy, key, file, sha);
const count = async (c: Ctx, where = "true") => (await c.q<{ n: number }>(`select count(*)::int n from employees where ${where}`))[0].n;

describe("employee import commit", () => {
  it("creates people, resolving the Business Unit by code or name, recording a batch, its rows and an audit entry", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = await count(c);
      const out = await commit(c, w.admin, [r("one@t.local"), r("two@t.local", { businessUnit: "bu bravo", status: "inactive" })]);
      expect([out.created, out.updated, out.unchanged, out.skipped, out.replayed]).toEqual([2, 0, 0, 0, false]);
      expect(await count(c)).toBe(before + 2);
      const two = (await c.q<{ business_unit_id: string; employment_status: string }>("select business_unit_id, employment_status from employees where email = 'two@t.local'"))[0];
      expect(two).toEqual({ business_unit_id: w.buB, employment_status: "INACTIVE" });
      expect((await c.q<{ n: number }>("select count(*)::int n from import_batch_rows where batch_id = $1", [out.batchId]))[0].n).toBe(2);
      const audit = await c.q<{ action: string }>("select action from audit_logs where entity_type = 'import_batch' and entity_id = $1", [out.batchId]);
      expect(audit.map((a) => a.action)).toEqual(["EMPLOYEE_IMPORT_COMMITTED"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'EMPLOYEE_CREATED'"))[0].n).toBe(2);   // each person has their own audit entry too
    });
  });

  it("applies the three conflict policies", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await commit(c, w.admin, [r("ada@t.local", { firstName: "Ada" })], "SKIP_EXISTING", "key-seed-001");
      const skip = await commit(c, w.admin, [r("ada@t.local", { firstName: "Changed" }), r("new@t.local")], "SKIP_EXISTING", "key-skip-001", SHA2);
      expect([skip.created, skip.skipped]).toEqual([1, 1]);
      expect((await c.q<{ first_name: string }>("select first_name from employees where email = 'ada@t.local'"))[0].first_name).toBe("Ada");

      const upd = await commit(c, w.admin, [r("ada@t.local", { firstName: "Changed", businessUnit: "BRAVO" }), r("new@t.local")], "UPDATE_EXISTING", "key-upd-0001", "c".repeat(64));
      expect([upd.updated, upd.unchanged, upd.created]).toEqual([1, 1, 0]);
      expect(upd.rows.find((x) => x.email === "ada@t.local")?.detail).toBe("name, business unit changed");
      const ada = (await c.q<{ first_name: string; business_unit_id: string }>("select first_name, business_unit_id from employees where email = 'ada@t.local'"))[0];
      expect(ada).toEqual({ first_name: "Changed", business_unit_id: w.buB });
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'EMPLOYEE_UPDATED'"))[0].n).toBe(1);

      const before = await count(c);
      await c.expectError("IMPORT_INVALID", () => commit(c, w.admin, [r("brand-new@t.local"), r("ada@t.local")], "ABORT_ON_CONFLICT", "key-abort-01", "d".repeat(64)));
      expect(await count(c)).toBe(before);                                                    // the new person was not added either
    });
  });

  it("is all-or-nothing: one bad row stops the whole import and reports every problem", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = await count(c);
      let detail = "";
      try {
        await c.client.query("savepoint s");
        await commit(c, w.admin, [r("ok@t.local"), r("not-an-email"), r("x@t.local", { businessUnit: "NOPE" }), r("y@t.local", { businessUnit: "DEAD" }), r("z@t.local", { firstName: "=cmd()" }), r("ok@t.local")]);
      } catch (e) { detail = String((e as { detail?: string }).detail ?? (e as Error).message); await c.client.query("rollback to savepoint s"); }
      const problems = JSON.parse(detail) as { row: number; code: string }[];
      expect(problems.map((p) => `${p.row}:${p.code}`).sort()).toEqual(["2:INVALID_EMAIL", "3:UNKNOWN_BU", "4:UNKNOWN_BU", "5:INVALID_TEXT", "6:DUPLICATE_IN_FILE"]);
      expect(await count(c)).toBe(before);
      expect((await c.q<{ n: number }>("select count(*)::int n from import_batches"))[0].n).toBe(0);
    });
  });

  it("is idempotent: the same key returns the first result, never imports twice, and a different file or policy under that key is refused", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await commit(c, w.admin, [r("idem@t.local")], "SKIP_EXISTING", "key-idem-001");
      const again = await commit(c, w.admin, [r("idem@t.local")], "SKIP_EXISTING", "key-idem-001");
      expect(first.replayed).toBe(false);
      expect(again).toMatchObject({ replayed: true, batchId: first.batchId, created: 1 });
      expect(await count(c, "email = 'idem@t.local'")).toBe(1);
      expect((await c.q<{ n: number }>("select count(*)::int n from import_batches"))[0].n).toBe(1);
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => commit(c, w.admin, [r("idem@t.local")], "SKIP_EXISTING", "key-idem-001", SHA2));
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => commit(c, w.admin, [r("idem@t.local")], "UPDATE_EXISTING", "key-idem-001"));
    });
  });

  it("needs users.manage, valid arguments and a bounded size; roles and login accounts are never touched", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => commit(c, w.hr, [r("a@t.local")]));
      await c.expectError("PERMISSION_DENIED", () => commit(c, w.lead, [r("a@t.local")]));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, [r("a@t.local")], "DROP_TABLE"));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, [r("a@t.local")], "SKIP_EXISTING", "short"));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, [r("a@t.local")], "SKIP_EXISTING", "key-valid-01", "not-a-hash"));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, []));
      await c.expectError("VALIDATION_ERROR", () => commit(c, w.admin, Array.from({ length: 2001 }, (_, i) => r(`u${i}@t.local`))));
      const users = (await c.q<{ n: number }>("select count(*)::int n from users"))[0].n;
      const roles = (await c.q<{ n: number }>("select count(*)::int n from user_roles"))[0].n;
      await commit(c, w.admin, [r("plain@t.local")]);
      expect([(await c.q<{ n: number }>("select count(*)::int n from users"))[0].n, (await c.q<{ n: number }>("select count(*)::int n from user_roles"))[0].n]).toEqual([users, roles]);
    });
  });

  it("keeps imported history immutable and readable only by people who manage users", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const out = await commit(c, w.admin, [r("hist@t.local")]);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update import_batches set file_name = 'x' where id = $1", [out.batchId]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from import_batch_rows where batch_id = $1", [out.batchId]));
      const seen = async (u: string) => c.asUser(u, async () => (await c.q<{ n: number }>("select count(*)::int n from import_batches"))[0].n);
      expect(await seen(w.admin)).toBe(1);
      expect(await seen(w.hr)).toBe(0);
      expect(await seen(w.lead)).toBe(0);
      await c.client.query("savepoint ins");
      let denied = false;                                                                  // users have no write grant at all: imports go through the function only
      try {
        await c.asUser(w.admin, () => c.q("insert into import_batches (entity, file_name, file_sha256, idempotency_key, policy, row_count, created_count, updated_count, unchanged_count, skipped_count, result, actor_user_id) values ('EMPLOYEES','x', $1, 'k', 'SKIP_EXISTING', 1,0,0,0,0,'{}', $2)", [SHA, w.admin]));
      } catch { denied = true; await c.client.query("rollback to savepoint ins"); }
      expect(denied).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx } from "./helpers";

describe("the Super Admin holds every permission", () => {
  it("no permission is missing from the Super Admin role", async () => {
    await withTx(async (c) => {
      const missing = await c.q<{ code: string }>("select p.code from permissions p where not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id where r.code = 'SUPER_ADMIN' and rp.permission_id = p.id) order by 1");
      expect(missing.map((m) => m.code)).toEqual([]);
    });
  });

  it("a permission added later is granted to the Super Admin automatically", async () => {
    await withTx(async (c) => {
      await c.q("insert into permissions (code, description, module, risk) values ('test.future_permission', 'added by a later migration', 'Administration', 'low')");
      const rows = await c.q("select 1 from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where r.code = 'SUPER_ADMIN' and p.code = 'test.future_permission'");
      expect(rows.length).toBe(1);
    });
  });
});

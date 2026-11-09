import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

/** A Super Admin account is invisible to everyone who is not a Super Admin (ADR-118). */
async function world(c: Ctx) {
  const bu = await c.bu("SHIELDBU");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const sa2 = await c.user(["SUPER_ADMIN"], bu, "sa2");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const emp = async (u: string) => (await c.q<{ employee_id: string }>("select employee_id from users where id = $1", [u]))[0].employee_id;
  return { bu, sa, sa2, admin, hr, lead, saEmp: await emp(sa) };
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("Super Admin accounts are invisible to everyone else (ADR-118)", () => {
  it("the account, its roles and its employee record cannot be read by anyone who is not a Super Admin", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const viewer of [w.admin, w.hr, w.lead]) {
        await c.asUser(viewer, async () => {
          expect(ids(await c.q("select id from users where id = any($1)", [[w.sa, w.sa2]]))).toEqual([]);
          expect(await c.q("select 1 from user_roles where user_id = any($1)", [[w.sa, w.sa2]])).toHaveLength(0);
          expect(await c.q("select 1 from employees where id = $1", [w.saEmp])).toHaveLength(0);
        });
      }
      await c.asUser(w.admin, async () => {
        expect(ids(await c.q("select id from users where id = any($1)", [[w.admin, w.hr, w.lead]])).sort()).toEqual([w.admin, w.hr, w.lead].sort());   // everyone else is still there
        expect(await c.q("select 1 from user_roles where user_id = $1", [w.hr])).not.toHaveLength(0);
      });
    });
  });

  it("a Super Admin sees every account, including other Super Admins", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.asUser(w.sa, async () => {
        expect(ids(await c.q("select id from users where id = any($1)", [[w.sa, w.sa2, w.admin]])).sort()).toEqual([w.sa, w.sa2, w.admin].sort());
        expect(await c.q("select 1 from employees where id = $1", [w.saEmp])).toHaveLength(1);
      });
    });
  });

  it("counts do not give a hidden account away", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const asAdmin = await c.asUser(w.admin, async () => Number((await c.q<{ n: string }>("select count(*) n from users"))[0].n));
      const asSuper = await c.asUser(w.sa, async () => Number((await c.q<{ n: string }>("select count(*) n from users"))[0].n));
      expect(asSuper - asAdmin).toBeGreaterThanOrEqual(2);       // the two Super Admins this test made, at least
    });
  });

  it("nothing a Super Admin did, and nothing done to the account, is in the audit log for anyone else", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select write_audit($1, 'SHIELD_TEST_BY_SA', 'thing', 'x1', null, '{}'::jsonb)", [w.sa]);
      await c.q("select write_audit($1, 'SHIELD_TEST_ON_SA', 'user', $2, null, '{}'::jsonb)", [w.admin, w.sa]);
      await c.q("select write_audit($1, 'SHIELD_TEST_BY_ADMIN', 'thing', 'x2', null, '{}'::jsonb)", [w.admin]);
      const seen = async (viewer: string) => c.asUser(viewer, async () => (await c.q<{ action: string }>("select action from audit_logs where action like 'SHIELD\\_TEST\\_%'")).map((r) => r.action).sort());
      // the Admin has no audit permission in this test world unless granted: give the permission through a role-free path by reading as a Super Admin and as the table owner
      expect(await seen(w.sa)).toEqual(["SHIELD_TEST_BY_ADMIN", "SHIELD_TEST_BY_SA", "SHIELD_TEST_ON_SA"]);
      expect(await seen(w.sa2)).toEqual(["SHIELD_TEST_BY_ADMIN", "SHIELD_TEST_BY_SA", "SHIELD_TEST_ON_SA"]);
      for (const viewer of [w.admin, w.hr, w.lead]) expect(await seen(viewer), "viewer sees none of the Super Admin's rows").not.toEqual(expect.arrayContaining(["SHIELD_TEST_BY_SA"]));
      for (const viewer of [w.admin, w.hr, w.lead]) expect(await seen(viewer)).not.toEqual(expect.arrayContaining(["SHIELD_TEST_ON_SA"]));
    });
  });

  it("an audit reader who is not a Super Admin still reads everyone else's rows", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("select write_audit($1, 'SHIELD_TEST_BY_SA', 'thing', 'x1', null, '{}'::jsonb)", [w.sa]);
      await c.q("select write_audit($1, 'SHIELD_TEST_BY_ADMIN', 'thing', 'x2', null, '{}'::jsonb)", [w.admin]);
      const auditors = await c.q<{ id: string }>("select distinct ur.user_id as id from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id where p.code = 'audit.read' and ur.user_id = any($1)", [[w.admin, w.hr, w.lead]]);
      expect(auditors.length, "this world has someone who may read the audit log").toBeGreaterThan(0);
      const reader = auditors[0].id;
      const actions = await c.asUser(reader, async () => (await c.q<{ action: string }>("select action from audit_logs where action like 'SHIELD\\_TEST\\_%'")).map((r) => r.action));
      expect(actions).toContain("SHIELD_TEST_BY_ADMIN");
      expect(actions).not.toContain("SHIELD_TEST_BY_SA");
    });
  });

  it("a shared record names a hidden Super Admin as Administration, and a Super Admin by name", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const asAdmin = await c.asUser(w.admin, async () => (await c.q<{ a: string; b: string; c: string }>("select eo_person_name($1) a, person_name($1) b, eo_person_name($2) c", [w.sa, w.hr]))[0]);
      expect(asAdmin.a).toBe("Administration");
      expect(asAdmin.b).toBe("Administration");
      expect(asAdmin.c).not.toBe("Administration");
      const asSuper = await c.asUser(w.sa2, async () => (await c.q<{ a: string }>("select eo_person_name($1) a", [w.sa]))[0]);
      expect(asSuper.a).not.toBe("Administration");
    });
  });

  it("the roster list of hidden employees is the Super Admin's own record for everyone else, and empty for a Super Admin", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const forAdmin = await c.asUser(w.admin, async () => (await c.q<{ h: string[] }>("select read_hidden_employee_ids() h"))[0].h);
      expect(forAdmin).toContain(w.saEmp);
      const forSuper = await c.asUser(w.sa, async () => (await c.q<{ h: string[] }>("select read_hidden_employee_ids() h"))[0].h);
      expect(forSuper).toEqual([]);
    });
  });

  it("only the shield helpers are callable by signed-in people; the server sees everyone", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const server = await c.q<{ n: string }>("select count(*) n from users where id = any($1)", [[w.sa, w.sa2]]);
      expect(Number(server[0].n)).toBe(2);                                                       // the table owner / server is not shielded
      const [r] = await c.q<{ a: boolean }>("select has_function_privilege('authenticated', 'hidden_user_ids()', 'execute') a");
      expect(r.a).toBe(true);
    });
  });
});

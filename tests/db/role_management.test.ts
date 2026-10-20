import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("RM");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const admin2 = await c.user(["ADMIN"], bu, "admin2");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const sa2 = await c.user(["SUPER_ADMIN"], bu, "sa2");
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const plain = await c.user(["DIRECTOR"], bu, "plain");
  return { bu, admin, admin2, sa, sa2, hr, lead, plain };
}
let seq = 0;
const key = () => `rm-key-${Date.now()}-${++seq}`;
interface Res { request_id: string; status: string; replayed: boolean; protected?: boolean }
const ask = (c: Ctx, actor: string, target: string | null, proposed: unknown, reason = "Management decision") =>
  c.rpc<Res>("request_config_change", actor, "ROLE_CHANGE", target, JSON.stringify(proposed), reason, key());
const decide = (c: Ctx, actor: string, id: string, d = "APPROVE", comment: string | null = null) => c.rpc<Res>("decide_config_change", actor, id, d, comment, key());
const create = (code: string, permissions: string[], extra: Record<string, unknown> = {}) => ({ action: "CREATE", code, name: `Role ${code}`, description: "created in a test", permissions, requiresMfa: false, ...extra });
const roleId = async (c: Ctx, code: string) => (await c.q<{ id: string }>("select id from roles where code = $1", [code]))[0]?.id;
const permsOf = async (c: Ctx, code: string) => (await c.q<{ code: string }>("select p.code from roles r join role_permissions rp on rp.role_id = r.id join permissions p on p.id = rp.permission_id where r.code = $1 order by 1", [code])).map((r) => r.code);
const has = async (c: Ctx, user: string, perm: string) => (await c.q<{ ok: boolean }>("select actor_has_permission($1, $2) as ok", [user, perm]))[0].ok;
const update = (name: string, permissions: string[], requiresMfa = false) => ({ action: "UPDATE", name, description: null, permissions, requiresMfa });

describe("roles are data and are changed through approval (ADR-069)", () => {
  it("the eight shipped roles keep exactly the approved permissions", async () => {
    await withTx(async (c) => {
      const expected = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "role-matrix.json"), "utf8")) as Record<string, string[]>;
      for (const [role, perms] of Object.entries(expected)) expect(await permsOf(c, role), role).toEqual(perms);
      expect((await c.q<{ n: number }>("select count(*)::int n from roles where is_system"))[0].n).toBe(8);
    });
  });

  it("Admin asks for a new role; nothing exists until a different person approves; then people can hold it and gain exactly its permissions", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.admin, "COACH", create("COACH", ["reports.view", "strategy.annual_theme.view"]));
      expect(r).toMatchObject({ status: "PENDING", protected: false });
      expect(await roleId(c, "COACH")).toBeUndefined();
      await c.expectError("CONFIG_CHANGE_SELF_APPROVAL", () => decide(c, w.admin, r.request_id));
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.hr, r.request_id));
      expect(await decide(c, w.admin2, r.request_id)).toMatchObject({ status: "APPLIED" });
      expect(await permsOf(c, "COACH")).toEqual(["reports.view", "strategy.annual_theme.view"]);
      await c.rpc("set_user_roles", w.admin, w.plain, ["COACH"]);
      expect(await has(c, w.plain, "reports.view")).toBe(true);
      expect(await has(c, w.plain, "reports.export")).toBe(false);
      const audit = await c.q<{ action: string }>("select action from audit_logs where action in ('ROLE_CREATED','CONFIG_CHANGE_APPLIED') order by seq");
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ROLE_CREATED", "CONFIG_CHANGE_APPLIED"]));
    });
  });

  it("is validated when asked, so a bad request never reaches an approver", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.hr, "X1", create("X1", ["reports.view"])));                         // HR may not ask for roles
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "bad code", create("bad code", ["reports.view"])));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "ADMIN", create("ADMIN", ["reports.view"])));              // already exists
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "NOPERM", create("NOPERM", ["no.such.permission"])));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "NONAME", create("NONAME", ["reports.view"], { name: " " })));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "BADACT", { action: "RENAME", code: "BADACT", name: "x", permissions: [] }));
      expect((await c.q("select 1 from config_change_requests")).length).toBe(0);
      expect(await roleId(c, "NOPERM")).toBeUndefined();
    });
  });

  it("rule 1: nobody can put a permission on a role that they do not hold themselves", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.admin, "ESC1", create("ESC1", ["ledger.reversal.emergency"])));       // Super Admin only
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.admin, "ESC2", create("ESC2", ["disbursement.approve"])));             // Finance only
      await c.expectError("ROLE_RESERVED", () => ask(c, w.sa, "ESC3", create("ESC3", ["ledger.reversal.emergency"])));                // reserved: only on a role that can manage roles
      expect((await ask(c, w.sa, "ESC4", create("ESC4", ["ledger.reversal.emergency", "roles.manage"]))).status).toBe("PENDING");   // Super Admin holds both
      const finance = await roleId(c, "FINANCE");
      await c.expectError("PERMISSION_DENIED", async () => ask(c, w.admin, finance, update("Finance", [...(await permsOf(c, "FINANCE")), "audit.read", "ledger.reversal.emergency"])));
    });
  });

  it("rule 2: changes to protected permissions or the authenticator requirement need a Super Admin to approve", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const plainReq = await ask(c, w.admin, "HELPER", create("HELPER", ["reports.view"]));
      expect(plainReq.protected).toBe(false);
      await decide(c, w.admin2, plainReq.request_id);                                                                             // an Admin may approve ordinary changes

      const prot = await ask(c, w.admin, "BOSS", create("BOSS", ["users.manage"]));                                              // Admin holds users.manage, which is protected
      expect(prot.protected).toBe(true);
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.admin2, prot.request_id));
      expect(await roleId(c, "BOSS")).toBeUndefined();
      expect(await decide(c, w.sa, prot.request_id)).toMatchObject({ status: "APPLIED" });
      expect(await roleId(c, "BOSS")).toBeTruthy();

      const helper = await roleId(c, "HELPER");
      const mfa = await ask(c, w.admin, helper, update("Role HELPER", ["reports.view"], true));                                    // only the authenticator requirement changes
      expect(mfa.protected).toBe(true);
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.admin2, mfa.request_id));
      await decide(c, w.sa, mfa.request_id);
      await c.rpc("set_user_roles", w.admin, w.plain, ["HELPER"]);
      expect((await c.q<{ r: boolean }>("select user_requires_mfa($1) r", [w.plain]))[0].r).toBe(true);

      const rename = await ask(c, w.admin, helper, update("Helpers (renamed)", ["reports.view"], true));
      expect(rename.protected).toBe(false);                                                                                       // a rename alone is ordinary
    });
  });

  it("a role that can administer people cannot be handed out by someone who cannot manage roles", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.admin, "BOSS2", create("BOSS2", ["users.manage"]));
      await decide(c, w.sa, r.request_id);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_user_roles", w.admin, w.plain, ["BOSS2"]));                        // Admin lacks roles.manage
      await c.rpc("set_user_roles", w.sa, w.plain, ["BOSS2"]);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("authorise_mfa_reset", w.admin2, w.sa, "lost phone"));                 // the Super Admin rule now follows the permission, not the name
    });
  });

  it("rule 3: a change cannot add a conflicting combination; combinations that already exist are left alone", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const hrRole = await roleId(c, "HR");
      await c.expectError("ROLE_CONFLICT", async () => ask(c, w.sa, hrRole, update("Human Resources", [...(await permsOf(c, "HR")), "attendance.amendment.approve"])));
      await c.expectError("ROLE_CONFLICT", async () => ask(c, w.admin, hrRole, update("Human Resources", [...(await permsOf(c, "HR")), "attendance.amendment.approve"])));   // an Admin holds it too
      const fin = await roleId(c, "FINANCE");                                                                                     // FINANCE already requests and approves ledger reversals
      const ok = await ask(c, w.sa, fin, { action: "UPDATE", name: "Finance and Treasury", description: null, permissions: await permsOf(c, "FINANCE"), requiresMfa: true });
      expect(await decide(c, w.sa2, ok.request_id)).toMatchObject({ status: "APPLIED" });
    });
  });

  it("rule 4: people are moved when a role is deleted, and the last holder of a critical permission can never be removed", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const made = await ask(c, w.admin, "TEMP1", create("TEMP1", ["reports.view"]));
      await decide(c, w.admin2, made.request_id);
      await c.rpc("set_user_roles", w.admin, w.plain, ["TEMP1"]);
      const temp = await roleId(c, "TEMP1");
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, temp, { action: "DELETE" }));                                // someone holds it: say where they go
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, temp, { action: "DELETE", moveTo: "TEMP1" }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, temp, { action: "DELETE", moveTo: "NO_SUCH" }));
      const del = await ask(c, w.admin, temp, { action: "DELETE", moveTo: "DIRECTOR" });
      expect(del.protected).toBe(false);
      await decide(c, w.admin2, del.request_id);
      expect(await roleId(c, "TEMP1")).toBeUndefined();
      expect((await c.q<{ roles: string[] }>("select actor_role_codes($1) roles", [w.plain]))[0].roles).toEqual(["DIRECTOR"]);

      const sarole = await roleId(c, "SUPER_ADMIN");                                                                              // the shipped roles can be deleted too, but not into a lock-out
      await c.expectError("ROLE_LOCKOUT", () => ask(c, w.sa, sarole, { action: "DELETE", moveTo: "ADMIN" }));
      await c.expectError("ROLE_RESERVED", async () => ask(c, w.sa, sarole, { action: "UPDATE", name: "Super Admin", description: null, permissions: (await permsOf(c, "SUPER_ADMIN")).filter((p) => p !== "roles.manage"), requiresMfa: true }));
      const keep = await ask(c, w.sa, "ROLE_KEEPER", create("ROLE_KEEPER", ["roles.manage", "config.protected.approve", "users.manage"]));
      await decide(c, w.sa2, keep.request_id);
      await c.rpc("set_user_roles", w.sa, w.admin2, ["ROLE_KEEPER"]);
      const gone = await ask(c, w.sa, sarole, { action: "DELETE", moveTo: "ROLE_KEEPER" });                                       // someone else still holds the critical permissions
      expect(gone.protected).toBe(true);
      await decide(c, w.sa2, gone.request_id);
      expect(await roleId(c, "SUPER_ADMIN")).toBeUndefined();
      expect(await has(c, w.sa, "roles.manage")).toBe(true);                                                                      // moved, not lost
    });
  });

  it("rule 5: every change is audited with the permissions before and after, and the people who manage roles are told", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const made = await ask(c, w.admin, "AUD1", create("AUD1", ["reports.view"]));
      await decide(c, w.admin2, made.request_id);
      const id = await roleId(c, "AUD1");
      const up = await ask(c, w.admin, id, update("Role AUD1", ["reports.view", "reports.export"]));
      await decide(c, w.admin2, up.request_id);
      const row = (await c.q<{ old_values: { permissions: string[] }; new_values: { added: string[] } }>("select old_values, new_values from audit_logs where action = 'ROLE_UPDATED' order by seq desc limit 1"))[0];
      expect(row.old_values.permissions).toEqual(["reports.view"]);
      expect(row.new_values.added).toEqual(["reports.export"]);
      for (const u of [w.sa, w.sa2]) expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'ROLE_CHANGED'", [u])).length, "alerted").toBeGreaterThanOrEqual(1);
    });
  });

  it("no logic depends on a role's name: a new role with the permission to submit reports is a report owner", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const holder = await c.user(["BU_LEAD"], w.bu, "holder");
      expect(await c.rpc<string[]>("bu_lead_ids", w.bu)).toContain(holder);
      expect(await c.rpc<string[]>("bu_lead_ids", w.bu)).not.toContain(w.plain);
      await c.q("insert into user_permission_grants (user_id, permission_id, granted_by) select $1, id, $2 from permissions where code = 'weekly_report.submit'", [w.plain, w.sa]);
      expect(await c.rpc<string[]>("bu_lead_ids", w.bu)).toContain(w.plain);                                                      // a person holding the permission is found, whatever role gave it
      const n = (await c.q<{ n: number }>("select cardinality(users_with_permission('weekly_report.submit')) n"))[0].n;
      expect(n).toBeGreaterThanOrEqual(3);
    });
  });

  it("the roles screen can read roles and permissions, and nobody can call the change functions from a browser session", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const roles = await c.asUser(w.lead, async () => (await c.rpc<{ code: string; members: number; privileged: boolean; permissions: string[] }[]>("read_roles")));
      const sa = roles.find((r) => r.code === "SUPER_ADMIN")!;
      expect(sa.privileged).toBe(true);
      expect(roles.find((r) => r.code === "HR")!.privileged).toBe(false);
      expect(sa.permissions).toContain("roles.manage");
      const perms = await c.asUser(w.lead, async () => (await c.rpc<{ code: string; protected: boolean }[]>("read_permissions")));
      expect(perms.find((p) => p.code === "users.manage")!.protected).toBe(true);
      await c.client.query("savepoint s3");
      let denied = false;
      try { await c.asUser(w.admin, () => c.rpc("apply_role_change", { id: null })); } catch { denied = true; await c.client.query("rollback to savepoint s3"); }
      expect(denied).toBe(true);
    });
  });

  it("the first person set up gets the role that manages roles, even if its name is not SUPER_ADMIN", async () => {
    await withTx(async (c) => {
      const id = await c.user([], await c.bu("BS"), "first");                                                                    // an auth account to set up
      await c.q("delete from user_roles"); await c.q("delete from users"); await c.q("delete from employees"); await c.q("delete from business_units"); await c.q("delete from organisations");
      await c.q("update roles set code = 'OWNER_ROLE', name = 'Owner' where code = 'SUPER_ADMIN'");
      await c.rpc("bootstrap_organisation", "Acme", "ACME", "HQ", "Head Office", id, "first@acme.test", "First", "Person");
      expect((await c.q<{ roles: string[] }>("select actor_role_codes($1) roles", [id]))[0].roles).toEqual(["OWNER_ROLE"]);
    });
  });
});

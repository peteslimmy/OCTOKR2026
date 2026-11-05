import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("RA" + Math.random().toString(36).slice(2, 5));
  const buB = await c.bu("RB" + Math.random().toString(36).slice(2, 5));
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa");
  const sa2 = await c.user(["SUPER_ADMIN"], buA, "sa2");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const hr = await c.user(["HR"], buA, "hr");
  const lead = await c.user(["BU_LEAD"], buA, "lead");
  const empA = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, $2, 'Ada', 'A', $3) returning id", [c.org, `a-${Math.random()}@t.local`, buA]))[0].id;
  const empB = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, $2, 'Bo', 'B', $3) returning id", [c.org, `b-${Math.random()}@t.local`, buB]))[0].id;
  return { buA, buB, sa, sa2, admin, hr, lead, empA, empB };
}
let seq = 0;
const key = () => `ra-${Date.now()}-${++seq}`;
const has = async (c: Ctx, user: string, perm: string) => (await c.q<{ ok: boolean }>("select actor_has_permission($1, $2) as ok", [user, perm]))[0].ok;

describe("every permission has a module and a risk", () => {
  it("classifies all permissions, and protected or reserved ones are critical", async () => {
    await withTx(async (c) => {
      expect((await c.q<{ n: number }>("select count(*)::int n from permissions where module is null or risk is null"))[0].n).toBe(0);
      expect((await c.q<{ n: number }>("select count(*)::int n from permissions where (protected or reserved) and risk <> 'critical'"))[0].n).toBe(0);
      const listed = await c.rpc<{ code: string; module: string; risk: string }[]>("read_permissions");
      expect(listed.length).toBeGreaterThan(60);
      expect(listed.every((p) => p.module && p.risk)).toBe(true);
      expect(listed.find((p) => p.code === "violation.create")?.module).toBe("Violations");
    });
  });
});

describe("direct grants", () => {
  it("need roles.manage, a reason, a sensible expiry, and refuse reserved permissions and permissions already held through a role", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const soon = new Date(Date.now() + 7 * 864e5).toISOString();
      await c.expectError("PERMISSION_DENIED", () => c.rpc("grant_user_permission", w.admin, w.lead, "violation.create", true, "cover", soon));
      await c.expectError("REASON_REQUIRED", () => c.rpc("grant_user_permission", w.sa, w.lead, "violation.create", true, null, soon));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("grant_user_permission", w.sa, w.lead, "roles.manage", true, "no", null));             // reserved: only through a role
      await c.expectError("VALIDATION_ERROR", () => c.rpc("grant_user_permission", w.sa, w.lead, "violation.create", true, "cover", new Date(Date.now() - 864e5).toISOString()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("grant_user_permission", w.sa, w.lead, "violation.create", true, "cover", new Date(Date.now() + 400 * 864e5).toISOString()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("grant_user_permission", w.sa, w.hr, "violation.create", true, "already has it", null));    // HR holds it through the role
      await c.expectError("NOT_FOUND", () => c.rpc("grant_user_permission", w.sa, w.lead, "no.such.permission", true, "x", null));
    });
  });

  it("give the permission at once, are audited, can be removed, and an expired grant stops counting", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await has(c, w.lead, "violation.create")).toBe(false);
      await c.rpc("grant_user_permission", w.sa, w.lead, "violation.create", true, "covering for HR this month", new Date(Date.now() + 7 * 864e5).toISOString());
      expect(await has(c, w.lead, "violation.create")).toBe(true);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'PERMISSION_GRANTED' and entity_id = $1", [w.lead]))[0].n).toBe(1);
      // eight days later the grant has expired and no longer counts
      await c.setNow(new Date(Date.now() + 8 * 864e5).toISOString());
      expect(await has(c, w.lead, "violation.create")).toBe(false);
      await c.setNow(new Date().toISOString());
      expect(await has(c, w.lead, "violation.create")).toBe(true);
      await c.rpc("grant_user_permission", w.sa, w.lead, "violation.create", false, null, null);
      expect(await has(c, w.lead, "violation.create")).toBe(false);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'PERMISSION_GRANT_REMOVED' and entity_id = $1", [w.lead]))[0].n).toBe(1);
    });
  });

  it("can never create a conflict of duties", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("grant_user_permission", w.sa, w.lead, "disbursement.create", true, "needs to ask for funds", null);
      await c.expectError("SEPARATION_OF_DUTIES", () => c.rpc("grant_user_permission", w.sa, w.lead, "disbursement.approve", true, "and approve", null));
      await c.expectError("SEPARATION_OF_DUTIES", () => c.rpc("grant_user_permission", w.sa, w.hr, "disbursement.disburse", true, "and pay", null));   // HR already asks for funds
      expect(await has(c, w.lead, "disbursement.approve")).toBe(false);
    });
  });
});

describe("unit scope", () => {
  const vt = (c: Ctx, who: string) => c.rpc<string>("create_violation_type", who, `T${Math.random().toString(36).slice(2, 6).toUpperCase()}`, "Late", "LOW", 1000);

  it("leaves a person unrestricted until a scope is set, and only a person who manages roles can set one", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const type = await vt(c, w.hr);
      expect((await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.empB, null, type, null, null, null, key())).violation_id).toBeTruthy();
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_user_unit_scope", w.admin, w.hr, [w.buA], "limit"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("set_user_unit_scope", w.sa, w.hr, [w.buA], null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_user_unit_scope", w.sa, w.hr, ["00000000-0000-0000-0000-000000000000"], "bad unit"));
    });
  });

  it("limits the violation work to the chosen units, and removing the limit restores it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const type = await vt(c, w.hr);
      const own = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.empA, null, type, null, null, null, key());
      const other = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.empB, null, type, null, null, null, key());
      await c.rpc("set_user_unit_scope", w.sa, w.hr, [w.buA], "HR officer for unit A only");
      // inside the scope: everything works
      await c.rpc("create_violation", w.hr, w.empA, null, type, null, null, null, key());
      await c.rpc("update_violation", w.hr, own.violation_id, 1200, "agreed", null);
      // outside the scope: every violation action is refused
      await c.expectError("UNIT_SCOPE_DENIED", () => c.rpc("create_violation", w.hr, w.empB, null, type, null, null, null, key()));
      await c.expectError("UNIT_SCOPE_DENIED", () => c.rpc("update_violation", w.hr, other.violation_id, 1200, "agreed", null));
      await c.expectError("UNIT_SCOPE_DENIED", () => c.rpc("record_violation_payment", w.hr, other.violation_id, "PAYMENT", `REF-${key()}`, "2031-01-14", key()));
      await c.expectError("UNIT_SCOPE_DENIED", () => c.rpc("void_violation", w.hr, other.violation_id, "contested"));
      // a different person without a scope is unaffected
      const hr2 = await c.user(["HR"], w.buA, "hr2");
      await c.rpc("create_violation", hr2, w.empB, null, type, null, null, null, key());
      // widening, then removing the limit
      await c.rpc("set_user_unit_scope", w.sa, w.hr, [w.buA, w.buB], "now covers B too");
      await c.rpc("create_violation", w.hr, w.empB, null, type, null, null, null, key());
      await c.rpc("set_user_unit_scope", w.sa, w.hr, [], "limit removed");
      expect((await c.q<{ n: number }>("select count(*)::int n from user_unit_scopes where user_id = $1", [w.hr]))[0].n).toBe(0);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'USER_UNIT_SCOPE_CHANGED' and entity_id = $1", [w.hr]))[0].n).toBe(3);
    });
  });

  it("is checked by every violation and attendance function that acts on a unit or a person", async () => {
    await withTx(async (c) => {
      const fns = ["create_violation", "update_violation", "record_violation_payment", "void_violation", "set_attendance_status", "submit_attendance_amendment"];
      for (const f of fns) {
        const src = (await c.q<{ s: string }>("select prosrc s from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [f]))[0]?.s ?? "";
        expect(src, `${f} must call assert_unit_scope`).toContain("assert_unit_scope");
      }
    });
  });
});

describe("access reviews", () => {
  it("open on request by a person who manages roles, with a line for every active person, and only one at a time", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("open_access_review", w.admin, null));
      const id = await c.rpc<string>("open_access_review", w.sa, "quarterly");
      const items = await c.q<{ user_id: string; snapshot: { roles: string[]; permissions: number } }>("select user_id, snapshot from access_review_items where review_id = $1", [id]);
      expect(items.length).toBe((await c.q<{ n: number }>("select count(*)::int n from users where status = 'ACTIVE'"))[0].n);
      expect(items.find((i) => i.user_id === w.hr)?.snapshot.roles).toEqual(["HR"]);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("open_access_review", w.sa, null));
    });
  });

  it("need a decision on every person; nobody decides their own access; a change needs a note", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await c.rpc<string>("open_access_review", w.sa, null);
      await c.expectError("SELF_REVIEW", () => c.rpc("decide_access_review_item", w.sa, id, w.sa, "KEEP", null));
      await c.expectError("REASON_REQUIRED", () => c.rpc("decide_access_review_item", w.sa, id, w.hr, "CHANGE", null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("decide_access_review_item", w.sa, id, w.hr, "MAYBE", null));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_access_review_item", w.admin, id, w.hr, "KEEP", null));
      await c.rpc("decide_access_review_item", w.sa, id, w.hr, "KEEP", null);
      await c.rpc("decide_access_review_item", w.sa, id, w.lead, "CHANGE", "should not hold this role any more");
      await c.expectError("ACCESS_REVIEW_INCOMPLETE", () => c.rpc("sign_off_access_review", w.sa, id, "I reviewed everybody carefully"));
    });
  });

  it("are signed off with a statement, summarised, and then never change", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("update users set status = 'SUSPENDED' where id not in ($1, $2, $3)", [w.sa, w.hr, w.lead]);
      const id = await c.rpc<string>("open_access_review", w.sa, null);
      await c.rpc("decide_access_review_item", w.sa, id, w.hr, "KEEP", null);
      await c.rpc("decide_access_review_item", w.sa, id, w.lead, "CHANGE", "role no longer needed");
      await c.expectError("VALIDATION_ERROR", () => c.rpc("sign_off_access_review", w.sa, id, "ok"));
      const sum = await c.rpc<{ people: number; keep: number; change: number; self: number }>("sign_off_access_review", w.sa, id, "I reviewed each person's roles, grants and unit limits");
      expect(sum).toEqual({ people: 3, keep: 1, change: 1, self: 1 });
      expect((await c.q<{ decision: string }>("select decision from access_review_items where review_id = $1 and user_id = $2", [id, w.sa]))[0].decision).toBe("SELF");   // the signer's own line is not reviewed by the signer
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update access_review_items set decision = 'KEEP' where review_id = $1", [id]));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_access_review_item", w.sa, id, w.hr, "KEEP", null));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("sign_off_access_review", w.sa, id, "signing a second time"));
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'ACCESS_REVIEW_SIGNED_OFF' and entity_id = $1", [id]))[0].n).toBe(1);
      // a new one can open once the last is signed off
      await c.rpc("open_access_review", w.sa, null);
    });
  });

  it("open by themselves on schedule, and not while one is open or before they are due", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_access_review_schedule", w.admin, true, 3));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_access_review_schedule", w.sa, true, 0));
      await c.rpc("set_access_review_schedule", w.sa, false, 3);
      expect(await c.rpc<boolean>("run_access_review_schedule")).toBe(false);                    // switched off
      await c.rpc("set_access_review_schedule", w.sa, true, 3);
      expect(await c.rpc<boolean>("run_access_review_schedule")).toBe(true);                     // none yet: one opens
      expect(await c.rpc<boolean>("run_access_review_schedule")).toBe(false);                    // one is open
      const open = (await c.q<{ id: string }>("select id from access_reviews where status = 'OPEN'"))[0].id;
      expect((await c.q<{ opened_by: string | null }>("select opened_by from access_reviews where id = $1", [open]))[0].opened_by).toBeNull();
      await c.q("update access_review_items set decision = 'KEEP', decided_by = $2, decided_at = now() where review_id = $1 and user_id <> $2", [open, w.sa]);
      await c.rpc("sign_off_access_review", w.sa, open, "signed off in a test of the schedule");
      expect(await c.rpc<boolean>("run_access_review_schedule")).toBe(false);                    // signed off just now: not due for three months
      await c.setNow(new Date(Date.now() + 100 * 864e5).toISOString());
      expect(await c.rpc<boolean>("run_access_review_schedule")).toBe(true);                     // due again
    });
  });
});

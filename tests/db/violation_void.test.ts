import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("VV" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr"); const admin = await c.user(["ADMIN"], bu, "admin");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'vv1@t.local', 'Vee', 'Void', $2) returning id", [c.org, bu]))[0].id;
  const vt = await c.rpc<string>("create_violation_type", hr, "LATE", "Late to session", "MEDIUM", 5000);
  return { bu, hr, admin, lead, staff, vt };
}
let seq = 0; const key = () => `vv-${Date.now()}-${++seq}`;
const raise = async (c: Ctx, w: Awaited<ReturnType<typeof world>>) => (await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, 5000, "agreed fine", null, key())).violation_id;
const row = async (c: Ctx, v: string) => (await c.q<{ status: string; void_reason: string | null }>("select status, void_reason from violations where id = $1", [v]))[0];
const bal = async (c: Ctx) => Number((await c.q<{ b: string }>("select fund_balance((select id from violation_funds limit 1)) b"))[0].b);

describe("a contested violation that is cleared is void", () => {
  it("is voided by someone other than the reporter, with a reason, and never reaches the fund", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v = await raise(c, w);
      await c.expectError("VIOLATION_SELF_VOID", () => c.rpc("void_violation", w.hr, v, "Staff contested and won"));      // two sets of eyes
      await c.expectError("PERMISSION_DENIED", () => c.rpc("void_violation", w.lead, v, "x"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("void_violation", w.admin, v, "   "));
      await c.rpc("void_violation", w.admin, v, "Staff contested and the session record proved attendance");
      expect(await row(c, v)).toEqual({ status: "VOID", void_reason: "Staff contested and the session record proved attendance" });
      // it can no longer be paid, edited or voided again, and the fund is untouched
      await c.expectError("VIOLATION_ALREADY_SETTLED", () => c.rpc("record_violation_payment", w.hr, v, "PAYMENT", "BANK-9", "2031-01-14", key()));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("void_violation", w.admin, v, "again"));
      expect(await bal(c)).toBe(0);
      // the list shows it as void, with the reason and the person's email
      const shown = (await c.asUser(w.hr, () => c.rpc<{ id: string; status: string; void_reason: string; employee_email: string }[]>("read_violations"))).find((x) => x.id === v)!;
      expect([shown.status, shown.employee_email]).toEqual(["VOID", "vv1@t.local"]);
      expect(shown.void_reason).toContain("attendance");
      const audit = await c.q<{ action: string }>("select action from audit_logs where entity_id = $1 and action = 'VIOLATION_VOIDED'", [v]);
      expect(audit.length).toBe(1);
    });
  });

  it("cannot void a violation that has been paid until the payment is reversed", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v = await raise(c, w);
      await c.rpc("record_violation_payment", w.hr, v, "PAYMENT", "BANK-1", "2031-01-14", key());
      await c.expectError("VIOLATION_ALREADY_SETTLED", () => c.rpc("void_violation", w.admin, v, "contested later"));
      expect(await bal(c)).toBe(5000);
    });
  });

});

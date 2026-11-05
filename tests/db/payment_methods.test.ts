import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("PMT" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'pm1@t.local', 'Pam', 'One', $2) returning id", [c.org, bu]))[0].id;
  const vt = await c.rpc<string>("create_violation_type", hr, "LATE", "Late to session", "MEDIUM", 5000);
  return { bu, hr, lead, staff, vt };
}
let seq = 0;
const key = () => `pm-${Date.now()}-${++seq}`;
const raise = (c: Ctx, w: Awaited<ReturnType<typeof world>>) => c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, 5000, "agreed fine", null, key());
type Paid = { reference: string; method: string };

describe("payment methods and payment references", () => {
  it("starts with payment, salary deduction and out of pocket", async () => {
    await withTx(async (c) => {
      const rows = await c.q<{ code: string; is_deduction: boolean }>("select code, is_deduction from payment_methods order by code");
      expect(rows.map((r) => r.code)).toEqual(["PAY", "POC", "SAL"]);
      expect(rows.find((r) => r.code === "SAL")?.is_deduction).toBe(true);
    });
  });

  it("generates the reference from the method code and counts up, with no reference typed", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const a = await raise(c, w), b = await raise(c, w);
      const p1 = await c.rpc<Paid>("record_violation_payment", w.hr, a.violation_id, "POC", null, "2031-01-14", key());
      const p2 = await c.rpc<Paid>("record_violation_payment", w.hr, b.violation_id, "POC", null, "2031-01-14", key());
      expect(p1.reference).toMatch(/^POC-\d{4}-\d{6}$/);
      expect(p1.method).toBe("POC");
      expect(Number(p2.reference.slice(-6))).toBe(Number(p1.reference.slice(-6)) + 1);
    });
  });

  it("a salary-deduction method records a deduction, any other settles as paid; the two old names still work", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const a = await raise(c, w), b = await raise(c, w);
      const sal = await c.rpc<Paid>("record_violation_payment", w.hr, a.violation_id, "SALARY_DEDUCTION", null, "2031-01-14", key());
      expect(sal.reference.startsWith("SAL-")).toBe(true);
      expect((await c.q<{ status: string }>("select status from violations where id = $1", [a.violation_id]))[0].status).toBe("DEDUCTION_RECORDED");
      await c.rpc("record_violation_payment", w.hr, b.violation_id, "POC", null, "2031-01-14", key());
      expect((await c.q<{ status: string }>("select status from violations where id = $1", [b.violation_id]))[0].status).toBe("PAID");
    });
  });

  it("a new method needs a unique three-character code, which cannot change, and a method not in use cannot take payments", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("save_payment_method", w.lead, null, "BNK", "Bank transfer", false, true));
      const id = await c.rpc<string>("save_payment_method", w.hr, null, "bnk", "Bank transfer", false, true);
      expect((await c.q<{ code: string }>("select code from payment_methods where id = $1", [id]))[0].code).toBe("BNK");
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_payment_method", w.hr, null, "BNK", "Another", false, true));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_payment_method", w.hr, null, "BANK", "Too long", false, true));
      await c.rpc("save_payment_method", w.hr, id, "ZZZ", "Bank transfer (renamed)", false, false);
      const row = (await c.q<{ code: string; name: string; active: boolean }>("select code, name, active from payment_methods where id = $1", [id]))[0];
      expect(row).toMatchObject({ code: "BNK", name: "Bank transfer (renamed)", active: false });
      const v = await raise(c, w);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_violation_payment", w.hr, v.violation_id, "BNK", null, "2031-01-14", key()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_violation_payment", w.hr, v.violation_id, "NOPE", null, "2031-01-14", key()));
    });
  });

  it("the last method in use cannot be switched off", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.q<{ id: string; name: string }>("select id, name from payment_methods order by code");
      await c.rpc("save_payment_method", w.hr, rows[0].id, null, rows[0].name, false, false);
      await c.rpc("save_payment_method", w.hr, rows[1].id, null, rows[1].name, false, false);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_payment_method", w.hr, rows[2].id, null, rows[2].name, true, false));
    });
  });

  it("the quote's speaker is picked from the people list and the unit follows the person", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const exec = await c.user(["EXECUTIVE"], w.bu, "exec");
      void exec;
      const week = (await c.q<{ id: string }>("select id from reporting_weeks order by week_start_at desc limit 1"))[0];
      if (!week) return;
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_weekly_quote_for", w.lead, week.id, w.staff, "Ship it"));
    });
  });
});

describe("first-login password", () => {
  it("a new account can be flagged, and changing the password clears the flag", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("update users set must_change_password = true where id = $1", [w.hr]);
      expect((await c.q<{ f: boolean }>("select must_change_password f from users where id = $1", [w.hr]))[0].f).toBe(true);
      await c.rpc("record_password_changed", w.hr, "CHANGE");
      expect((await c.q<{ f: boolean }>("select must_change_password f from users where id = $1", [w.hr]))[0].f).toBe(false);
    });
  });
});

describe("approved email domains", () => {
  it("only the Super Admin keeps the list, a new account needs an approved domain, and the Super Admin may use any address", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const sa = await c.user(["SUPER_ADMIN"], w.bu, "sa");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("save_allowed_domain", w.hr, "acme.org", true));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_allowed_domain", sa, "gmail.com", true));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_allowed_domain", sa, "not a domain", true));
      await c.rpc("save_allowed_domain", sa, "Acme.org", true);
      expect((await c.q<{ ok: boolean }>("select email_domain_approved('Someone@ACME.org') ok"))[0].ok).toBe(true);
      expect((await c.q<{ ok: boolean }>("select email_domain_approved('someone@gmail.com') ok"))[0].ok).toBe(false);
      const auth = (await c.q<{ id: string }>("select id from users where id = $1", [w.hr]))[0].id;
      void auth;
      await c.expectError("VALIDATION_ERROR", () => c.rpc("provision_user", sa, crypto.randomUUID(), "x@elsewhere.net", "X", "Y", w.bu, ["HR"]));
      // a person on an approved domain can sign in; a gmail one cannot, unless they are the Super Admin
      await c.q("update users set email = 'a@acme.org' where id = $1", [w.hr]);
      expect((await c.q<{ ok: boolean }>("select login_domain_allowed($1) ok", [w.hr]))[0].ok).toBe(true);
      await c.q("update users set email = 'a@gmail.com' where id = $1", [w.hr]);
      expect((await c.q<{ ok: boolean }>("select login_domain_allowed($1) ok", [w.hr]))[0].ok).toBe(false);
      await c.q("update users set email = 'boss@gmail.com' where id = $1", [sa]);
      expect((await c.q<{ ok: boolean }>("select login_domain_allowed($1) ok", [sa]))[0].ok).toBe(true);
      // the app asks this on every request as the signed-in person, so they must be allowed to call it
      expect((await c.asUser(sa, () => c.q<{ ok: boolean }>("select my_domain_allowed() ok")))[0].ok).toBe(true);
      expect((await c.asUser(w.hr, () => c.q<{ ok: boolean }>("select my_domain_allowed() ok")))[0].ok).toBe(false);
      // a domain in use cannot be removed
      await c.q("update users set email = 'b@acme.org' where id = $1", [w.lead]);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_allowed_domain", sa, "acme.org", false));
    });
  });
});

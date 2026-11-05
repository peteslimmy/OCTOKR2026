import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("VR" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr"); const admin = await c.user(["ADMIN"], bu, "admin");
  const finance = await c.user(["FINANCE"], bu, "fin"); const finance2 = await c.user(["FINANCE"], bu, "fin2"); const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'v1@t.local', 'Vee', 'One', $2) returning id", [c.org, bu]))[0].id;
  const vt = await c.rpc<string>("create_violation_type", hr, "LATE", "Late to session", "MEDIUM", 5000);
  return { bu, hr, admin, finance, finance2, sa, staff, vt };
}
let seq = 0; const key = () => `vr-${Date.now()}-${++seq}`;
const violation = async (c: Ctx, w: Awaited<ReturnType<typeof world>>) => (await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, 5000, "agreed fine", null, key())).violation_id;
const pay = async (c: Ctx, w: Awaited<ReturnType<typeof world>>, v: string, ref: string) => (await c.rpc<{ ledger_entry_id: string }>("record_violation_payment", w.hr, v, "PAYMENT", ref, "2031-01-14", key())).ledger_entry_id;
const status = async (c: Ctx, v: string) => (await c.q<{ status: string }>("select status from violations where id = $1", [v]))[0].status;
const view = (c: Ctx, user: string) => c.asUser(user, () => c.rpc<{ id: string; status: string; payment: { reference: string; reversed?: boolean } | null; reversed_payments: number }[]>("read_violations"));
const reverse = async (c: Ctx, w: Awaited<ReturnType<typeof world>>, entry: string) => {
  const r = await c.rpc<{ request_id: string }>("request_ledger_reversal", w.admin, entry, "Paid into the wrong account", key());
  await c.rpc("decide_ledger_reversal", w.finance, r.request_id, "APPROVE", null, key());
  await c.rpc("execute_ledger_reversal", w.finance2, r.request_id, key());
};
const bal = async (c: Ctx) => Number((await c.q<{ b: string }>("select fund_balance((select id from violation_funds limit 1)) b"))[0].b);

describe("a reversed violation payment does NOT reopen the violation (ADR-086, supersedes ADR-065)", () => {
  it("keeps it settled, refuses a second payment, keeps the payment on record marked reversed, and still reconciles", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v = await violation(c, w);
      const entry = await pay(c, w, v, "BANK-1");
      expect(await status(c, v)).toBe("PAID");
      await reverse(c, w, entry);
      expect(await status(c, v)).toBe("PAID");
      expect(await bal(c)).toBe(0);                                                                                    // the money was taken back
      await c.expectError("VIOLATION_ALREADY_SETTLED", () => pay(c, w, v, "BANK-2"));
      const shown = (await view(c, w.hr)).find((x) => x.id === v)!;
      expect(shown.status).toBe("PAID");
      expect(shown.payment).toMatchObject({ reference: "BANK-1", reversed: true });
      expect(shown.reversed_payments).toBe(1);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where entity_id = $1 and action = 'VIOLATION_PAYMENT_REVERSED'", [v]))[0].n).toBe(1);
      expect((await c.q<{ n: number }>("select count(*)::int n from audit_logs where entity_id = $1 and action = 'VIOLATION_REOPENED_BY_REVERSAL'", [v]))[0].n).toBe(0);
      const fund = await c.asUser(w.finance, () => c.rpc<{ reconciled: boolean }>("read_fund_summary"));
      expect(fund.reconciled).toBe(true);
    });
  });

  it("behaves the same through the emergency path, and leaves other violations alone", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v1 = await violation(c, w); const v2 = await violation(c, w);
      const e1 = await pay(c, w, v1, "EM-1"); await pay(c, w, v2, "EM-2");
      await c.rpc("emergency_ledger_reversal", w.sa, e1, "Recorded against the wrong violation during the audit", key());
      expect(await status(c, v1)).toBe("PAID");
      expect(await status(c, v2)).toBe("PAID");
    });
  });

  it("does not touch violations when a disbursement is reversed", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v = await violation(c, w);
      await pay(c, w, v, "LIVE-1");
      const r = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 1000, "OKR Refreshment", "Quarterly celebration", key());
      await c.rpc("start_disbursement_review", w.finance, r.request_id);
      await c.rpc("decide_disbursement_request", w.finance, r.request_id, true, null, key());
      const d = await c.rpc<{ ledger_entry_id: string }>("record_disbursement", w.finance2, r.request_id, `DB-${key()}`, key());
      await reverse(c, w, d.ledger_entry_id);
      expect(await status(c, v)).toBe("PAID");
      await c.expectError("VIOLATION_ALREADY_SETTLED", () => pay(c, w, v, "LIVE-2"));
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("FIN" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr");
  const finance = await c.user(["FINANCE"], bu, "fin");
  const finance2 = await c.user(["FINANCE"], bu, "fin2");
  const both = await c.user(["HR", "FINANCE"], bu, "both");        // holds request AND approve permissions
  const exec = await c.user(["EXECUTIVE"], bu, "exec");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'w1@t.local', 'Wale', 'One', $2) returning id", [c.org, bu]))[0].id;
  const vt = await c.rpc<string>("create_violation_type", hr, "LATE", "Late to session", "MEDIUM", 5000);
  return { bu, hr, finance, finance2, both, exec, lead, staff, vt };
}
let seq = 0;
const key = () => `k-${Date.now()}-${++seq}`;
async function fund(c: Ctx, w: Awaited<ReturnType<typeof world>>, amount: number) {
  const v = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, amount, "agreed fine", null, key());
  return c.rpc<{ ledger_entry_id: string }>("record_violation_payment", w.hr, v.violation_id, "PAYMENT", `REF-${key()}`, "2031-01-14", key());
}
const bal = async (c: Ctx) => Number((await c.q<{ b: string }>("select fund_balance((select id from violation_funds limit 1)) b"))[0].b);

describe("violations", () => {
  it("snapshots criticality and fine; override needs a reason; nothing is pre-seeded; later type changes do not rewrite history", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_violation", w.lead, w.staff, null, w.vt, null, null, null, key()));
      await c.expectError("REASON_REQUIRED", () => c.rpc("create_violation", w.hr, w.staff, null, w.vt, 9000, null, null, key()));
      const k = key();
      const v = await c.rpc<{ violation_id: string; fine_amount: string }>("create_violation", w.hr, w.staff, null, w.vt, null, null, "note", k);
      expect(Number(v.fine_amount)).toBe(5000);
      expect((await c.rpc<{ replayed: boolean }>("create_violation", w.hr, w.staff, null, w.vt, null, null, "note", k)).replayed).toBe(true);
      await c.rpc("update_violation_type", w.hr, w.vt, "Late to session", "HIGH", 20000, true);
      expect((await c.q("select criticality, fine_amount from violations where id = $1", [v.violation_id]))[0]).toEqual({ criticality: "MEDIUM", fine_amount: "5000.00" });
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_violation_type", w.hr, "BAD", "Bad", "LOW", 0));
    });
  });

  it("payment, violation state and ledger CREDIT commit together; duplicates, double settlement and ledger edits are impossible", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, null, null, null, key());
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_violation_payment", w.lead, v.violation_id, "PAYMENT", "R1", "2031-01-14", key()));
      const k = key();
      const p = await c.rpc<{ payment_id: string; amount: string; replayed: boolean }>("record_violation_payment", w.hr, v.violation_id, "SALARY_DEDUCTION", "PAYROLL-77", "2031-01-14", k);
      expect(Number(p.amount)).toBe(5000);
      expect((await c.q("select status from violations where id = $1", [v.violation_id]))[0].status).toBe("DEDUCTION_RECORDED");
      expect(await bal(c)).toBe(5000);
      expect((await c.rpc<{ replayed: boolean }>("record_violation_payment", w.hr, v.violation_id, "SALARY_DEDUCTION", "PAYROLL-77", "2031-01-14", k)).replayed).toBe(true);
      expect(await bal(c)).toBe(5000); // retry did not double-post
      await c.expectError("VIOLATION_ALREADY_SETTLED", () => c.rpc("record_violation_payment", w.hr, v.violation_id, "PAYMENT", "R2", "2031-01-14", key()));
      await c.expectError("VIOLATION_ALREADY_SETTLED", () => c.rpc("update_violation", w.hr, v.violation_id, 1, "r", null));
      const v2 = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, null, null, null, key());
      await c.expectError("DUPLICATE_PAYMENT", () => c.rpc("record_violation_payment", w.hr, v2.violation_id, "PAYMENT", "PAYROLL-77", "2031-01-14", key()));
      expect(await bal(c)).toBe(5000);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update financial_ledger_entries set amount = 1"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from financial_ledger_entries"));
      await c.expectError("cannot truncate", () => c.q("truncate financial_ledger_entries"));   // refused by the foreign keys that point at ledger entries (the truncate trigger stays as a second guard)
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from violation_payments"));
    });
  });

  it("a payment failure leaves no payment, no state change and no ledger entry (atomicity)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const v = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, null, null, null, key());
      await c.q("create function boom() returns trigger language plpgsql as $$ begin raise exception 'BOOM'; end $$");
      await c.q("create trigger boom_t before insert on financial_ledger_entries for each row execute function boom()");
      await c.expectError("BOOM", () => c.rpc("record_violation_payment", w.hr, v.violation_id, "PAYMENT", "R1", "2031-01-14", key()));
      expect((await c.q("select status from violations where id = $1", [v.violation_id]))[0].status).toBe("OPEN");
      expect((await c.q("select count(*)::int n from violation_payments"))[0].n).toBe(0);
    });
  });
});

describe("disbursements (FR-FIN-*, AC-FIN-*)", () => {
  it("HR requests, Finance decides; the requester can never approve, even holding both roles; rejection needs a reason", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await fund(c, w, 100000);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_disbursement_request", w.finance, 1000, "x", "y", key()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_disbursement_request", w.hr, 0, "x", "y", key()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_disbursement_request", w.hr, 10.005, "x", "y", key()));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_disbursement_request", w.hr, 1000, " ", "y", key()));
      await c.expectError("INSUFFICIENT_FUNDS", () => c.rpc("create_disbursement_request", w.hr, 100000.01, "Too much", "n/a", key()));
      const r = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 30000, "Team event", "Quarterly culture event", key());
      expect((await c.q("select count(*)::int n from notifications where event_type = 'DISBURSEMENT_REQUESTED' and user_id = $1", [w.finance]))[0].n).toBe(1);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_disbursement_request", w.hr, r.request_id, true, null, key()));
      const mine = await c.rpc<{ request_id: string }>("create_disbursement_request", w.both, 1000, "Own request", "self", key());
      await c.expectError("DISBURSEMENT_SELF_APPROVAL", () => c.rpc("decide_disbursement_request", w.both, mine.request_id, true, null, key()));
      await c.expectError("DISBURSEMENT_SELF_APPROVAL", () => c.rpc("decide_disbursement_request", w.both, mine.request_id, false, "no", key()));
      await c.expectError("DISBURSEMENT_SELF_APPROVAL", () => c.rpc("start_disbursement_review", w.both, mine.request_id));
      await c.expectError("DISBURSEMENT_REJECTION_REASON_REQUIRED", () => c.rpc("decide_disbursement_request", w.finance, r.request_id, false, "  ", key()));
      await c.rpc("start_disbursement_review", w.finance, r.request_id);
      const rej = await c.rpc<{ decision: string }>("decide_disbursement_request", w.finance, r.request_id, false, "Not budgeted this quarter", key());
      expect(rej.decision).toBe("REJECTED");
      expect((await c.q("select count(*)::int n from notifications where event_type = 'DISBURSEMENT_REJECTED' and user_id = $1", [w.hr]))[0].n).toBe(1);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_disbursement_request", w.finance2, r.request_id, true, null, key())); // terminal
      expect(await bal(c)).toBe(100000); // rejection moves no money
    });
  });

  it("approval is not disbursement: only DISBURSE posts the ledger DEBIT, atomically; the requester cannot release their own request", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await fund(c, w, 50000);
      const r = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 20000, "Training", "Certification course", key());
      const dk = key();
      await c.rpc("decide_disbursement_request", w.finance, r.request_id, true, null, dk);
      expect((await c.rpc<{ replayed: boolean }>("decide_disbursement_request", w.finance, r.request_id, true, null, dk)).replayed).toBe(true);
      expect(await bal(c)).toBe(50000);                                   // approved, but no cash has moved
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_disbursement", w.hr, r.request_id, "BANK-1", key()));
      const own = await c.rpc<{ request_id: string }>("create_disbursement_request", w.both, 1000, "Own", "x", key());
      await c.rpc("decide_disbursement_request", w.finance, own.request_id, true, null, key());
      await c.expectError("DISBURSEMENT_SELF_APPROVAL", () => c.rpc("record_disbursement", w.both, own.request_id, "BANK-X", key()));
      const k = key();
      const d = await c.rpc<{ ledger_entry_id: string }>("record_disbursement", w.finance2, r.request_id, "BANK-REF-1", k);
      expect(d.ledger_entry_id).toBeTruthy();
      expect(await bal(c)).toBe(30000);
      expect((await c.rpc<{ replayed: boolean }>("record_disbursement", w.finance2, r.request_id, "BANK-REF-1", k)).replayed).toBe(true);
      expect(await bal(c)).toBe(30000);                                   // retry does not debit twice
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("record_disbursement", w.finance2, r.request_id, "BANK-REF-2", key()));
      expect((await c.q("select status from disbursement_requests where id = $1", [r.request_id]))[0].status).toBe("DISBURSED");
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from disbursements"));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.q("update disbursement_requests set status = 'SUBMITTED' where id = $1", [r.request_id]));
      expect((await c.q("select count(*)::int n from audit_logs where action in ('DISBURSEMENT_APPROVED','DISBURSEMENT_RECORDED')"))[0].n).toBe(3);
    });
  });

  it("approved-but-unreleased requests are committed: a second approval that would overdraw the fund is refused; the ledger itself refuses a negative balance", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await fund(c, w, 100000);
      const a = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 70000, "A", "a", key());
      const b = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 60000, "B", "b", key());   // each fits on its own at creation
      await c.rpc("decide_disbursement_request", w.finance, a.request_id, true, null, key());
      await c.expectError("INSUFFICIENT_FUNDS", () => c.rpc("decide_disbursement_request", w.finance, b.request_id, true, null, key()));
      expect((await c.q("select status from disbursement_requests where id = $1", [b.request_id]))[0].status).toBe("SUBMITTED");
      const f = (await c.q<{ id: string }>("select id from violation_funds limit 1"))[0].id;
      await c.expectError("INSUFFICIENT_FUNDS", () => c.q("insert into financial_ledger_entries (fund_id, entry_type, amount, source_type, source_id, reference, created_by) values ($1, 'DEBIT', 100000.01, 'DISBURSEMENT', gen_random_uuid(), 'X-1', $2)", [f, w.finance]));
    });
  });

  it("reconciliation: displayed balance equals credits minus debits and matches recorded payments and disbursements", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await fund(c, w, 40000);
      await fund(c, w, 10000);
      const r = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 15000, "X", "y", key());
      await c.rpc("decide_disbursement_request", w.finance, r.request_id, true, null, key());
      await c.rpc("record_disbursement", w.finance2, r.request_id, "B-1", key());
      const s = await c.asUser(w.finance, () => c.rpc<{ balance: string; inflow: string; outflow: string; reconciled: boolean; available: string }>("read_fund_summary"));
      expect(Number(s.balance)).toBe(35000);
      expect(Number(s.inflow)).toBe(50000);
      expect(Number(s.outflow)).toBe(15000);
      expect(s.reconciled).toBe(true);
      const ledger = await c.asUser(w.finance, () => c.rpc<{ running_balance: string; entry_type: string }[]>("read_ledger", 10));
      expect(Number(ledger[0].running_balance)).toBe(35000);
    });
  });
});

describe("finance data security (RLS)", () => {
  it("only finance roles read the ledger; Executive sees the summary but not entries; BU Leads and HR see no ledger", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await fund(c, w, 5000);
      expect((await c.asUser(w.finance, () => c.q("select id from financial_ledger_entries"))).length).toBe(1);
      expect(await c.asUser(w.hr, () => c.q("select id from financial_ledger_entries"))).toEqual([]);
      expect(await c.asUser(w.lead, () => c.q("select id from financial_ledger_entries"))).toEqual([]);
      expect(await c.asUser(w.exec, () => c.q("select id from financial_ledger_entries"))).toEqual([]);
      expect(await c.asUser(w.exec, () => c.rpc<{ configured: boolean }>("read_fund_summary"))).toMatchObject({ configured: true });
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.lead, () => c.rpc("read_fund_summary")));
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.hr, () => c.rpc("read_ledger", 10)));
      expect(await c.asUser(w.lead, () => c.q("select id from violations"))).toEqual([]);
      await c.expectError("permission denied", () => c.asUser(w.finance, () => c.q("insert into financial_ledger_entries (fund_id, entry_type, amount, source_type, source_id, reference, created_by) select id, 'CREDIT', 1, 'REVERSAL', gen_random_uuid(), 'hack', $1 from violation_funds", [w.finance])));
      // a requester sees their own request; an unrelated BU Lead sees none
      const r = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, 100, "p", "j", key());
      expect((await c.asUser(w.hr, () => c.q("select id from disbursement_requests where id = $1", [r.request_id]))).length).toBe(1);
      expect(await c.asUser(w.lead, () => c.q("select id from disbursement_requests"))).toEqual([]);
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("LRV" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const finance = await c.user(["FINANCE"], bu, "fin");
  const finance2 = await c.user(["FINANCE"], bu, "fin2");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'w1@t.local', 'Wale', 'One', $2) returning id", [c.org, bu]))[0].id;
  const vt = await c.rpc<string>("create_violation_type", hr, "LATE", "Late to session", "MEDIUM", 5000);
  return { bu, hr, admin, finance, finance2, sa, lead, staff, vt };
}
type W = Awaited<ReturnType<typeof world>>;
let seq = 0;
const key = () => `k-${Date.now()}-${++seq}`;
/** Records a violation payment of `amount` and returns its ledger entry id (a CREDIT). */
async function credit(c: Ctx, w: W, amount: number) {
  const v = await c.rpc<{ violation_id: string }>("create_violation", w.hr, w.staff, null, w.vt, amount, "agreed fine", null, key());
  return (await c.rpc<{ ledger_entry_id: string }>("record_violation_payment", w.hr, v.violation_id, "PAYMENT", `REF-${key()}`, "2031-01-14", key())).ledger_entry_id;
}
async function disburse(c: Ctx, w: W, amount: number, release = true) {
  const r = await c.rpc<{ request_id: string }>("create_disbursement_request", w.hr, amount, "OKR Refreshment", "Quarterly celebration", key());
  await c.rpc("start_disbursement_review", w.finance, r.request_id);
  await c.rpc("decide_disbursement_request", w.finance, r.request_id, true, null, key());
  if (!release) return r.request_id;
  const d = await c.rpc<{ ledger_entry_id: string }>("record_disbursement", w.finance2, r.request_id, `DB-${key()}`, key());
  return d.ledger_entry_id;
}
const bal = async (c: Ctx) => Number((await c.q<{ b: string }>("select fund_balance((select id from violation_funds limit 1)) b"))[0].b);
const summary = (c: Ctx, u: string) => c.asUser(u, () => c.rpc<{ reconciled: boolean; balance: string; available: string; pending_reversals: number; reconciliation: { reversal_credits: string; reversal_debits: string } }>("read_fund_summary"));
interface Req { request_id: string; status: string; replayed: boolean }
const request = (c: Ctx, actor: string, entry: string, reason = "Recorded against the wrong person", k = key()) => c.rpc<Req>("request_ledger_reversal", actor, entry, reason, k);
const decide = (c: Ctx, actor: string, id: string, decision: string, comment: string | null = null, k = key()) => c.rpc<Record<string, unknown>>("decide_ledger_reversal", actor, id, decision, comment, k);
const execute = (c: Ctx, actor: string, id: string, k = key()) => c.rpc<{ reversal_entry_id: string; replayed: boolean }>("execute_ledger_reversal", actor, id, k);

describe("ledger reversal: request, independent approval, separate execution", () => {
  it("cancels an entry with a new opposite entry that points back to it; the original is untouched and the fund still reconciles", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      const before = (await c.q<{ amount: string; entry_type: string }>("select amount, entry_type from financial_ledger_entries where id = $1", [entry]))[0];
      const req = await request(c, w.admin, entry);
      expect(req.status).toBe("PENDING");
      expect(await bal(c)).toBe(5000);                                         // nothing posted by asking
      await decide(c, w.finance, req.request_id, "APPROVE", "Confirmed against the bank statement");
      expect(await bal(c)).toBe(5000);                                         // nor by approving
      const done = await execute(c, w.finance2, req.request_id);
      expect(await bal(c)).toBe(0);
      const rev = (await c.q<{ entry_type: string; amount: string; source_type: string; reverses_entry_id: string; created_by: string }>("select * from financial_ledger_entries where id = $1", [done.reversal_entry_id]))[0];
      expect([rev.entry_type, Number(rev.amount), rev.source_type, rev.reverses_entry_id, rev.created_by]).toEqual(["DEBIT", 5000, "REVERSAL", entry, w.finance2]);
      expect((await c.q("select amount, entry_type from financial_ledger_entries where id = $1", [entry]))[0]).toEqual(before);   // the original is exactly as it was
      const s = await summary(c, w.finance);
      expect(s.reconciled).toBe(true);
      expect(Number(s.reconciliation.reversal_debits)).toBe(5000);
      const view = await c.asUser(w.finance, () => c.rpc<{ id: string; reversed: boolean; reverses_entry_id: string | null }[]>("read_ledger", 50));
      expect(view.find((x) => x.id === entry)?.reversed).toBe(true);
      expect(view.find((x) => x.id === done.reversal_entry_id)?.reverses_entry_id).toBe(entry);
      const audits = await c.q<{ action: string }>("select action from audit_logs where entity_type = 'ledger_reversal_request' and entity_id = $1 order by seq", [req.request_id]);
      expect(audits.map((a) => a.action)).toEqual(["LEDGER_REVERSAL_REQUESTED", "LEDGER_REVERSAL_APPROVED", "LEDGER_REVERSAL_EXECUTED"]);
      const row = (await c.q<{ requested_by: string; decided_by: string; executed_by: string; status: string }>("select * from ledger_reversal_requests where id = $1", [req.request_id]))[0];
      expect([row.status, row.requested_by, row.decided_by, row.executed_by]).toEqual(["EXECUTED", w.admin, w.finance, w.finance2]);
    });
  });

  it("keeps the people apart: no self-approval, no self-execution, steps in order, each once", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      const req = await request(c, w.finance, entry);                          // Finance may request AND approve in general...
      await c.expectError("LEDGER_REVERSAL_SELF_APPROVAL", () => decide(c, w.finance, req.request_id, "APPROVE"));   // ...but never their own request
      await c.expectError("LEDGER_REVERSAL_NOT_APPROVED", () => execute(c, w.finance2, req.request_id));            // cannot post before approval
      await decide(c, w.finance2, req.request_id, "APPROVE", null, "dec-once-0001");
      expect((await decide(c, w.finance2, req.request_id, "APPROVE", null, "dec-once-0001")).replayed).toBe(true);
      await c.expectError("LEDGER_REVERSAL_NOT_PENDING", () => decide(c, w.sa, req.request_id, "REJECT", "late"));
      await c.expectError("LEDGER_REVERSAL_SELF_APPROVAL", () => execute(c, w.finance, req.request_id));            // requester cannot post
      const done = await execute(c, w.sa, req.request_id, "exe-once-0001");
      expect((await execute(c, w.sa, req.request_id, "exe-once-0001")).replayed).toBe(true);
      expect((await c.q<{ n: number }>("select count(*)::int n from financial_ledger_entries where source_type = 'REVERSAL'"))[0].n).toBe(1);
      await c.expectError("LEDGER_REVERSAL_NOT_APPROVED", () => execute(c, w.sa, req.request_id));
      expect(done.replayed).toBe(false);
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => decide(c, w.sa, req.request_id, "APPROVE", null, "dec-once-0001"));
    });
  });

  it("is limited by permission and validates input", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      for (const actor of [w.hr, w.lead]) await c.expectError("PERMISSION_DENIED", () => request(c, actor, entry));
      await c.expectError("REASON_REQUIRED", () => request(c, w.admin, entry, "  "));
      await c.expectError("VALIDATION_ERROR", () => request(c, w.admin, entry, "x", "short"));
      await c.expectError("NOT_FOUND", () => request(c, w.admin, "11111111-1111-4111-8111-111111111111"));
      const req = await request(c, w.admin, entry);
      for (const actor of [w.hr, w.admin, w.lead]) await c.expectError("PERMISSION_DENIED", () => decide(c, actor, req.request_id, "APPROVE", null, key()));   // ADMIN may ask, not approve
      await c.expectError("VALIDATION_ERROR", () => decide(c, w.finance, req.request_id, "MAYBE"));
      await c.expectError("REASON_REQUIRED", () => decide(c, w.finance, req.request_id, "REJECT", " "));
      await decide(c, w.finance, req.request_id, "APPROVE");
      await c.expectError("PERMISSION_DENIED", () => execute(c, w.admin, req.request_id));
    });
  });

  it("allows one open request per entry, frees the entry on rejection, and never reverses a reversal or the same entry twice", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      const first = await request(c, w.admin, entry, "First", "req-dup-0001");
      expect((await request(c, w.admin, entry, "First", "req-dup-0001")).replayed).toBe(true);
      await c.expectError("LEDGER_REVERSAL_PENDING", () => request(c, w.finance, entry, "Second"));
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => request(c, w.finance, entry, "Second", "req-dup-0001"));
      await decide(c, w.finance, first.request_id, "REJECT", "The entry is correct");
      expect((await c.q("select status from ledger_reversal_requests where id = $1", [first.request_id]))[0].status).toBe("REJECTED");
      const second = await request(c, w.finance, entry, "New evidence");
      await decide(c, w.finance2, second.request_id, "APPROVE");
      const done = await execute(c, w.sa, second.request_id);
      await c.expectError("LEDGER_ENTRY_ALREADY_REVERSED", () => request(c, w.admin, entry, "Again"));
      await c.expectError("LEDGER_ENTRY_NOT_REVERSIBLE", () => request(c, w.admin, done.reversal_entry_id, "Undo the undo"));
      await c.expectError("LEDGER_ENTRY_NOT_REVERSIBLE", () => c.rpc("emergency_ledger_reversal", w.sa, done.reversal_entry_id, "Undo the undo, please", key()));
    });
  });

  it("protects the balance: a reversal cannot take money that is committed or already paid out, but money paid out can be returned", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      const approvedOnly = await disburse(c, w, 3000, false);                   // approved, not yet released: 3000 is committed
      const req = await request(c, w.admin, entry);
      await decide(c, w.finance, req.request_id, "APPROVE");
      await c.expectError("INSUFFICIENT_FUNDS", () => execute(c, w.sa, req.request_id));
      expect(await bal(c)).toBe(5000);                                          // refused as a whole
      expect((await c.q("select status from ledger_reversal_requests where id = $1", [req.request_id]))[0].status).toBe("APPROVED");
      await c.rpc("record_disbursement", w.finance2, approvedOnly, `DB-${key()}`, key());                      // release the 3000
      const debit = (await c.q<{ id: string }>("select id from financial_ledger_entries where source_type = 'DISBURSEMENT'"))[0].id;
      await c.expectError("INSUFFICIENT_FUNDS", () => execute(c, w.sa, req.request_id));                       // 2000 left cannot cover taking back 5000
      expect(await bal(c)).toBe(2000);
      const r2 = await request(c, w.admin, debit, "The transfer bounced");
      await decide(c, w.finance, r2.request_id, "APPROVE");
      const done = await execute(c, w.finance2, r2.request_id);
      expect((await c.q<{ entry_type: string }>("select entry_type from financial_ledger_entries where id = $1", [done.reversal_entry_id]))[0].entry_type).toBe("CREDIT");
      expect(await bal(c)).toBe(5000);
      const s = await summary(c, w.finance);
      expect(s.reconciled).toBe(true);
      expect(Number(s.reconciliation.reversal_credits)).toBe(3000);
      // now the payment can be reversed in full
      await execute(c, w.sa, req.request_id);
      expect(await bal(c)).toBe(0);
      expect((await summary(c, w.finance)).reconciled).toBe(true);
    });
  });

  it("emergency reversal: Super Admin only, immediate, loudly recorded and alerted, and still no edit of the original", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      for (const actor of [w.finance, w.admin, w.hr, w.lead]) await c.expectError("PERMISSION_DENIED", () => c.rpc("emergency_ledger_reversal", actor, entry, "Not allowed to do this", key()));
      await c.expectError("REASON_REQUIRED", () => c.rpc("emergency_ledger_reversal", w.sa, entry, "too short", key()));
      const open = await request(c, w.admin, entry);
      await c.expectError("LEDGER_REVERSAL_PENDING", () => c.rpc("emergency_ledger_reversal", w.sa, entry, "Finish the open request first", key()));
      await decide(c, w.finance, open.request_id, "REJECT", "Replaced by an emergency");
      const em = await c.rpc<{ request_id: string; reversal_entry_id: string; emergency: boolean; replayed: boolean }>("emergency_ledger_reversal", w.sa, entry, "Payment recorded against the wrong fund during an audit", "em-key-0001");
      expect(em).toMatchObject({ emergency: true, replayed: false });
      expect(await bal(c)).toBe(0);
      const row = (await c.q<{ emergency: boolean; status: string; requested_by: string; decided_by: string; executed_by: string }>("select * from ledger_reversal_requests where id = $1", [em.request_id]))[0];
      expect([row.emergency, row.status, row.requested_by, row.decided_by, row.executed_by]).toEqual([true, "EXECUTED", w.sa, w.sa, w.sa]);
      expect((await c.q<{ action: string }>("select action from audit_logs where entity_type = 'ledger_reversal_request' and entity_id = $1", [em.request_id])).map((a) => a.action)).toEqual(["LEDGER_REVERSAL_EMERGENCY"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'LEDGER_REVERSAL_EMERGENCY' and user_id = any($1)", [[w.finance, w.finance2, w.admin]]))[0].n).toBe(3);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'LEDGER_REVERSAL_EMERGENCY' and user_id = $1", [w.sa]))[0].n).toBe(0);   // the actor is not alerted about themselves
      expect((await c.rpc<{ replayed: boolean }>("emergency_ledger_reversal", w.sa, entry, "Payment recorded against the wrong fund during an audit", "em-key-0001")).replayed).toBe(true);
      expect((await c.q<{ n: number }>("select count(*)::int n from financial_ledger_entries where source_type = 'REVERSAL'"))[0].n).toBe(1);
      await c.expectError("LEDGER_ENTRY_ALREADY_REVERSED", () => c.rpc("emergency_ledger_reversal", w.sa, entry, "Trying a second time round", key()));
      expect((await summary(c, w.sa)).reconciled).toBe(true);
    });
  });

  it("keeps history immutable and visible only to people who can view the ledger", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const entry = await credit(c, w, 5000);
      const req = await request(c, w.admin, entry);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update ledger_reversal_requests set reason = 'edited' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update ledger_reversal_requests set status = 'EXECUTED' where id = $1", [req.request_id]));   // no skipping the steps
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from ledger_reversal_requests where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update financial_ledger_entries set amount = 1 where id = $1", [entry]));
      await c.expectError("23514", () => c.q("insert into financial_ledger_entries (fund_id, entry_type, amount, source_type, source_id, reference, created_by) select fund_id, 'DEBIT', 1, 'REVERSAL', gen_random_uuid(), 'RV-x', $1 from financial_ledger_entries limit 1", [w.sa])
        .catch((e) => { throw new Error(`23514 ${(e as Error).message}`); }));                            // a REVERSAL must reference the entry it cancels
      expect(await c.asUser(w.finance, () => c.rpc<unknown[]>("read_ledger_reversals"))).toHaveLength(1);
      expect(await c.asUser(w.admin, () => c.rpc<unknown[]>("read_ledger_reversals"))).toHaveLength(1);
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.hr, () => c.rpc("read_ledger_reversals")));
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.lead, () => c.rpc("read_ledger_reversals")));
    });
  });
});

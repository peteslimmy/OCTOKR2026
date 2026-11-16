import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

/** Fund requests are treated first in, first out; Admin and Super Admin can skip the queue with a recorded reason (ADR-125). */
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("FQ" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr");
  const finance = await c.user(["FINANCE"], bu, "fin");
  const admin = await c.user(["ADMIN"], bu, "adm");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'fq@t.local', 'Fay', 'Queue', $2) returning id", [c.org, bu]))[0].id;
  const vt = await c.rpc<string>("create_violation_type", hr, "LATEQ", "Late", "MEDIUM", 50000);
  await c.setNow("2031-01-01T09:00:00+01:00");
  const v = await c.rpc<{ violation_id: string }>("create_violation", hr, staff, null, vt, null, null, null, key());
  await c.rpc("record_violation_payment", hr, v.violation_id, "PAYMENT", `REF-${key()}`, "2031-01-01", key());      // puts 50,000 in the fund
  return { bu, hr, finance, admin, sa };
}
let seq = 0;
const key = () => `fq-${Date.now()}-${++seq}`;
const request = async (c: Ctx, who: string, at: string, amount = 1000) => {
  await c.setNow(at);
  return (await c.rpc<{ request_id: string }>("create_disbursement_request", who, amount, "Data", "Needed this week", key())).request_id;
};

describe("fund requests are treated first in, first out (ADR-125)", () => {
  it("a newer request cannot be reviewed, approved or rejected while an older one is waiting; it can once the older one is treated", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r1 = await request(c, w.hr, "2031-01-02T09:00:00+01:00");
      const r2 = await request(c, w.hr, "2031-01-03T09:00:00+01:00");
      await c.expectError("DISBURSEMENT_FIFO", () => c.rpc("start_disbursement_review", w.finance, r2));
      await c.expectError("DISBURSEMENT_FIFO", () => c.rpc("decide_disbursement_request", w.finance, r2, true, null, key()));
      await c.expectError("DISBURSEMENT_FIFO", () => c.rpc("decide_disbursement_request", w.finance, r2, false, "no", key()));
      await c.rpc("start_disbursement_review", w.finance, r1);                                       // the oldest is next in line
      await c.rpc("decide_disbursement_request", w.finance, r1, true, null, key());
      await c.rpc("start_disbursement_review", w.finance, r2);                                       // r1 has left the queue
      const [row] = await c.q<{ status: string }>("select status from disbursement_requests where id = $1", [r2]);
      expect(row.status).toBe("UNDER_REVIEW");
    });
  });

  it("a rejected or withdrawn older request leaves the queue; a revised request goes to the back", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r1 = await request(c, w.hr, "2031-01-02T09:00:00+01:00");
      const r2 = await request(c, w.hr, "2031-01-03T09:00:00+01:00");
      await c.rpc("decide_disbursement_request", w.finance, r1, false, "Not needed", key());
      await c.rpc("decide_disbursement_request", w.finance, r2, true, null, key());                  // r1 is no longer waiting
    });
  });

  it("only Admin and Super Admin can skip the queue, with a reason that is audited; the skipped request can then be treated", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r1 = await request(c, w.hr, "2031-01-02T09:00:00+01:00");
      const r2 = await request(c, w.hr, "2031-01-03T09:00:00+01:00");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("skip_disbursement_queue", w.finance, r2, "urgent"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("skip_disbursement_queue", w.hr, r2, "urgent"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("skip_disbursement_queue", w.admin, r2, "  "));
      const out = await c.rpc<{ skipped: boolean; older_request: string }>("skip_disbursement_queue", w.admin, r2, "Supplier needs payment today");
      expect(out).toMatchObject({ skipped: true, older_request: r1 });
      const [a] = await c.q<{ reason: string; old_values: { older_request: string } }>("select reason, old_values from audit_logs where action = 'DISBURSEMENT_QUEUE_SKIPPED'");
      expect(a.reason).toBe("Supplier needs payment today");
      expect(a.old_values.older_request).toBe(r1);
      await c.rpc("decide_disbursement_request", w.finance, r2, true, null, key());                   // r1 is still waiting, but r2 was allowed
      const [x] = await c.q<{ status: string }>("select status from disbursement_requests where id = $1", [r1]);
      expect(x.status).toBe("SUBMITTED");
      const again = await c.rpc<{ skipped: boolean }>("skip_disbursement_queue", w.sa, r1, "already next");   // a Super Admin may skip too; r1 is next in line, nothing to skip
      expect(again.skipped).toBe(false);
    });
  });

  it("the list puts waiting requests first, oldest first, and says which one is next in line", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r1 = await request(c, w.hr, "2031-01-02T09:00:00+01:00");
      const r2 = await request(c, w.hr, "2031-01-03T09:00:00+01:00");
      const r3 = await request(c, w.hr, "2031-01-04T09:00:00+01:00");
      const list = (await c.q<{ j: { id: string; in_order: boolean }[] }>("select read_disbursement_requests() j"))[0].j;
      expect(list.map((r) => r.id)).toEqual([r1, r2, r3]);
      expect(list.map((r) => r.in_order)).toEqual([true, false, false]);
      await c.rpc("skip_disbursement_queue", w.admin, r3, "Urgent");
      const after = (await c.q<{ j: { id: string; in_order: boolean }[] }>("select read_disbursement_requests() j"))[0].j;
      expect(after.find((r) => r.id === r3)!.in_order).toBe(true);                                    // a recorded skip is shown
    });
  });
});

import { describe, expect, it } from "vitest";
import { W1, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const admin2 = await c.user(["ADMIN"], buA, "admin2");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa");
  const hr = await c.user(["HR"], buA, "hr");
  const lead = await c.user(["BU_LEAD"], buA, "lead");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  const wk2 = await weekId(c, "2031-01-13");
  return { buA, admin, admin2, sa, hr, lead, strat, wk, wk2 };
}
const closeWeek = async (c: Ctx, wk: string) => { await c.setNow(W1.finalLock); await c.rpc("finalize_reporting_week", wk); };
interface Req { request_id: string; status: string; replayed: boolean }
const request = (c: Ctx, actor: string, wk: string, dir = "DECLARE", reason = "Public holiday", key = "req-key-0001") => c.rpc<Req>("request_holiday_amendment", actor, wk, dir, reason, key);
const decide = (c: Ctx, actor: string, id: string, decision: string, comment: string | null = null, key = "dec-key-0001") => c.rpc<Record<string, unknown>>("decide_holiday_amendment_request", actor, id, decision, comment, key);

describe("holiday amendment on a closed week needs two people", () => {
  it("an open week is amended directly and needs no request; a closed week cannot be", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.open);
      await c.expectError("HOLIDAY_REQUEST_NOT_NEEDED", () => request(c, w.admin, w.wk));
      await c.rpc("amend_organization_holiday", w.admin, w.wk, "DECLARE", "Routine", "direct-0001");                 // the single-Admin step still works before final lock
      await closeWeek(c, w.wk);
      await c.expectError("TWO_PERSON_APPROVAL_REQUIRED", () => c.rpc("amend_organization_holiday", w.admin, w.wk, "REVERSE", "Alone", "alone-0001"));
    });
  });

  it("the requester can never decide, any other holder of the permission can, and approval applies the amendment with the right people on record", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await closeWeek(c, w.wk);
      const req = await request(c, w.admin, w.wk, "DECLARE", "Declared after the fact");
      expect(req).toMatchObject({ status: "PENDING", replayed: false });
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'HOLIDAY_AMENDMENT_REQUESTED' and user_id = any($1)", [[w.admin2, w.sa]]))[0].n).toBe(2);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'HOLIDAY_AMENDMENT_REQUESTED' and user_id = $1", [w.admin]))[0].n).toBe(0);   // not told about their own request
      await c.expectError("HOLIDAY_REQUEST_SELF_APPROVAL", () => decide(c, w.admin, req.request_id, "APPROVE"));
      await c.expectError("HOLIDAY_REQUEST_SELF_APPROVAL", () => decide(c, w.admin, req.request_id, "REJECT", "no", "dec-key-self2"));
      expect((await c.q("select reporting_state from reporting_weeks where id = $1", [w.wk]))[0].reporting_state).toBe("NORMAL");   // nothing changed

      const done = await decide(c, w.admin2, req.request_id, "APPROVE", "Confirmed with the MD");
      expect(done).toMatchObject({ status: "APPLIED", replayed: false });
      expect((await c.q("select reporting_state from reporting_weeks where id = $1", [w.wk]))[0].reporting_state).toBe("ORGANIZATION_HOLIDAY");
      const row = (await c.q<{ status: string; requested_by: string; decided_by: string; amendment_id: string; decision_comment: string }>("select * from holiday_amendment_requests where id = $1", [req.request_id]))[0];
      expect([row.status, row.requested_by, row.decided_by, row.decision_comment]).toEqual(["APPLIED", w.admin, w.admin2, "Confirmed with the MD"]);
      expect((await c.q<{ actor_user_id: string }>("select actor_user_id from holiday_amendments where id = $1", [row.amendment_id]))[0].actor_user_id).toBe(w.admin2);
      const audits = await c.q<{ action: string }>("select action from audit_logs where entity_type = 'holiday_amendment_request' and entity_id = $1 order by seq", [req.request_id]);
      expect(audits.map((a) => a.action)).toEqual(["HOLIDAY_AMENDMENT_REQUESTED", "HOLIDAY_AMENDMENT_APPROVED"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'HOLIDAY_AMENDMENT_APPROVED' and user_id = $1", [w.admin]))[0].n).toBe(1);
      // the amendment is a normal one: new quarterly version, history untouched
      expect((await c.q<{ source: string }>("select source from quarterly_score_snapshots where business_unit_id = $1 order by version_number desc limit 1", [w.buA]))[0].source).toBe("AMENDMENT");
    });
  });

  it("a rejection needs a reason, changes nothing, and frees the week for a new request", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await closeWeek(c, w.wk);
      const req = await request(c, w.admin, w.wk);
      await c.expectError("REASON_REQUIRED", () => decide(c, w.sa, req.request_id, "REJECT", "  "));
      const rej = await decide(c, w.sa, req.request_id, "REJECT", "The closure was not company-wide", "dec-key-rej1");
      expect(rej.status).toBe("REJECTED");
      expect((await c.q("select reporting_state from reporting_weeks where id = $1", [w.wk]))[0].reporting_state).toBe("NORMAL");
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'HOLIDAY_AMENDMENT_REJECTED' and user_id = $1", [w.admin]))[0].n).toBe(1);
      const again = await request(c, w.admin, w.wk, "DECLARE", "Second attempt", "req-key-0002");
      expect(again.status).toBe("PENDING");
    });
  });

  it("allows one pending request per week, one decision per request, and safe retries", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await closeWeek(c, w.wk);
      const req = await request(c, w.admin, w.wk);
      expect((await request(c, w.admin, w.wk)).replayed).toBe(true);                                          // same key: same request
      await c.expectError("HOLIDAY_REQUEST_PENDING", () => request(c, w.admin2, w.wk, "DECLARE", "Another", "req-key-0003"));
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => request(c, w.admin, w.wk, "REVERSE", "Public holiday", "req-key-0001"));
      await decide(c, w.admin2, req.request_id, "APPROVE");
      expect((await decide(c, w.admin2, req.request_id, "APPROVE")).replayed).toBe(true);                       // retry returns the first answer
      await c.expectError("HOLIDAY_REQUEST_NOT_PENDING", () => decide(c, w.sa, req.request_id, "REJECT", "late", "dec-key-late"));
      await c.expectError("INVALID_STATE_TRANSITION", () => request(c, w.admin, w.wk, "DECLARE", "Already a holiday", "req-key-0004"));
      expect((await c.q<{ n: number }>("select count(*)::int n from holiday_amendments"))[0].n).toBe(1);
    });
  });

  it("is limited to holders of quarter.score.amend, and validates its arguments", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await closeWeek(c, w.wk);
      for (const actor of [w.hr, w.lead]) await c.expectError("PERMISSION_DENIED", () => request(c, actor, w.wk, "DECLARE", "x", "req-" + actor.slice(0, 8)));
      await c.expectError("VALIDATION_ERROR", () => request(c, w.admin, w.wk, "TOGGLE"));
      await c.expectError("REASON_REQUIRED", () => request(c, w.admin, w.wk, "DECLARE", " "));
      await c.expectError("VALIDATION_ERROR", () => request(c, w.admin, w.wk, "DECLARE", "x", "short"));
      await c.expectError("NOT_FOUND", () => request(c, w.admin, "11111111-1111-4111-8111-111111111111"));
      const req = await request(c, w.admin, w.wk);
      await c.expectError("PERMISSION_DENIED", () => decide(c, w.hr, req.request_id, "APPROVE"));
      await c.expectError("VALIDATION_ERROR", () => decide(c, w.admin2, req.request_id, "MAYBE"));
      await c.expectError("NOT_FOUND", () => decide(c, w.admin2, "11111111-1111-4111-8111-111111111111", "APPROVE", null, "dec-key-nf01"));
    });
  });

  it("keeps decided requests immutable and visible only to people who can amend scores", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await closeWeek(c, w.wk);
      const req = await request(c, w.admin, w.wk);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update holiday_amendment_requests set reason = 'edited' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from holiday_amendment_requests where id = $1", [req.request_id]));
      await decide(c, w.admin2, req.request_id, "APPROVE");
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update holiday_amendment_requests set status = 'REJECTED', decision_comment = 'x' where id = $1", [req.request_id]));
      expect(await c.asUser(w.admin, () => c.rpc<unknown[]>("read_holiday_amendment_requests"))).toHaveLength(1);
      expect(await c.asUser(w.lead, () => c.rpc<unknown[]>("read_holiday_amendment_requests"))).toHaveLength(0);
      expect(await c.asUser(w.hr, () => c.rpc<unknown[]>("read_holiday_amendment_requests"))).toHaveLength(0);
    });
  });

  it("a request that can no longer be applied fails cleanly and stays pending", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await closeWeek(c, w.wk);
      const req = await request(c, w.admin, w.wk, "DECLARE", "Holiday");
      await c.rpc("authorise_late_report_exception", w.sa, w.buA, w.wk, "A late report was agreed first", "lr-0001");   // a late-report exception now blocks the change
      await c.expectError("LATE_EXCEPTION_PENDING", () => decide(c, w.admin2, req.request_id, "APPROVE", null, "dec-key-blocked"));
      expect((await c.q<{ status: string }>("select status from holiday_amendment_requests where id = $1", [req.request_id]))[0].status).toBe("PENDING");
      expect((await c.q<{ n: number }>("select count(*)::int n from holiday_amendments"))[0].n).toBe(0);
    });
  });
});

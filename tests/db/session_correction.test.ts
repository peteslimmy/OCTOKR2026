import { describe, expect, it } from "vitest";
import { seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("SC");
  const hr = await c.user(["HR"], bu, "hr");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const admin2 = await c.user(["ADMIN"], bu, "admin2");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  const session = await c.rpc<string>("create_governance_session", hr, wk);
  return { bu, hr, admin, admin2, sa, lead, strat, wk, session };
}
type W = Awaited<ReturnType<typeof world>>;
const rowsOf = async (c: Ctx, s: string) => (await c.q<{ n: number }>("select count(*)::int n from attendance_records where governance_session_id = $1", [s]))[0].n;
const hold = async (c: Ctx, w: W) => { await c.rpc("create_attendance_roster", w.hr, w.session); await c.rpc("finalize_attendance_roster", w.hr, w.session, true); };
const skip = async (c: Ctx, w: W) => c.rpc("skip_okr_session", w.hr, w.session, true, "skip-key-0001");
const sess = async (c: Ctx, s: string) => (await c.q<{ outcome: string; roster_status: string; correction_count: number; staff_tagged_count: number | null; skip_idempotency_key: string | null }>("select outcome, roster_status, correction_count, staff_tagged_count, skip_idempotency_key from governance_sessions where id = $1", [s]))[0];
interface Req { request_id: string; status: string; replayed: boolean }
const request = (c: Ctx, actor: string, s: string, reason = "Recorded against the wrong week", k = "sreq-key-0001") => c.rpc<Req>("request_session_correction", actor, s, reason, k);
const decide = (c: Ctx, actor: string, id: string, d: string, comment: string | null = null, k = "sdec-key-0001") => c.rpc<Record<string, unknown>>("decide_session_correction", actor, id, d, comment, k);
const execute = (c: Ctx, actor: string, id: string, k = "sexe-key-0001") => c.rpc<{ archived_rows: number; replayed: boolean }>("execute_session_correction", actor, id, k);

describe("session-outcome correction", () => {
  it("reopens a held session in three steps, archives the roster, and lets HR hold or skip it properly afterwards", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await hold(c, w);
      const staff = await rowsOf(c, w.session);
      expect(staff).toBeGreaterThanOrEqual(5);
      expect(await sess(c, w.session)).toMatchObject({ outcome: "HELD", roster_status: "FINALIZED" });
      const req = await request(c, w.hr, w.session);
      expect(await sess(c, w.session)).toMatchObject({ outcome: "HELD" });                    // asking changes nothing
      await decide(c, w.admin, req.request_id, "APPROVE", "Confirmed with the minutes");
      expect(await sess(c, w.session)).toMatchObject({ outcome: "HELD" });                    // nor does approving
      const done = await execute(c, w.admin2, req.request_id);
      expect(done.archived_rows).toBe(staff);
      expect(await sess(c, w.session)).toMatchObject({ outcome: "SCHEDULED", roster_status: "NONE", correction_count: 1 });
      expect(await rowsOf(c, w.session)).toBe(0);
      expect((await c.q<{ n: number; outcomes: string[] }>("select count(*)::int n, array_agg(distinct prior_outcome) outcomes from attendance_record_archive where governance_session_id = $1", [w.session]))[0]).toEqual({ n: staff, outcomes: ["HELD"] });
      expect((await c.q<{ action: string }>("select action from audit_logs where entity_type = 'session_outcome_correction' and entity_id = $1 order by seq", [req.request_id])).map((a) => a.action))
        .toEqual(["SESSION_CORRECTION_REQUESTED", "SESSION_CORRECTION_APPROVED", "SESSION_CORRECTION_EXECUTED"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'SESSION_OUTCOME_CORRECTED' and user_id = $1", [w.hr]))[0].n).toBeGreaterThanOrEqual(1);
      // HR can now do it properly: create a roster again and finalise, or skip
      await c.rpc("create_attendance_roster", w.hr, w.session);
      expect(await rowsOf(c, w.session)).toBe(staff);
      await c.rpc("finalize_attendance_roster", w.hr, w.session, true);
      expect(await sess(c, w.session)).toMatchObject({ outcome: "HELD", roster_status: "FINALIZED", correction_count: 1 });
    });
  });

  it("reopens a skipped session, tells Business Unit Leads, archives the virtual-present rows, and allows the skip key to be used again", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await skip(c, w);
      const tagged = (await sess(c, w.session)).staff_tagged_count;
      const req = await request(c, w.admin, w.session);
      await decide(c, w.sa, req.request_id, "APPROVE");
      await execute(c, w.admin2, req.request_id);
      expect(await sess(c, w.session)).toMatchObject({ outcome: "SCHEDULED", roster_status: "NONE", staff_tagged_count: null, skip_idempotency_key: null });
      expect((await c.q<{ status: string; source: string }>("select distinct status, source from attendance_record_archive where governance_session_id = $1", [w.session]))).toEqual([{ status: "VIRTUAL_PRESENT", source: "SKIP" }]);
      expect((await c.q<{ n: number }>("select count(*)::int n from attendance_record_archive where governance_session_id = $1", [w.session]))[0].n).toBe(tagged);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'SESSION_OUTCOME_CORRECTED' and user_id = $1", [w.lead]))[0].n).toBe(1);
      await skip(c, w);                                                                          // it can be skipped again, now on purpose
      expect(await sess(c, w.session)).toMatchObject({ outcome: "SKIPPED", correction_count: 1 });
    });
  });

  it("keeps the people apart and the steps in order", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await hold(c, w);
      const req = await request(c, w.admin, w.session);
      await c.expectError("SESSION_CORRECTION_SELF_APPROVAL", () => decide(c, w.admin, req.request_id, "APPROVE"));
      for (const actor of [w.hr, w.lead]) await c.expectError("PERMISSION_DENIED", () => decide(c, actor, req.request_id, "APPROVE", null, "dk-" + actor.slice(0, 6) + "xx"));   // HR asks but does not approve
      await c.expectError("SESSION_CORRECTION_NOT_APPROVED", () => execute(c, w.admin2, req.request_id));
      await c.expectError("VALIDATION_ERROR", () => decide(c, w.admin2, req.request_id, "MAYBE"));
      await c.expectError("REASON_REQUIRED", () => decide(c, w.admin2, req.request_id, "REJECT", " "));
      await decide(c, w.admin2, req.request_id, "APPROVE", null, "dec-once-0001");
      expect((await decide(c, w.admin2, req.request_id, "APPROVE", null, "dec-once-0001")).replayed).toBe(true);
      await c.expectError("SESSION_CORRECTION_NOT_PENDING", () => decide(c, w.sa, req.request_id, "REJECT", "late"));
      await c.expectError("SESSION_CORRECTION_SELF_APPROVAL", () => execute(c, w.admin, req.request_id));
      await c.expectError("PERMISSION_DENIED", () => execute(c, w.hr, req.request_id));
      await execute(c, w.sa, req.request_id, "exe-once-0001");
      expect((await execute(c, w.sa, req.request_id, "exe-once-0001")).replayed).toBe(true);
      expect((await sess(c, w.session)).correction_count).toBe(1);
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => decide(c, w.sa, req.request_id, "APPROVE", null, "dec-once-0001"));
    });
  });

  it("refuses a session with nothing to correct, one open request at a time, bad input and unauthorised callers; rejection frees the session", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("SESSION_NOT_CORRECTABLE", () => request(c, w.hr, w.session));      // still SCHEDULED
      await hold(c, w);
      await c.expectError("PERMISSION_DENIED", () => request(c, w.lead, w.session));
      await c.expectError("REASON_REQUIRED", () => request(c, w.hr, w.session, " "));
      await c.expectError("VALIDATION_ERROR", () => request(c, w.hr, w.session, "x", "short"));
      await c.expectError("NOT_FOUND", () => request(c, w.hr, "11111111-1111-4111-8111-111111111111"));
      const first = await request(c, w.hr, w.session, "First", "sreq-dup-0001");
      expect((await request(c, w.hr, w.session, "First", "sreq-dup-0001")).replayed).toBe(true);
      await c.expectError("SESSION_CORRECTION_PENDING", () => request(c, w.admin, w.session, "Second", "sreq-dup-0002"));
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => request(c, w.admin, w.session, "Second", "sreq-dup-0001"));
      await decide(c, w.admin, first.request_id, "REJECT", "The outcome is right");
      expect((await sess(c, w.session)).outcome).toBe("HELD");                                // a rejection changes nothing
      expect((await request(c, w.hr, w.session, "New evidence", "sreq-dup-0003")).status).toBe("PENDING");
    });
  });

  it("will not reopen a roster whose attendance amendments would be orphaned, and leaves everything as it was", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await hold(c, w);
      const rec = (await c.q<{ id: string }>("select id from attendance_records where governance_session_id = $1 limit 1", [w.session]))[0].id;
      await c.rpc("submit_attendance_amendment", w.hr, rec, "ABSENT", "Was actually absent", [{ ref: "doc-1" }], "amend-key-0001");
      const staff = await rowsOf(c, w.session);
      const req = await request(c, w.hr, w.session);
      await decide(c, w.admin, req.request_id, "APPROVE");
      await c.expectError("SESSION_CORRECTION_BLOCKED", () => execute(c, w.admin2, req.request_id));
      expect(await sess(c, w.session)).toMatchObject({ outcome: "HELD", roster_status: "FINALIZED", correction_count: 0 });
      expect(await rowsOf(c, w.session)).toBe(staff);
      expect((await c.q<{ n: number }>("select count(*)::int n from attendance_record_archive"))[0].n).toBe(0);                // nothing half-archived
      expect((await c.q<{ status: string }>("select status from session_outcome_corrections where id = $1", [req.request_id]))[0].status).toBe("APPROVED");
      await c.expectError("SESSION_CORRECTION_PENDING", () => c.rpc("emergency_session_correction", w.sa, w.session, "Trying the emergency route anyway", "em-blocked-0001"));   // an approved request is still open
    });
  });

  it("emergency: Super Admin only, one step, a full reason, alerted and audited, idempotent", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await skip(c, w);
      for (const actor of [w.admin, w.hr, w.lead]) await c.expectError("PERMISSION_DENIED", () => c.rpc("emergency_session_correction", actor, w.session, "Not allowed to do this", "em-" + actor.slice(0, 6) + "xxxx"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("emergency_session_correction", w.sa, w.session, "too short", "em-key-short1"));
      const open = await request(c, w.hr, w.session);
      await c.expectError("SESSION_CORRECTION_PENDING", () => c.rpc("emergency_session_correction", w.sa, w.session, "There is an open request first", "em-key-open01"));
      await decide(c, w.admin, open.request_id, "REJECT", "Superseded by an emergency");
      const em = await c.rpc<{ request_id: string; emergency: boolean; replayed: boolean }>("emergency_session_correction", w.sa, w.session, "The skip was entered by mistake on the wrong week", "em-key-0001");
      expect(em).toMatchObject({ emergency: true, replayed: false });
      expect(await sess(c, w.session)).toMatchObject({ outcome: "SCHEDULED", correction_count: 1 });
      expect((await c.q<{ action: string }>("select action from audit_logs where entity_type = 'session_outcome_correction' and entity_id = $1", [em.request_id])).map((a) => a.action)).toEqual(["SESSION_CORRECTION_EMERGENCY"]);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'SESSION_CORRECTION_EMERGENCY' and user_id = any($1)", [[w.hr, w.admin]]))[0].n).toBe(2);
      expect((await c.q<{ n: number }>("select count(*)::int n from notifications where event_type = 'SESSION_CORRECTION_EMERGENCY' and user_id = $1", [w.sa]))[0].n).toBe(0);
      expect((await c.rpc<{ replayed: boolean }>("emergency_session_correction", w.sa, w.session, "The skip was entered by mistake on the wrong week", "em-key-0001")).replayed).toBe(true);
      expect((await sess(c, w.session)).correction_count).toBe(1);
      await c.expectError("SESSION_NOT_CORRECTABLE", () => c.rpc("emergency_session_correction", w.sa, w.session, "Nothing left to correct now", "em-key-0002"));
    });
  });

  it("leaves roster rows immutable for everything else, keeps history immutable, and shows requests only to the people involved", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await hold(c, w);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from attendance_records where governance_session_id = $1", [w.session]));    // the narrow exception is not open by default
      const req = await request(c, w.hr, w.session);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update session_outcome_corrections set reason = 'edited' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update session_outcome_corrections set status = 'EXECUTED' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from session_outcome_corrections where id = $1", [req.request_id]));
      await decide(c, w.admin, req.request_id, "APPROVE"); await execute(c, w.admin2, req.request_id);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update attendance_record_archive set status = 'ABSENT'"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from attendance_record_archive"));
      expect(await c.asUser(w.hr, () => c.rpc<unknown[]>("read_session_corrections"))).toHaveLength(1);
      expect(await c.asUser(w.admin, () => c.rpc<unknown[]>("read_session_corrections"))).toHaveLength(1);
      await c.expectError("PERMISSION_DENIED", () => c.asUser(w.lead, () => c.rpc("read_session_corrections")));
    });
  });
});

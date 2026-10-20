import { describe, expect, it } from "vitest";
import { draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");              // isolate from any dev data in this rolled-back transaction
  await c.q("update employees set employment_status = 'INACTIVE'");
  const bu = await c.bu("ATT" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr");
  const hr2 = await c.user(["HR"], bu, "hr2");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const staff = await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'staff1@t.local', 'Sta', 'One', $2), ($1, 'staff2@t.local', 'Sta', 'Two', $2) returning id", [c.org, bu]);
  await c.q("insert into employees (organisation_id, email, first_name, last_name, business_unit_id, employment_status) values ($1, 'gone@t.local', 'Gone', 'Away', $2, 'INACTIVE')", [c.org, bu]);
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow("2031-01-14T09:00:00+01:00"); // Tuesday of week 2: session day for week 1
  const session = await c.rpc<string>("create_governance_session", hr, wk);
  return { bu, hr, hr2, admin, lead, staff, strat, wk, session };
}
const count = async (c: Ctx, sql: string, p: unknown[] = []) => (await c.q<{ n: number }>(`select count(*)::int n from (${sql}) t`, p))[0].n;

describe("weekly roster (FR-ATT-002/003/004)", () => {
  it("snapshots every ACTIVE employee as PRESENT on the server, excludes inactive staff, and needs the permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_attendance_roster", w.lead, w.session));
      const r = await c.rpc<{ staff_count: number }>("create_attendance_roster", w.hr, w.session);
      expect(r.staff_count).toBe(6); // hr, hr2, admin, lead + 2 staff; the inactive employee is excluded
      const rows = await c.q("select status, source from attendance_records where governance_session_id = $1", [w.session]);
      expect(rows.every((x) => x.status === "PRESENT" && x.source === "ROSTER")).toBe(true);
      const again = await c.rpc<{ created: boolean }>("create_attendance_roster", w.hr, w.session);
      expect(again.created).toBe(false); // idempotent: no duplicate rows
      expect(await count(c, "select 1 from attendance_records where governance_session_id = $1", [w.session])).toBe(6);
      expect((await c.q("select action from audit_logs where action = 'ATTENDANCE_ROSTER_CREATED'")).length).toBe(1);
    });
  });

  it("a person with a sign-in can be left off the roster, by someone who manages users; the choice is audited and leaves existing rosters alone", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const [s1, s2] = w.staff.map((s) => s.id);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("set_employee_roster", w.hr, s1, false));
      await c.rpc("set_employee_roster", w.admin, s1, false);
      await c.rpc("set_employee_roster", w.admin, s1, false);                                    // no change, no second audit entry
      expect((await c.q("select 1 from audit_logs where action = 'EMPLOYEE_ROSTER_CHANGED'")).length).toBe(1);
      const r = await c.rpc<{ staff_count: number }>("create_attendance_roster", w.hr, w.session);
      expect(r.staff_count).toBe(5);                                                              // the same world as above, minus the one taken off
      expect((await c.q("select 1 from attendance_records where employee_id = $1", [s1])).length).toBe(0);
      expect((await c.q("select 1 from attendance_records where employee_id = $1", [s2])).length).toBe(1);
      await c.rpc("set_employee_roster", w.admin, s1, true);
      expect((await c.q("select 1 from attendance_records where employee_id = $1", [s1])).length).toBe(0);   // an existing roster is not changed
    });
  });

  it("HR toggles exceptions in DRAFT; VIRTUAL_PRESENT cannot be chosen manually; finalisation needs confirmation and freezes the roster", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("create_attendance_roster", w.hr, w.session);
      const [a, b] = (await c.q<{ id: string }>("select id from attendance_records where employee_id = any($1) order by employee_id", [w.staff.map((s) => s.id)])).map((r) => r.id);
      await c.rpc("set_attendance_status", w.hr, a, "ON_LEAVE", "annual leave");
      await c.rpc("set_attendance_status", w.hr, b, "ABSENT", null);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_attendance_status", w.hr, a, "VIRTUAL_PRESENT", null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("set_attendance_status", w.hr, a, "NOT_A_STATUS", null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("finalize_attendance_roster", w.hr, w.session, false));
      const fin = await c.rpc<{ counts: Record<string, number> }>("finalize_attendance_roster", w.hr, w.session, true);
      expect(fin.counts).toEqual({ PRESENT: 4, ON_LEAVE: 1, ABSENT: 1 });
      expect((await c.q("select outcome, roster_status from governance_sessions where id = $1", [w.session]))[0]).toEqual({ outcome: "HELD", roster_status: "FINALIZED" });
      // immutable through the RPC and directly in the database (AC-ATT-001)
      await c.expectError("IMMUTABLE_RECORD", () => c.rpc("set_attendance_status", w.hr, a, "PRESENT", null));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update attendance_records set status = 'PRESENT' where id = $1", [a]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from attendance_records where id = $1", [a]));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("finalize_attendance_roster", w.hr, w.session, true));
      await c.expectError("ATTENDANCE_SESSION_NOT_SKIPPABLE", () => c.rpc("skip_okr_session", w.hr, w.session, true, "k1"));
    });
  });
});

describe("Skip OKR for this week (FR-ATT-006/009, AC-ATT-010)", () => {
  it("atomically marks the session SKIPPED and every active staff member VIRTUAL_PRESENT, notifies all BU Leads, audits, and is idempotent", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("create_attendance_roster", w.hr, w.session);          // an unfinalised draft is replaced, not mixed in
      const [a] = (await c.q<{ id: string }>("select id from attendance_records limit 1")).map((r) => r.id);
      await c.rpc("set_attendance_status", w.hr, a, "ABSENT", null);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("skip_okr_session", w.lead, w.session, true, "k0"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("skip_okr_session", w.hr, w.session, false, "k0"));
      const r1 = await c.rpc<{ staff_tagged: number; replayed: boolean }>("skip_okr_session", w.hr, w.session, true, "skip-key-1");
      expect(r1).toMatchObject({ staff_tagged: 6, replayed: false });
      const rows = await c.q("select status, source from attendance_records where governance_session_id = $1", [w.session]);
      expect(rows).toHaveLength(6);
      expect(rows.every((x) => x.status === "VIRTUAL_PRESENT" && x.source === "SKIP")).toBe(true);
      expect((await c.q("select outcome, roster_status from governance_sessions where id = $1", [w.session]))[0]).toEqual({ outcome: "SKIPPED", roster_status: "FINALIZED" });
      expect((await c.q("select count(*)::int n from notifications where event_type = 'OKR_SESSION_SKIPPED' and user_id = $1", [w.lead]))[0].n).toBe(1);
      expect((await c.q("select count(*)::int n from audit_logs where action = 'OKR_SESSION_SKIPPED'"))[0].n).toBe(1);
      // retry: same result, no duplicate rows/notifications/audit
      const r2 = await c.rpc<{ replayed: boolean; staff_tagged: number }>("skip_okr_session", w.hr, w.session, true, "skip-key-1");
      expect(r2).toMatchObject({ replayed: true, staff_tagged: 6 });
      expect((await c.q("select count(*)::int n from attendance_records where governance_session_id = $1", [w.session]))[0].n).toBe(6);
      expect((await c.q("select count(*)::int n from audit_logs where action = 'OKR_SESSION_SKIPPED'"))[0].n).toBe(1);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("skip_okr_session", w.hr, w.session, true, "different-key"));
      // generated rows are never individually editable; no CANCELLED outcome exists
      const gen = (await c.q<{ id: string }>("select id from attendance_records where governance_session_id = $1 limit 1", [w.session]))[0].id;
      await c.expectError("IMMUTABLE_RECORD", () => c.rpc("set_attendance_status", w.hr, gen, "PRESENT", null));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update attendance_records set status = 'ABSENT' where governance_session_id = $1", [w.session]));
      await c.expectError("new row for relation", () => c.q("update governance_sessions set outcome = 'CANCELLED' where id = $1", [w.session]));
    });
  });

  it("is all-or-nothing: a failure part-way leaves no SKIPPED session and no partial rows", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q(`create function boom() returns trigger language plpgsql as $$ begin if new.status = 'VIRTUAL_PRESENT' and new.employee_id = '${w.staff[1].id}' then raise exception 'BOOM'; end if; return new; end $$`);
      await c.q("create trigger boom_t before insert on attendance_records for each row execute function boom()");
      await c.expectError("BOOM", () => c.rpc("skip_okr_session", w.hr, w.session, true, "k-boom"));
      expect((await c.q("select outcome, roster_status from governance_sessions where id = $1", [w.session]))[0]).toEqual({ outcome: "SCHEDULED", roster_status: "NONE" });
      expect((await c.q("select count(*)::int n from attendance_records where governance_session_id = $1", [w.session]))[0].n).toBe(0);
      expect((await c.q("select count(*)::int n from audit_logs where action = 'OKR_SESSION_SKIPPED'"))[0].n).toBe(0); // no success logged on failure
    });
  });

  it("creates no absence violation, does not waive weekly reporting, and requires the manual summary", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("skip_okr_session", w.hr, w.session, true, "k1");
      const vt = await c.rpc<string>("create_violation_type", w.hr, "LATE", "Late arrival", "LOW", 500);
      await c.expectError("VIOLATION_NOT_ALLOWED_SKIPPED_SESSION", () => c.rpc("create_violation", w.hr, w.staff[0].id, w.session, vt, null, null, null, "v-skip"));
      // the weekly report is still mandatory and needs the manual summary
      await c.setNow("2031-01-08T09:00:00+01:00");
      await c.q("update reporting_weeks set status = status where id = $1", [w.wk]);
      const buLeadReport = await (async () => { await c.setNow("2031-01-07T09:00:00+01:00"); return draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0]); })();
      await c.expectError("SUBMISSION_BLOCKED", () => c.rpc("submit_weekly_report", w.lead, buLeadReport.reportId, null, null));
      await c.rpc("submit_weekly_report", w.lead, buLeadReport.reportId, "We closed two renewals and shipped the pricing sheet.", null);
    });
  });

  it("is refused for an Organization Holiday week (different state, never conflated)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow("2031-01-05T09:00:00+01:00");
      await c.rpc("declare_organization_holiday", w.hr, [w.wk], "Closure", "hol-1");
      await c.expectError("REPORTING_NOT_REQUIRED", () => c.rpc("skip_okr_session", w.hr, w.session, true, "k1"));
      expect((await c.q("select count(*)::int n from attendance_records"))[0].n).toBe(0); // holiday never creates VIRTUAL_PRESENT rows
    });
  });
});

describe("attendance amendments (ADR-031, AC-ATT-002..009)", () => {
  async function finalised(c: Ctx) {
    const w = await world(c);
    await c.rpc("create_attendance_roster", w.hr, w.session);
    const rec = (await c.q<{ id: string }>("select id from attendance_records where employee_id = $1", [w.staff[0].id]))[0].id;
    await c.rpc("finalize_attendance_roster", w.hr, w.session, true);
    return { ...w, rec };
  }

  it("HR can request any time with a mandatory reason; effective status is unchanged until an independent approval; source never changes", async () => {
    await withTx(async (c) => {
      const w = await finalised(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("submit_attendance_amendment", w.lead, w.rec, "ILL", "was ill", null, "a1"));
      await c.expectError("ATTENDANCE_AMENDMENT_REASON_REQUIRED", () => c.rpc("submit_attendance_amendment", w.hr, w.rec, "ILL", "   ", null, "a1"));
      await c.setNow("2032-06-01T09:00:00+01:00"); // no deadline window
      const req = await c.rpc<{ request_id: string; status: string }>("submit_attendance_amendment", w.hr, w.rec, "ILL", "Sick note received", [{ ref: "doc-123" }], "a1");
      expect(req.status).toBe("PENDING");
      expect(await c.q("select attendance_effective_status($1) s", [w.rec])).toEqual([{ s: "PRESENT" }]);
      await c.expectError("ATTENDANCE_AMENDMENT_ALREADY_PENDING", () => c.rpc("submit_attendance_amendment", w.hr2, w.rec, "ABSENT", "other", null, "a2"));
      expect((await c.rpc<{ replayed: boolean }>("submit_attendance_amendment", w.hr, w.rec, "ILL", "Sick note received", [{ ref: "doc-123" }], "a1")).replayed).toBe(true);
      expect((await c.q("select count(*)::int n from notifications where event_type = 'ATTENDANCE_AMENDMENT_SUBMITTED' and user_id = $1", [w.admin]))[0].n).toBe(1);

      await c.expectError("PERMISSION_DENIED", () => c.rpc("decide_attendance_amendment", w.hr2, req.request_id, true, null, "d1")); // no approve permission
      const ok = await c.rpc<{ status: string }>("decide_attendance_amendment", w.admin, req.request_id, true, null, "d1");
      expect(ok.status).toBe("APPROVED");
      expect(await c.q("select attendance_effective_status($1) s", [w.rec])).toEqual([{ s: "ILL" }]);
      expect((await c.q("select status from attendance_records where id = $1", [w.rec]))[0].status).toBe("PRESENT"); // original preserved
      expect((await c.rpc<{ replayed: boolean }>("decide_attendance_amendment", w.admin, req.request_id, true, null, "d1")).replayed).toBe(true);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("decide_attendance_amendment", w.admin, req.request_id, false, "x", "d2")); // terminal: never reopened
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update attendance_amendment_requests set reason = 'changed' where id = $1", [req.request_id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from attendance_amendment_events"));
      const trail = (await c.q("select event_type from attendance_amendment_events where request_id = $1 order by created_at", [req.request_id])).map((e) => e.event_type);
      expect(trail).toEqual(["SUBMITTED", "APPROVED"]);
      expect((await c.q("select count(*)::int n from notifications where event_type = 'ATTENDANCE_AMENDMENT_APPROVED' and user_id = $1", [w.hr]))[0].n).toBe(1);
      // a further correction is a NEW request against the current effective value
      const again = await c.rpc<{ status: string }>("submit_attendance_amendment", w.hr, w.rec, "EXCUSED", "Manager confirmed", null, "a3");
      expect(again.status).toBe("PENDING");
    });
  });

  it("self-approval is impossible even when the requester holds both permissions (designated approver); rejection is audited and notifies", async () => {
    await withTx(async (c) => {
      const w = await finalised(c);
      await c.rpc("set_user_permission", await c.user(["SUPER_ADMIN"], w.bu, "sa"), w.hr, "attendance.amendment.approve", true); // "designated HR approver"
      const req = await c.rpc<{ request_id: string }>("submit_attendance_amendment", w.hr, w.rec, "ABSENT", "wrongly marked present", null, "b1");
      await c.expectError("ATTENDANCE_AMENDMENT_SELF_APPROVAL", () => c.rpc("decide_attendance_amendment", w.hr, req.request_id, true, null, "d1"));
      await c.expectError("ATTENDANCE_AMENDMENT_SELF_APPROVAL", () => c.rpc("decide_attendance_amendment", w.hr, req.request_id, false, "x", "d2"));
      // another designated HR approver may decide; the rejection reason is optional (DEC-016 unresolved)
      await c.rpc("set_user_permission", await c.user(["SUPER_ADMIN"], w.bu, "sa2"), w.hr2, "attendance.amendment.approve", true);
      const rej = await c.rpc<{ status: string }>("decide_attendance_amendment", w.hr2, req.request_id, false, null, "d3");
      expect(rej.status).toBe("REJECTED");
      expect(await c.q("select attendance_effective_status($1) s", [w.rec])).toEqual([{ s: "PRESENT" }]);
      expect((await c.q("select count(*)::int n from audit_logs where action = 'ATTENDANCE_AMENDMENT_REJECTED'"))[0].n).toBe(1);
      expect((await c.q("select count(*)::int n from notifications where event_type = 'ATTENDANCE_AMENDMENT_REJECTED' and user_id = $1", [w.hr]))[0].n).toBe(1);
      // the table itself also refuses requester == decider
      const r2 = await c.rpc<{ request_id: string }>("submit_attendance_amendment", w.hr, w.rec, "ILL", "second try", null, "b2");
      await c.expectError("new row for relation", () => c.q("update attendance_amendment_requests set status = 'APPROVED', decided_by = requested_by, decided_at = now() where id = $1", [r2.request_id]));
    });
  });

  it("a stale snapshot is not applied: it is recorded as STALE_REJECTED and the requester must resubmit", async () => {
    await withTx(async (c) => {
      const w = await finalised(c);
      const req = await c.rpc<{ request_id: string }>("submit_attendance_amendment", w.hr, w.rec, "ABSENT", "fix", null, "s1");
      await c.q("update attendance_amendment_requests set effective_status_snapshot = 'ON_LEAVE' where id = $1", [req.request_id]); // simulate a changed effective value
      const res = await c.rpc<{ status: string }>("decide_attendance_amendment", w.admin, req.request_id, true, null, "d1");
      expect(res.status).toBe("STALE_REJECTED");
      expect(await c.q("select attendance_effective_status($1) s", [w.rec])).toEqual([{ s: "PRESENT" }]);
      expect((await c.q("select event_type from attendance_amendment_events where request_id = $1 order by created_at", [req.request_id])).map((e) => e.event_type)).toEqual(["SUBMITTED", "STALE_REJECTED"]);
    });
  });

  it("skip-generated rows are not individually amendable; draft rosters cannot be amended (use the editor)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("create_attendance_roster", w.hr, w.session);
      const rec = (await c.q<{ id: string }>("select id from attendance_records limit 1"))[0].id;
      await c.expectError("ATTENDANCE_SESSION_NOT_AMENDABLE", () => c.rpc("submit_attendance_amendment", w.hr, rec, "ABSENT", "r", null, "d1"));
      await c.rpc("skip_okr_session", w.hr, w.session, true, "k1");
      const rec2 = (await c.q<{ id: string }>("select id from attendance_records limit 1"))[0].id;
      await c.expectError("ATTENDANCE_SESSION_NOT_AMENDABLE", () => c.rpc("submit_attendance_amendment", w.hr, rec2, "ABSENT", "r", null, "d2"));
    });
  });
});

describe("attendance data security (RLS)", () => {
  it("BU Leads and Executives cannot read attendance; HR can; weekly quote is recorded once per week", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("create_attendance_roster", w.hr, w.session);
      const exec = await c.user(["EXECUTIVE"], w.bu, "exec");
      expect(await c.asUser(w.lead, () => c.q("select id from attendance_records"))).toEqual([]);
      expect(await c.asUser(exec, () => c.q("select id from attendance_records"))).toEqual([]);
      expect((await c.asUser(w.hr, () => c.q("select id from attendance_records"))).length).toBe(6);
      await c.expectError("permission denied", () => c.asUser(w.hr, () => c.q("update attendance_records set status = 'ABSENT'")));
      const roster = await c.asUser(w.hr, () => c.rpc<{ tally: Record<string, number> }>("read_session_roster", w.session));
      expect(roster.tally).toEqual({ PRESENT: 6 });
      await c.rpc("record_weekly_quote", w.hr, w.wk, w.bu, "Ada Lovelace", "Ship small, ship often.");
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_weekly_quote", w.hr, w.wk, w.bu, "Someone", "Again"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("record_weekly_quote", w.lead, w.wk, w.bu, "X", "Y"));
    });
  });
});

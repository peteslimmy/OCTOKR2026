import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/** BU A files nothing; the week final-locks so A holds a 0.00 missing-report snapshot. Q1 2031 is optionally locked. */
async function world(c: Ctx, lockQuarter = false) {
  const buA = await c.bu("ALPHA");
  const buB = await c.bu("BRAVO");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa");
  const presenter = await c.user(["PRESENTER"], buA, "presenter");
  const hr = await c.user(["HR"], buA, "hr");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA");
  const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.finalLock);
  await c.rpc("finalize_reporting_week", wk);
  if (lockQuarter) {
    await c.setNow("2031-04-02T09:00:00+01:00");
    await c.rpc("roll_quarters");
  }
  return { buA, buB, admin, sa, presenter, hr, leadA, leadB, strat, wk, quarterId: strat.quarterId };
}

async function authorise(c: Ctx, w: Awaited<ReturnType<typeof world>>, key = "auth-1") {
  const r = await c.rpc<{ exception_id: string }>("authorise_late_report_exception", w.admin, w.buA, w.wk, "Network outage on 7 Jan prevented filing", key);
  return r.exception_id;
}

/** BU lead files a complete late report (1 goal, 2 tasks, both DONE) and submits it. */
async function fileLate(c: Ctx, w: Awaited<ReturnType<typeof world>>) {
  const { reportId, goalId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["t1", "t2"], "Ship the pricing sheets by Friday");
  const tasks = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 order by position", [goalId])).map((t) => t.id);
  return { reportId, goalId, tasks };
}

describe("late-report score amendment (ADR-032, AC-SC-014)", () => {
  it("full flow after quarter lock: authorise → file → submit → review → apply creates new versions and keeps originals", async () => {
    await withTx(async (c) => {
      const w = await world(c, true);
      expect((await c.q("select status from quarters where id = $1", [w.quarterId]))[0].status).toBe("LOCKED");
      const originalWeekly = (await c.q("select * from weekly_score_snapshots where business_unit_id = $1 and reporting_week_id = $2", [w.buA, w.wk]));
      expect(originalWeekly).toHaveLength(1);
      expect(Number(originalWeekly[0].final_score)).toBe(0);
      const q1 = (await c.q("select * from quarterly_score_snapshots where quarter_id = $1 and business_unit_id = $2 order by version_number desc", [w.quarterId, w.buA]))[0];

      const cand = await c.asUser(w.admin, () => c.rpc<{ business_unit_id: string; reporting_week_id: string }[]>("read_late_report_candidates"));
      expect(cand.some((x) => x.business_unit_id === w.buA && x.reporting_week_id === w.wk)).toBe(true);

      const ex = await authorise(c, w);
      // the quarter stays locked for ordinary work
      await c.expectError("QUARTER_LOCKED", () => c.rpc("update_objective", w.admin, w.strat.objectiveId, "Changed title", null));

      const { reportId, tasks } = await fileLate(c, w);
      await c.expectError("SUBMISSION_BLOCKED", () => c.rpc("submit_weekly_report", w.leadA, reportId, null, null)); // tasks UNDEFINED
      for (const t of tasks) await c.rpc("execute_task", w.leadA, t, "DONE");
      await c.rpc("submit_weekly_report", w.leadA, reportId, null, null);
      expect((await c.q("select status from late_report_exceptions where id = $1", [ex]))[0].status).toBe("SUBMITTED");
      const goalRow = (await c.q<{ id: string }>("select id from smart_goals where weekly_report_id = $1", [reportId]))[0].id;
      await c.expectError("REPORT_FINAL_LOCKED", () => c.rpc("create_task", w.leadA, goalRow, "late addition", null));

      await c.expectError("LATE_REPORT_NOT_REVIEWED", () => c.rpc("apply_late_report_amendment", w.sa, ex, "Accepted", "apply-1"));
      await c.rpc("review_weekly_report", w.admin, reportId);
      await c.expectError("LATE_AMENDMENT_SEGREGATION", () => c.rpc("apply_late_report_amendment", w.admin, ex, "Accepted", "apply-x"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("apply_late_report_amendment", w.presenter, ex, "Accepted", "apply-y"));

      const res = await c.rpc<{ new_weekly_score: string; old_quarterly_score: string; new_quarterly_score: string; new_quarterly_version: number; amendment_id: string }>(
        "apply_late_report_amendment", w.sa, ex, "Late report verified and accepted", "apply-1");
      expect(Number(res.new_weekly_score)).toBe(100);
      expect(Number(res.new_quarterly_score)).toBeGreaterThan(Number(res.old_quarterly_score));

      // history is preserved and a new version exists
      const weekly = await c.q("select version_number, score_state, final_score, reason from weekly_score_snapshots where business_unit_id = $1 and reporting_week_id = $2 order by version_number", [w.buA, w.wk]);
      expect(weekly.map((x) => [x.version_number, x.score_state, Number(x.final_score), x.reason])).toEqual([
        [1, "NOT_SUBMITTED", 0, "FINAL_LOCK"], [2, "SCORED", 100, "LATE_REPORT_AMENDMENT"]]);
      const qs = await c.q("select * from quarterly_score_snapshots where quarter_id = $1 and business_unit_id = $2 order by version_number", [w.quarterId, w.buA]);
      const last = qs[qs.length - 1];
      expect(last.source).toBe("AMENDMENT");
      expect(last.prior_snapshot_id).toBe(q1.id);
      expect(last.denominator_count).toBe(q1.denominator_count);            // fixed denominator is unchanged
      expect(Number(last.numerator)).toBe(Number(q1.numerator) + 100);
      expect(qs.find((x) => x.id === q1.id)).toBeTruthy();                   // prior published snapshot untouched
      const am = (await c.q("select * from quarterly_score_amendments where exception_id = $1", [ex]))[0];
      expect(am.quarter_locked_at_apply).toBe(true);
      expect([Number(am.old_weekly_score), Number(am.new_weekly_score)]).toEqual([0, 100]);
      expect(am.authorised_by).toBe(w.admin); expect(am.reviewed_by).toBe(w.admin); expect(am.applied_by).toBe(w.sa);
      // historical compliance is not silently rewritten
      expect((await c.q("select status from weekly_compliance where business_unit_id = $1 and reporting_week_id = $2", [w.buA, w.wk]))[0].status).toBe("NON_COMPLIANT");

      // immutability
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update quarterly_score_amendments set reason = 'x' where id = $1", [am.id]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update weekly_score_snapshots set final_score = 50 where business_unit_id = $1 and version_number = 1", [w.buA]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from late_report_exception_events"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update late_report_exceptions set reason = 'edited' where id = $1", [ex]));
      // the report is final-locked again and the week cannot be amended twice
      expect((await c.q("select status from weekly_reports where id = $1", [reportId]))[0].status).toBe("FINAL_LOCKED");
      await c.expectError("LATE_EXCEPTION_NOT_APPLICABLE", () => c.rpc("authorise_late_report_exception", w.admin, w.buA, w.wk, "again", "auth-2"));
      // audit trail
      const actions = (await c.q<{ action: string }>("select action from audit_logs where entity_id in ($1, $2) order by seq", [ex, String(am.id)])).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["LATE_REPORT_AUTHORISED", "QUARTER_SCORE_AMENDED"]));
      // idempotent replay
      const again = await c.rpc<{ replayed: boolean }>("apply_late_report_amendment", w.sa, ex, "Late report verified and accepted", "apply-1");
      expect(again.replayed).toBe(true);
      expect((await c.q("select count(*)::int n from quarterly_score_snapshots where quarter_id = $1 and business_unit_id = $2", [w.quarterId, w.buA]))[0].n).toBe(qs.length);
    });
  });

  it("is permission-gated, reason-required, idempotent, and only for missing reports in finalised weeks", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const actor of [w.leadA, w.presenter, w.hr]) {
        await c.expectError("PERMISSION_DENIED", () => c.rpc("authorise_late_report_exception", actor, w.buA, w.wk, "reason", "k-" + actor.slice(0, 4)));
      }
      await c.expectError("REASON_REQUIRED", () => c.rpc("authorise_late_report_exception", w.admin, w.buA, w.wk, "  ", "k-blank"));
      const a = await c.rpc<{ exception_id: string; replayed: boolean }>("authorise_late_report_exception", w.admin, w.buA, w.wk, "Outage", "k1");
      const b = await c.rpc<{ exception_id: string; replayed: boolean }>("authorise_late_report_exception", w.admin, w.buA, w.wk, "Outage", "k1");
      expect(b.replayed).toBe(true); expect(b.exception_id).toBe(a.exception_id);
      await c.expectError("LATE_EXCEPTION_ALREADY_EXISTS", () => c.rpc("authorise_late_report_exception", w.sa, w.buA, w.wk, "Outage", "k2"));
      // future / open week is not applicable
      const nextMonday = await weekId(c, "2031-01-13");
      await c.expectError("LATE_EXCEPTION_NOT_APPLICABLE", () => c.rpc("authorise_late_report_exception", w.admin, w.buA, nextMonday, "x", "k3"));
    });
  });

  it("refuses a BU that already submitted, a holiday week and other BUs' reports", async () => {
    await withTx(async (c) => {
      const buA = await c.bu("ALPHA"); const buB = await c.bu("BRAVO");
      const admin = await c.user(["ADMIN"], buA, "admin"); const leadA = await c.user(["BU_LEAD"], buA, "leadA"); const leadB = await c.user(["BU_LEAD"], buB, "leadB");
      const strat = await seedStrategy(c, admin); const wk = await weekId(c);
      await c.setNow(W1.open);
      const { reportId, tasks } = await (async () => { const d = await draftGoal(c, leadA, wk, strat.subKrIds[0], ["t"], "Ship it by Friday"); return { reportId: d.reportId, tasks: [] as string[] }; })();
      void tasks;
      await c.rpc("submit_weekly_report", leadA, reportId, null, null);
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", wk);
      await c.expectError("LATE_EXCEPTION_NOT_APPLICABLE", () => c.rpc("authorise_late_report_exception", admin, buA, wk, "x", "s1")); // submitted → scored
      // BU B missed it: only B's own lead may start the late report, and A's lead is refused
      await c.rpc("authorise_late_report_exception", admin, buB, wk, "Illness", "s2");
      await c.rpc("get_or_create_weekly_report", leadB, wk);
      const repB = (await c.q<{ id: string }>("select id from weekly_reports where business_unit_id = $1", [buB]))[0].id;
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("acquire_edit_lease", leadA, repB, 300));
    });
  });

  it("revoking relocks the report and a revoked exception cannot be applied", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const ex = await authorise(c, w);
      const { reportId } = await fileLate(c, w);
      await c.rpc("revoke_late_report_exception", w.admin, ex, "Authorised in error");
      expect((await c.q("select status from weekly_reports where id = $1", [reportId]))[0].status).toBe("FINAL_LOCKED");
      await c.expectError("REPORT_FINAL_LOCKED", () => c.rpc("acquire_edit_lease", w.leadA, reportId, 300));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("apply_late_report_amendment", w.sa, ex, "x", "ap"));
      // scores untouched
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where business_unit_id = $1 and reporting_week_id = $2", [w.buA, w.wk]))[0].n).toBe(1);
      // a new authorisation is possible after revocation
      await c.rpc("authorise_late_report_exception", w.admin, w.buA, w.wk, "Second chance", "auth-again");
    });
  });

  it("a draft frozen at final lock is reopened only by the exception, and plain final-locked reports remain immutable", async () => {
    await withTx(async (c) => {
      const buA = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], buA, "admin"); const leadA = await c.user(["BU_LEAD"], buA, "leadA");
      const strat = await seedStrategy(c, admin); const wk = await weekId(c);
      await c.setNow(W1.open);
      const { reportId } = await draftGoal(c, leadA, wk, strat.subKrIds[0], ["t"], "Ship it by Friday"); // never submitted
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", wk);
      expect((await c.q("select status from weekly_reports where id = $1", [reportId]))[0].status).toBe("FINAL_LOCKED");
      await c.expectError("REPORT_FINAL_LOCKED", () => c.q("update weekly_reports set status = 'OPEN' where id = $1", [reportId]));
      await c.expectError("REPORT_FINAL_LOCKED", () => c.rpc("acquire_edit_lease", leadA, reportId, 300));
      const ex = (await c.rpc<{ exception_id: string }>("authorise_late_report_exception", admin, buA, wk, "Draft was stuck", "d1")).exception_id;
      expect((await c.q("select status, late_exception_id from weekly_reports where id = $1", [reportId]))[0]).toEqual({ status: "OPEN", late_exception_id: ex });
      await c.rpc("acquire_edit_lease", leadA, reportId, 300); // now allowed
      const view = await c.asUser(leadA, () => c.rpc<{ phase: string; late_exception: { id: string } | null }>("read_report_view", reportId));
      expect(view.phase).toBe("LATE_OPEN");
      expect(view.late_exception?.id).toBe(ex);
    });
  });

  it("direct table writes by users are impossible (RLS select-only) and BU scoping applies to reads", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const ex = await authorise(c, w);
      await c.expectError("permission denied", () => c.asUser(w.admin, () => c.q("update late_report_exceptions set status = 'APPLIED' where id = $1", [ex])));
      await c.expectError("permission denied", () => c.asUser(w.leadA, () => c.rpc("apply_late_report_amendment", w.leadA, ex, "x", "k")));
      const seenB = await c.asUser(w.leadB, () => c.q("select id from late_report_exceptions"));
      expect(seenB).toHaveLength(0);
      const seenA = await c.asUser(w.leadA, () => c.q("select id from late_report_exceptions"));
      expect(seenA).toHaveLength(1);
      // the read model must still return the BU Lead's own exception even though they cannot read the authoriser's user row
      const modelA = await c.asUser(w.leadA, () => c.rpc<{ id: string; authorised_by: string }[]>("read_late_report_exceptions"));
      expect(modelA).toHaveLength(1);
      expect(modelA[0].authorised_by).toBe("Administrator");
      expect(await c.asUser(w.leadB, () => c.rpc<unknown[]>("read_late_report_exceptions"))).toHaveLength(0);
    });
  });
});

import { describe, expect, it } from "vitest";
import { W1, amendClosed, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const buA = await c.bu("ALPHA");
  const buB = await c.bu("BRAVO");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa");
  const hr = await c.user(["HR"], buA, "hr");
  const presenter = await c.user(["PRESENTER"], buA, "presenter");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  return { buA, buB, admin, sa, hr, presenter, leadA, strat, wk, quarterId: strat.quarterId };
}

interface QSnap {
  id: string; version_number: number; source: string; holiday_amendment_id: string | null; excluded_holiday_count: number; denominator_count: number;
  numerator: string; missing_report_zero_count: number; prior_snapshot_id: string | null;
}
const latestQ = async (c: Ctx, quarterId: string, bu: string) =>
  (await c.q<QSnap>("select * from quarterly_score_snapshots where quarter_id = $1 and business_unit_id = $2 order by version_number desc limit 1", [quarterId, bu]))[0];

describe("holiday amendment (post-lock declaration)", () => {
  it("declares a final-locked, partly-submitted week a holiday: new quarterly versions, history untouched", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.open);
      const { reportId, goalId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["t1"], "Ship the pricing sheets by Friday");
      await c.rpc("submit_weekly_report", w.leadA, reportId, null, null);
      await c.setNow(W1.afterContentLock);
      const t = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1", [goalId]))[0].id;
      await c.rpc("execute_task", w.leadA, t, "DONE");
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const beforeA = await latestQ(c, w.quarterId, w.buA);
      const beforeB = await latestQ(c, w.quarterId, w.buB);
      expect(Number(beforeA.numerator)).toBe(100);
      expect(Number(beforeB.numerator)).toBe(0);

      // the ordinary route still refuses a locked week
      await c.expectError("HOLIDAY_AMENDMENT_REQUIRED", () => c.rpc("declare_organization_holiday", w.hr, [w.wk], "Public holiday", "ord-1"));
      // holiday-manage alone is not enough for the amendment path
      for (const actor of [w.hr, w.presenter, w.leadA]) {
        await c.expectError("PERMISSION_DENIED", () => c.rpc("amend_organization_holiday", actor, w.wk, "DECLARE", "Public holiday", "k-" + actor.slice(0, 4)));
      }
      await c.expectError("REASON_REQUIRED", () => c.rpc("amend_organization_holiday", w.admin, w.wk, "DECLARE", " ", "k-blank"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("amend_organization_holiday", w.admin, w.wk, "TOGGLE", "x", "k-dir"));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("amend_organization_holiday", w.admin, w.wk, "REVERSE", "not a holiday", "k-rev"));

      // a closed week cannot be amended by one person alone
      await c.expectError("TWO_PERSON_APPROVAL_REQUIRED", () => c.rpc("amend_organization_holiday", w.admin, w.wk, "DECLARE", "Acting alone", "k-solo"));
      const res = await amendClosed<{ amendment_id: string; impact: { business_unit_id: string; old_score: string; new_score: string; new_version: number }[]; week_final_locked: boolean }>(
        c, w.admin, w.sa, w.wk, "DECLARE", "Declared by government after the fact", "am-1");
      expect(res.week_final_locked).toBe(true);
      expect(res.impact.length).toBeGreaterThanOrEqual(2);

      const afterA = await latestQ(c, w.quarterId, w.buA);
      expect(afterA.version_number).toBe(beforeA.version_number + 1);
      expect(afterA.source).toBe("AMENDMENT");
      expect(afterA.holiday_amendment_id).toBe(res.amendment_id);
      expect(afterA.excluded_holiday_count).toBe(beforeA.excluded_holiday_count + 1);
      expect(afterA.denominator_count).toBe(beforeA.denominator_count - 1);
      expect(Number(afterA.numerator)).toBe(0);                       // the week left numerator and denominator
      expect(afterA.prior_snapshot_id).toBe(beforeA.id);
      // earlier history is untouched
      expect((await c.q("select count(*)::int n from quarterly_score_snapshots where id = any($1)", [[beforeA.id, beforeB.id]]))[0].n).toBe(2);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [w.wk]))[0].n).toBe(2);
      expect((await c.q("select count(*)::int n from weekly_compliance where reporting_week_id = $1", [w.wk]))[0].n).toBe(2);
      expect((await c.q("select reporting_state from reporting_weeks where id = $1", [w.wk]))[0].reporting_state).toBe("ORGANIZATION_HOLIDAY");
      expect((await c.q("select count(*)::int n from reporting_week_state_events where reporting_week_id = $1 and new_state = 'ORGANIZATION_HOLIDAY'", [w.wk]))[0].n).toBe(1);
      const audit = await c.q<{ action: string; reason: string }>("select action, reason from audit_logs where entity_id = $1 order by seq", [w.wk]);
      expect(audit.map((a) => a.action)).toContain("ORGANIZATION_HOLIDAY_AMENDED_IN");

      // idempotent replay; the key cannot be reused for something else
      const again = await c.rpc<{ replayed: boolean; amendment_id: string }>("decide_holiday_amendment_request", w.sa, res.request_id, "APPROVE", null, "am-1-approve");
      expect(again.replayed).toBe(true); expect(again.amendment_id).toBe(res.amendment_id);
      await c.expectError("IDEMPOTENCY_KEY_REUSED", () => c.rpc("decide_holiday_amendment_request", w.admin, res.request_id, "APPROVE", null, "am-1-approve"));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("amend_organization_holiday", w.admin, w.wk, "DECLARE", "again", "am-2"));
      expect((await latestQ(c, w.quarterId, w.buA)).version_number).toBe(afterA.version_number);

      // immutability
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update holiday_amendments set reason = 'x'"));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from holiday_amendments"));
      await c.expectError("PERMISSION_DENIED", () => c.q("update reporting_weeks set reporting_state = 'NORMAL' where id = $1", [w.wk]));
      // a holiday week can no longer receive a late report
      await c.expectError("REPORTING_NOT_REQUIRED", () => c.rpc("authorise_late_report_exception", w.admin, w.buB, w.wk, "x", "lr-1"));

      // reversing restores the week: A keeps its submitted 100, B (no report) gets a zero; eligibility is back
      const rev = await amendClosed<{ backfilled_zero_count: number }>(c, w.admin, w.sa, w.wk, "REVERSE", "Holiday cancelled", "am-3");
      expect(rev.backfilled_zero_count).toBe(0);                       // snapshots already existed from the original final lock
      const revA = await latestQ(c, w.quarterId, w.buA);
      expect(revA.excluded_holiday_count).toBe(beforeA.excluded_holiday_count);
      expect(Number(revA.numerator)).toBe(100);
      expect(revA.version_number).toBe(afterA.version_number + 1);
    });
  });

  it("reversing a holiday on a final-locked week backfills missing-report zeros with immutable history", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.open);
      await c.rpc("declare_organization_holiday", w.hr, [w.wk], "Founders' day", "h-1");
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [w.wk]))[0].n).toBe(0); // no zero for a holiday
      const before = await latestQ(c, w.quarterId, w.buA);
      expect(before.excluded_holiday_count).toBe(1);

      const rev = await amendClosed<{ backfilled_zero_count: number; quarter_locked: boolean }>(c, w.admin, w.sa, w.wk, "REVERSE", "Holiday cancelled retroactively", "r-1");
      expect(rev.backfilled_zero_count).toBe(2);                       // ALPHA and BRAVO both filed nothing
      const rows = await c.q("select reason, score_state, final_score from weekly_score_snapshots where reporting_week_id = $1", [w.wk]);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.reason === "HOLIDAY_REVERSAL" && r.score_state === "NOT_SUBMITTED" && Number(r.final_score) === 0)).toBe(true);
      expect((await c.q("select status from weekly_compliance where reporting_week_id = $1", [w.wk])).every((r) => r.status === "NON_COMPLIANT")).toBe(true);
      const after = await latestQ(c, w.quarterId, w.buA);
      expect(after.excluded_holiday_count).toBe(0);
      expect(after.denominator_count).toBe(before.denominator_count + 1);
      expect(after.missing_report_zero_count).toBe(before.missing_report_zero_count + 1);
      expect(after.source).toBe("AMENDMENT");
      expect((await c.q("select id from quarterly_score_snapshots where id = $1", [before.id])).length).toBe(1);
      // idempotent: replay creates nothing
      expect((await c.rpc<{ replayed: boolean }>("decide_holiday_amendment_request", w.sa, rev.request_id, "APPROVE", null, "r-1-approve")).replayed).toBe(true);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [w.wk]))[0].n).toBe(2);
      // the reinstated missing report can now use the late-report path
      await c.rpc("authorise_late_report_exception", w.admin, w.buB, w.wk, "Was on holiday", "lr-2");
      await c.expectError("LATE_EXCEPTION_PENDING", () => c.rpc("amend_organization_holiday", w.sa, w.wk, "DECLARE", "again", "r-2"));
    });
  });

  it("works after the quarter is locked without reopening it, and a pre-lock reversal is a plain flip", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.open);
      await c.rpc("declare_organization_holiday", w.hr, [w.wk], "Short closure", "h-2");
      // pre-lock reversal needs no backfill and creates no weekly snapshots
      const rev = await c.rpc<{ week_final_locked: boolean; backfilled_zero_count: number }>("amend_organization_holiday", w.admin, w.wk, "REVERSE", "Closure cancelled", "p-1");
      expect(rev.week_final_locked).toBe(false);
      expect(rev.backfilled_zero_count).toBe(0);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [w.wk]))[0].n).toBe(0);
      await c.rpc("get_or_create_weekly_report", w.leadA, w.wk);          // reportable again

      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      await c.setNow("2031-04-02T09:00:00+01:00");
      await c.rpc("roll_quarters");
      expect((await c.q("select status from quarters where id = $1", [w.quarterId]))[0].status).toBe("LOCKED");
      const before = await latestQ(c, w.quarterId, w.buA);
      const res = await amendClosed<{ quarter_locked: boolean }>(c, w.admin, w.sa, w.wk, "DECLARE", "Retroactive national holiday", "q-1");
      expect(res.quarter_locked).toBe(true);
      const after = await latestQ(c, w.quarterId, w.buA);
      expect(after.version_number).toBe(before.version_number + 1);
      expect(after.excluded_holiday_count).toBe(1);
      await c.expectError("QUARTER_LOCKED", () => c.rpc("update_objective", w.admin, w.strat.objectiveId, "Changed", null));
    });
  });

  it("holiday weeks are not listed as non-compliant on the executive dashboard, and the history is RLS-readable only by managers", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const exec = await c.user(["EXECUTIVE"], w.buA, "exec");
      const nc = async () => (await c.asUser(exec, () => c.rpc<{ non_compliant: unknown[] }>("read_executive_dashboard", w.quarterId))).non_compliant.length;
      expect(await nc()).toBe(2);
      await amendClosed(c, w.admin, w.sa, w.wk, "DECLARE", "Retroactive", "d-1");
      expect(await nc()).toBe(0);
      expect(await c.asUser(w.admin, () => c.rpc<unknown[]>("read_holiday_amendments"))).toHaveLength(1);
      expect(await c.asUser(w.leadA, () => c.rpc<unknown[]>("read_holiday_amendments"))).toHaveLength(0);
    });
  });
});

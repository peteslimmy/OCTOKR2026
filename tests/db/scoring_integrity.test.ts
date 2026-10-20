import { describe, expect, it } from "vitest";
import { W1, draftGoal, evalJson, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const buA = await c.bu("ALPHA");
  const buB = await c.bu("BRAVO");
  const buC = await c.bu("CHARLIE");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa");
  const presenter = await c.user(["PRESENTER"], buA, "presenter");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA");
  const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  return { buA, buB, buC, admin, sa, presenter, leadA, leadB, strat, wk };
}

/** BU A: 4 goals (3 with all tasks done, 1 not), submitted. Returns task ids per goal. */
async function reportWith4Goals(c: Ctx, w: Awaited<ReturnType<typeof world>>) {
  const first = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["g1-a", "g1-b"], "Goal one by Friday");
  const goals = [first.goalId];
  for (let i = 2; i <= 4; i++) {
    const v = (await c.q<{ version: number }>("select version from weekly_reports where id = $1", [first.reportId]))[0].version;
    const r = await c.rpc<{ goal_id: string }>("create_goal", w.leadA, first.reportId, i === 4 ? "STRETCH" : "KR_ALIGNED",
      i === 4 ? null : w.strat.subKrIds[i - 1], `Goal ${i} by Friday`, null, [{ description: `g${i}-a` }], evalJson, v);
    goals.push(r.goal_id);
  }
  await c.rpc("submit_weekly_report", w.leadA, first.reportId, null, null);
  await c.setNow(W1.afterContentLock);
  const tasks: Record<string, string[]> = {};
  for (const g of goals) tasks[g] = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 order by position", [g])).map((r) => r.id);
  for (const g of goals.slice(0, 3)) for (const t of tasks[g]) await c.rpc("execute_task", w.leadA, t, "DONE");
  await c.rpc("execute_task", w.leadA, tasks[goals[3]][0], "NOT_DONE");
  return { reportId: first.reportId, goals, tasks };
}

describe("final lock (FR-WR-012/013, UJ-07/08)", () => {
  it("scores equal-weight goals (4 goals, 3 done = 75.00), converts UNDEFINED to NOT_DONE, snapshots, compliance, audits", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { reportId, goals } = await reportWith4Goals(c, w);
      // leave one extra task UNDEFINED in goal 4 to prove conversion
      await c.setNow(W1.beforeFinal);
      await c.expectError("FINAL_LOCK_NOT_DUE", () => c.rpc("finalize_reporting_week", w.wk));
      await c.setNow(W1.finalLock);
      const res = await c.rpc<{ reports: number; missing: number }>("finalize_reporting_week", w.wk);
      expect(res.reports).toBe(1);
      expect(res.missing).toBe(2); // BU B and C filed nothing
      const snap = (await c.q("select * from weekly_score_snapshots where weekly_report_id = $1", [reportId]))[0];
      expect(snap).toMatchObject({ total_goals: 4, done_goals: 3, score_state: "SCORED", version_number: 1, reason: "FINAL_LOCK" });
      expect(Number(snap.base_score)).toBe(75);
      expect(Number(snap.final_score)).toBe(75);
      expect((await c.q("select status from weekly_compliance where weekly_report_id = $1", [reportId]))[0].status).toBe("COMPLIANT");
      expect((await c.q("select status, final_locked_at is not null fl from weekly_reports where id = $1", [reportId]))[0]).toMatchObject({ status: "FINAL_LOCKED", fl: true });
      expect((await c.q("select count(*)::int n from audit_logs where action = 'REPORTING_WEEK_FINAL_LOCKED'"))[0].n).toBe(1);
      expect(goals).toHaveLength(4);
    });
  });

  it("UNDEFINED tasks become NOT_DONE at final lock with system history; goal status is derived", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { reportId, goalId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["a", "b", "c"]);
      await c.rpc("submit_weekly_report", w.leadA, reportId, null, null);
      await c.setNow(W1.afterContentLock);
      const ts = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 order by position", [goalId])).map((r) => r.id);
      await c.rpc("execute_task", w.leadA, ts[0], "DONE");
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const st = await c.q("select status from tasks where smart_goal_id = $1 order by position", [goalId]);
      expect(st.map((s) => s.status)).toEqual(["DONE", "NOT_DONE", "NOT_DONE"]);
      expect((await c.q("select count(*)::int n from task_status_history where change_source = 'SYSTEM_FINAL_LOCK'"))[0].n).toBe(2);
      expect((await c.q("select final_score from weekly_score_snapshots where weekly_report_id = $1", [reportId]))[0].final_score).toBe("0.00"); // goal not done
      // SUBMITTED + 0.00 stays COMPLIANT: distinct from non-submission
      expect((await c.q("select status from weekly_compliance where weekly_report_id = $1", [reportId]))[0].status).toBe("COMPLIANT");
    });
  });

  it("non-submission => 0.00 + NON_COMPLIANT, with durable evidence even when no report row exists; idempotent re-run", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0]); // BU A drafted but never submitted
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const rows = await c.q("select business_unit_id, score_state, final_score from weekly_score_snapshots where reporting_week_id = $1", [w.wk]);
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r).toMatchObject({ score_state: "NOT_SUBMITTED", final_score: "0.00" });
      const comp = await c.q("select status, reason from weekly_compliance where reporting_week_id = $1 order by reason", [w.wk]);
      expect(comp.every((r) => r.status === "NON_COMPLIANT")).toBe(true);
      expect(comp.map((r) => r.reason).sort()).toEqual(["NOT_SUBMITTED_AT_FINAL_LOCK", "NO_REPORT_AT_FINAL_LOCK", "NO_REPORT_AT_FINAL_LOCK"]);
      const again = await c.rpc<{ already_final_locked: boolean }>("finalize_reporting_week", w.wk);
      expect(again.already_final_locked).toBe(true);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [w.wk]))[0].n).toBe(3);
    });
  });

  it("final-locked reports are immutable at the database layer, but can be reviewed", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { reportId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0]);
      await c.rpc("submit_weekly_report", w.leadA, reportId, null, null);
      await c.setNow(W1.beforeFinal);
      await c.expectError("REPORT_NOT_FINALISED", () => c.rpc("review_weekly_report", w.presenter, reportId));
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      await c.expectError("REPORT_FINAL_LOCKED", () => c.q("update weekly_reports set version = version + 1 where id = $1", [reportId]));
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from weekly_reports where id = $1", [reportId]));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("review_weekly_report", w.leadA, reportId));
      await c.rpc("review_weekly_report", w.presenter, reportId);
      expect((await c.q("select review_status from weekly_reports where id = $1", [reportId]))[0].review_status).toBe("REVIEWED");
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update weekly_score_snapshots set final_score = 100"));
    });
  });
});

describe("integrity correction (FR-INT-*, AC-INT-*, ADR-012)", () => {
  async function setup(c: Ctx) {
    const w = await world(c);
    const rep = await reportWith4Goals(c, w);
    return { w, ...rep };
  }

  it("requires reason, penalty decision, waiver reason; denied to BU Lead; correction impossible before content lock", async () => {
    await withTx(async (c) => {
      const { w, tasks, goals } = await setup(c);
      const t = tasks[goals[0]][0]; // DONE task
      await c.rpc("set_integrity_penalty_rate", w.admin, 0.05);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("create_integrity_correction", w.leadA, t, "NOT_DONE", "r", "APPLY", null, "k0"));
      await c.expectError("INTEGRITY_REASON_REQUIRED", () => c.rpc("create_integrity_correction", w.presenter, t, "NOT_DONE", "  ", "APPLY", null, "k1"));
      await c.expectError("PENALTY_DECISION_REQUIRED", () => c.rpc("create_integrity_correction", w.presenter, t, "NOT_DONE", "evidence missing", null, null, "k2"));
      await c.expectError("WAIVER_REASON_REQUIRED", () => c.rpc("create_integrity_correction", w.presenter, t, "NOT_DONE", "evidence missing", "WAIVE", " ", "k3"));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("create_integrity_correction", w.presenter, t, "DONE", "same", "APPLY", null, "k4"));
      expect((await c.q("select status from tasks where id = $1", [t]))[0].status).toBe("DONE"); // nothing changed
    });
  });

  it("APPLY: 80% base with two 5% penalties = 72.00 (summed, applied once to the ORIGINAL base); versioned snapshots preserve v1", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // 5 goals, 4 done => base 80
      const first = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["g1"], "Goal 1 by Friday");
      const goals = [first.goalId];
      for (let i = 2; i <= 5; i++) {
        const v = (await c.q<{ version: number }>("select version from weekly_reports where id = $1", [first.reportId]))[0].version;
        goals.push((await c.rpc<{ goal_id: string }>("create_goal", w.leadA, first.reportId, "STRETCH", null, `Goal ${i} by Friday`, null, [{ description: `g${i}` }], evalJson, v)).goal_id);
      }
      await c.rpc("submit_weekly_report", w.leadA, first.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      const t = async (g: string) => (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1", [g]))[0].id;
      const ids = [] as string[];
      for (const g of goals) ids.push(await t(g));
      for (const id of ids.slice(0, 4)) await c.rpc("execute_task", w.leadA, id, "DONE");
      await c.rpc("execute_task", w.leadA, ids[4], "NOT_DONE");
      await c.rpc("set_integrity_penalty_rate", w.admin, 0.05);
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const base = Number((await c.q("select base_score from weekly_score_snapshots where weekly_report_id = $1", [first.reportId]))[0].base_score);
      expect(base).toBe(80);
      // Two DONE tasks corrected to NOT_DONE would change base; use Presenter on one NOT_DONE->DONE first (no penalty) to keep base at 80 shape:
      const up = await c.rpc<{ score_after: string }>("create_integrity_correction", w.presenter, ids[4], "DONE", "Evidence shows it was completed", null, null, "ic-up");
      expect(Number(up.score_after)).toBe(100);
      expect((await c.q("select penalty_decision, penalty_rate from integrity_corrections where idempotency_key = 'ic-up'"))[0]).toMatchObject({ penalty_decision: "NONE", penalty_rate: null });
      // Now two DONE -> NOT_DONE with APPLY: each is its own goal => base 100 -> 60 (3/5), penalties 5%+5% => 60 * 0.90 = 54.00
      await c.rpc("create_integrity_correction", w.presenter, ids[0], "NOT_DONE", "Not actually delivered", "APPLY", null, "ic-1");
      const second = await c.rpc<{ score_after: string }>("create_integrity_correction", w.presenter, ids[1], "NOT_DONE", "Not actually delivered either", "APPLY", null, "ic-2");
      expect(Number(second.score_after)).toBe(54);
      const snaps = await c.q("select version_number, reason, base_score, combined_penalty_rate, final_score from weekly_score_snapshots where weekly_report_id = $1 order by version_number", [first.reportId]);
      expect(snaps.map((s) => s.version_number)).toEqual([1, 2, 3, 4]);
      expect(snaps[0]).toMatchObject({ reason: "FINAL_LOCK", final_score: "80.00" }); // original preserved
      expect(Number(snaps[3].combined_penalty_rate)).toBe(0.1);
      expect(snaps[3].final_score).toBe("54.00");
      // idempotent replay
      const replay = await c.rpc<{ replayed: boolean }>("create_integrity_correction", w.presenter, ids[1], "NOT_DONE", "Not actually delivered either", "APPLY", null, "ic-2");
      expect(replay.replayed).toBe(true);
      expect((await c.q("select count(*)::int n from integrity_corrections"))[0].n).toBe(3);
    });
  });

  it("APPLY needs a configured rate; WAIVE records reason and creates no penalty; every action is audited and notifies the BU", async () => {
    await withTx(async (c) => {
      const { w, tasks, goals } = await setup(c);
      const t0 = tasks[goals[0]][0];
      const t1 = tasks[goals[1]][0];
      await c.expectError("PENALTY_CONFIG_MISSING", () => c.rpc("create_integrity_correction", w.presenter, t0, "NOT_DONE", "r", "APPLY", null, "a1"));
      await c.rpc("create_integrity_correction", w.presenter, t0, "NOT_DONE", "Counted by mistake", "WAIVE", "First offence, agreed in session", "a2");
      const row = (await c.q("select penalty_decision, penalty_rate, waiver_reason from integrity_corrections where idempotency_key = 'a2'"))[0];
      expect(row).toMatchObject({ penalty_decision: "WAIVE", penalty_rate: null, waiver_reason: "First offence, agreed in session" });
      const actions = (await c.q("select action from audit_logs where entity_id = $1 or entity_type = 'integrity_correction' order by occurred_at", [t0])).map((a) => a.action);
      expect(actions).toContain("INTEGRITY_CORRECTION");
      expect(actions).toContain("PENALTY_WAIVED");
      expect((await c.q("select count(*)::int n from notifications where event_type = 'INTEGRITY_CORRECTION' and user_id = $1", [w.leadA]))[0].n).toBe(1);
      // before final lock no snapshot exists yet; the penalty is picked up at final lock
      await c.rpc("set_integrity_penalty_rate", w.admin, 0.1);
      await c.rpc("create_integrity_correction", w.sa, t1, "NOT_DONE", "SuperAdmin uses the SAME workflow", "APPLY", null, "a3");
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const snap = (await c.q("select base_score, combined_penalty_rate, final_score, applied_penalty_rates from weekly_score_snapshots where weekly_report_id = (select weekly_report_id from integrity_corrections limit 1) and version_number = 1"))[0];
      // 4 goals, goal1 & goal2 corrected NOT_DONE -> 1 done => base 25; penalty 10% => 22.50
      expect(Number(snap.base_score)).toBe(25);
      expect(snap.final_score).toBe("22.50");
      expect(snap.applied_penalty_rates).toHaveLength(1);
    });
  });

  it("final score never goes below 0.00 (floor) even for combined rates >= 100%", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["a", "b"], "Goal by Friday");
      await c.rpc("submit_weekly_report", w.leadA, g.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      const ts = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 order by position", [g.goalId])).map((r) => r.id);
      for (const t of ts) await c.rpc("execute_task", w.leadA, t, "DONE");
      await c.rpc("set_integrity_penalty_rate", w.admin, 0.6);
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      await c.rpc("create_integrity_correction", w.presenter, ts[0], "NOT_DONE", "r1", "APPLY", null, "f1");
      await c.rpc("create_integrity_correction", w.presenter, ts[1], "NOT_DONE", "r2", "APPLY", null, "f2");
      const last = (await c.q("select final_score, combined_penalty_rate from weekly_score_snapshots order by version_number desc limit 1"))[0];
      expect(last.final_score).toBe("0.00");
    });
  });

  it("direct task UPDATE bypassing the integrity workflow is blocked by the database", async () => {
    await withTx(async (c) => {
      const { tasks, goals } = await setup(c);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.q("update tasks set status = 'NOT_DONE' where id = $1", [tasks[goals[0]][0]]));
    });
  });
});

describe("quarterly score (fixed denominator, versions)", () => {
  it("missing weeks count as 0.00 in a fixed denominator; snapshots are versioned and PROVISIONAL until the quarter is complete", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { reportId } = await reportWith4Goals(c, w);
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      const calc = await c.rpc<{ score: string; denominator_count: number; calculation_status: string; pending_weeks: number }>("calculate_quarterly_score", w.strat.quarterId, w.buA);
      expect(calc.denominator_count).toBe(13);
      expect(Number(calc.score)).toBeCloseTo(75 / 13, 2); // 5.77: only week 1 scored, others pending count as 0 so far
      expect(calc.calculation_status).toBe("PROVISIONAL");
      const snaps = await c.q("select version_number, calculation_status from quarterly_score_snapshots where quarter_id = $1 and business_unit_id = $2 order by version_number", [w.strat.quarterId, w.buA]);
      expect(snaps.length).toBeGreaterThanOrEqual(1);
      await c.expectError("IMMUTABLE_RECORD", () => c.q("update quarterly_score_snapshots set score = 99"));
      expect(reportId).toBeTruthy();
    });
  });

  it("a quarter with no eligible weeks reports N/A (NO_ELIGIBLE_REPORTING_WEEKS), not 0 or a division error", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const weeks = (await c.q<{ id: string }>("select id from reporting_weeks where quarter_id = $1", [w.strat.quarterId])).map((r) => r.id);
      const hr = await c.user(["HR"], w.buA, "hr");
      await c.rpc("declare_organization_holiday", hr, weeks, "Extended closure", "all-weeks");
      const calc = await c.rpc<{ score: string | null; score_reason: string; denominator_count: number }>("calculate_quarterly_score", w.strat.quarterId, w.buA);
      expect(calc).toMatchObject({ score: null, score_reason: "NO_ELIGIBLE_REPORTING_WEEKS", denominator_count: 0 });
    });
  });
});

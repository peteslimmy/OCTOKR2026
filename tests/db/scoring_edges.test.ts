import { describe, expect, it } from "vitest";
import { W1, draftGoal, evalJson, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/** Acceptance criteria AC-SC-002, AC-SC-003, AC-SC-005 and AC-INT-002/003, closed after the traceability assessment found them untested. */
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("SE");
  const admin = await c.user(["ADMIN"], bu, "admin"); const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const presenter = await c.user(["PRESENTER"], bu, "presenter"); const lead = await c.user(["BU_LEAD"], bu, "lead");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  return { bu, admin, sa, presenter, lead, strat, wk };
}
type W = Awaited<ReturnType<typeof world>>;
const version = async (c: Ctx, reportId: string) => (await c.q<{ version: number }>("select version from weekly_reports where id = $1", [reportId]))[0].version;
const addGoal = async (c: Ctx, w: W, reportId: string, kind: "KR_ALIGNED" | "STRETCH", title: string, tasks: string[]) => {
  const r = await c.rpc<{ goal_id: string }>("create_goal", w.lead, reportId, kind, kind === "STRETCH" ? null : w.strat.subKrIds[1], title, null, tasks.map((description) => ({ description })), evalJson, await version(c, reportId));
  return r.goal_id;
};
const taskIds = async (c: Ctx, goal: string) => (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 order by position", [goal])).map((r) => r.id);
const finalise = async (c: Ctx, w: W) => { await c.setNow(W1.finalLock); await c.rpc("finalize_reporting_week", w.wk); };
const snapshot = async (c: Ctx, reportId: string) => (await c.q<{ final_score: string; base_score: string; total_goals: number; done_goals: number }>("select final_score, base_score, total_goals, done_goals from weekly_score_snapshots where weekly_report_id = $1 order by version_number desc limit 1", [reportId]))[0];

describe("scoring edge cases", () => {
  it("AC-SC-002: every goal weighs the same whatever its number of tasks", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g1 = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], Array.from({ length: 10 }, (_, i) => `big-${i}`), "Ship ten things by Friday");
      const g2 = await addGoal(c, w, g1.reportId, "KR_ALIGNED", "Do one thing by Friday", ["only"]);
      await c.rpc("submit_weekly_report", w.lead, g1.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      for (const t of await taskIds(c, g1.goalId)) await c.rpc("execute_task", w.lead, t, "DONE");     // the big goal: all ten done
      await c.rpc("execute_task", w.lead, (await taskIds(c, g2))[0], "NOT_DONE");                          // the small goal: its only task not done
      await finalise(c, w);
      expect(await snapshot(c, g1.reportId)).toMatchObject({ final_score: "50.00", done_goals: 1, total_goals: 2 });      // 1 of 2 goals, not 10 of 11 tasks
    });
  });

  it("AC-SC-003: a stretch goal counts in the numerator and the denominator like any other", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g1 = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["a"], "Publish the pricing sheets by Friday");
      const g2 = await addGoal(c, w, g1.reportId, "KR_ALIGNED", "Review them with sales by Friday", ["b"]);
      const g3 = await addGoal(c, w, g1.reportId, "STRETCH", "Run one customer interview by Thursday", ["c"]);
      await c.rpc("submit_weekly_report", w.lead, g1.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      await c.rpc("execute_task", w.lead, (await taskIds(c, g1.goalId))[0], "DONE");
      await c.rpc("execute_task", w.lead, (await taskIds(c, g2))[0], "DONE");
      await c.rpc("execute_task", w.lead, (await taskIds(c, g3))[0], "NOT_DONE");                          // only the stretch goal missed
      await finalise(c, w);
      expect(await snapshot(c, g1.reportId)).toMatchObject({ final_score: "66.67", done_goals: 2, total_goals: 3 });      // not 100: the stretch goal is in the denominator
    });
  });

  it("AC-SC-005: a submitted report in which every goal is Not Done scores 0.00 and is still compliant", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g1 = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["a", "b"], "Publish the pricing sheets by Friday");
      await c.rpc("submit_weekly_report", w.lead, g1.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      for (const t of await taskIds(c, g1.goalId)) await c.rpc("execute_task", w.lead, t, "NOT_DONE");
      await finalise(c, w);
      expect(await snapshot(c, g1.reportId)).toMatchObject({ final_score: "0.00", done_goals: 0, total_goals: 1 });
      expect((await c.q<{ status: string }>("select status from weekly_compliance where weekly_report_id = $1", [g1.reportId]))[0].status).toBe("COMPLIANT");   // filing counts, scoring is separate
    });
  });
});

describe("integrity correction by every role that holds the permission", () => {
  for (const role of ["admin", "sa", "presenter"] as const) {
    it(`AC-INT-002/003: ${role} can correct a task after content lock, with the same rules`, async () => {
      await withTx(async (c) => {
        const w = await world(c);
        const g = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["a"], "Publish the pricing sheets by Friday");
        await c.rpc("submit_weekly_report", w.lead, g.reportId, null, null);
        await c.setNow(W1.afterContentLock);
        const [t] = await taskIds(c, g.goalId);
        await c.rpc("execute_task", w.lead, t, "NOT_DONE");
        await c.rpc("set_integrity_penalty_rate", w.admin, 0.05);
        await finalise(c, w);
        const actor = w[role];
        await c.expectError("INTEGRITY_REASON_REQUIRED", () => c.rpc("create_integrity_correction", actor, t, "DONE", " ", null, null, `ic-${role}-0`));
        const out = await c.rpc<{ score_after: string }>("create_integrity_correction", actor, t, "DONE", "Evidence shows it was completed", null, null, `ic-${role}-1`);
        expect(Number(out.score_after)).toBe(100);
        expect((await snapshot(c, g.reportId)).final_score).toBe("100.00");
        expect((await c.q("select 1 from integrity_corrections where idempotency_key = $1", [`ic-${role}-1`])).length).toBe(1);
        await c.expectError("PERMISSION_DENIED", () => c.rpc("create_integrity_correction", w.lead, t, "NOT_DONE", "No", "APPLY", null, `ic-${role}-2`));
      });
    });
  }
});

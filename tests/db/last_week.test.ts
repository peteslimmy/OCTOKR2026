import { describe, expect, it } from "vitest";
import { W1, draftGoal, evalJson, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

interface Hint {
  availability: string; final_locked: boolean | null; undefined_tasks: number;
  tasks: { id: string; description: string; status: string; goal_title: string }[];
  current_week: { id: string; week_number: number; week_year: number };
  previous_week: { id?: string; week_number?: number; week_year?: number; week_start_at: string };
}

const taskRows = (c: Ctx, reportId: string) => c.q<{ id: string; description: string }>(
  "select t.id, t.description from tasks t join smart_goals g on g.id = t.smart_goal_id where g.weekly_report_id = $1 order by g.position, t.position", [reportId]);

/**
 * Presenting week 2 (13 Jan 2031): BU ALPHA left two tasks Not Done in week 1 (6 Jan) and did one; BU BRAVO left one Not Done.
 * Week 1 is finalised only when a test asks for it.
 */
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"); const buB = await c.bu("BRAVO");
  const admin = await c.user(["ADMIN"], buA, "admin"); const presenter = await c.user(["PRESENTER"], buA, "presenter");
  const hr = await c.user(["HR"], buA, "hr");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"); const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  const strat = await seedStrategy(c, admin);
  const w1 = await weekId(c, "2031-01-06"); const w2 = await weekId(c, "2031-01-13"); const w3 = await weekId(c, "2031-01-20");
  await c.setNow(W1.open);
  const a = await draftGoal(c, leadA, w1, strat.subKrIds[0], ["Ship the pricing sheet", "Review it with sales"], "Publish the pricing sheets by Friday");
  await c.rpc("create_goal", leadA, a.reportId, "STRETCH", null, "Run one customer interview by Thursday", null, [{ description: "Interview one customer" }], evalJson, a.version);
  const b = await draftGoal(c, leadB, w1, strat.subKrIds[1], ["Close the BRAVO proposal"], "Close two open proposals by Friday");
  await c.rpc("submit_weekly_report", leadA, a.reportId, null, null);
  await c.rpc("submit_weekly_report", leadB, b.reportId, null, null);
  await c.setNow(W1.afterContentLock);
  const ta = await taskRows(c, a.reportId);
  await c.rpc("execute_task", leadA, ta[0].id, "DONE");
  await c.rpc("execute_task", leadA, ta[1].id, "NOT_DONE");
  await c.rpc("execute_task", leadA, ta[2].id, "NOT_DONE");
  const tb = await taskRows(c, b.reportId);
  await c.rpc("execute_task", leadB, tb[0].id, "NOT_DONE");
  return { buA, buB, admin, presenter, hr, leadA, leadB, strat, w1, w2, w3, aReport: a.reportId };
}
type W = Awaited<ReturnType<typeof world>>;
const hint = (c: Ctx, user: string, week: string, bu: string) => c.asUser(user, () => c.rpc<Hint>("read_previous_week_outstanding", week, bu));
const finalise = async (c: Ctx, w: W) => { await c.setNow(W1.finalLock); await c.rpc("finalize_reporting_week", w.w1); };

describe("Last Week quick hint (read-only)", () => {
  it("presenting week 2 returns only week 1's Not Done tasks for the same BU, with their goal context", async () => {
    await withTx(async (c) => {
      const w = await world(c); await finalise(c, w);
      const h = await hint(c, w.presenter, w.w2, w.buA);
      expect(h.availability).toBe("OK");
      expect(h.final_locked).toBe(true);
      expect(h.tasks.map((t) => t.description).sort()).toEqual(["Interview one customer", "Review it with sales"]);   // the Done task and the other BU's task are absent
      expect(h.tasks.every((t) => t.status === "NOT_DONE")).toBe(true);
      expect(h.previous_week.id).toBe(w.w1);
      expect(h.current_week.id).toBe(w.w2);
      expect(h.tasks.find((t) => t.description === "Review it with sales")?.goal_title).toBe("Publish the pricing sheets by Friday");
      expect((await hint(c, w.presenter, w.w2, w.buB)).tasks.map((t) => t.description)).toEqual(["Close the BRAVO proposal"]);
    });
  });

  it("presenting week 3 looks at week 2 only: older weeks with Not Done tasks do not leak forward", async () => {
    await withTx(async (c) => {
      const w = await world(c); await finalise(c, w);
      const h = await hint(c, w.presenter, w.w3, w.buA);
      expect(h.availability).toBe("NO_REPORT");
      expect(h.tasks).toEqual([]);
      expect(h.previous_week.id).toBe(w.w2);
    });
  });

  it("an empty list is reported as OK with no tasks, distinct from no report", async () => {
    await withTx(async (c) => {
      const w = await world(c); await finalise(c, w);
      await c.setNow("2031-01-13T09:00:00+01:00");
      const a2 = await draftGoal(c, w.leadA, w.w2, w.strat.subKrIds[0], ["Task two"], "Finish the onboarding guide by Friday");
      await c.rpc("submit_weekly_report", w.leadA, a2.reportId, null, null);
      await c.setNow("2031-01-14T18:00:01+01:00");
      const t = (await taskRows(c, a2.reportId))[0].id;
      await c.rpc("execute_task", w.leadA, t, "DONE");
      const h = await hint(c, w.presenter, w.w3, w.buA);
      expect(h.availability).toBe("OK");
      expect(h.tasks).toEqual([]);
    });
  });

  it("resolves the previous week across a quarter and year boundary, and reports a missing calendar week instead of substituting", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("create_year_quarters", w.admin, 2030);
      const prev = await c.rpc<string>("ensure_reporting_week", "2030-12-30");
      const h = await hint(c, w.presenter, w.w1, w.buA);
      expect(h.availability).toBe("NO_REPORT");
      expect(h.previous_week).toMatchObject({ id: prev, week_number: 1, week_year: 2031 });   // Monday 30 Dec 2030 is ISO week 1 of 2031
      const none = await hint(c, w.presenter, prev, w.buA);                                  // 23 Dec 2030 was never created
      expect(none.availability).toBe("NO_PREVIOUS_WEEK");
      expect(none.tasks).toEqual([]);
    });
  });

  it("a holiday week is reported as a holiday", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("declare_organization_holiday", w.hr, [w.w2], "Office closure", "lw-1");
      expect((await hint(c, w.presenter, w.w3, w.buA)).availability).toBe("HOLIDAY");
    });
  });

  it("before the week is final it lists recorded Not Done tasks and says the week is not final", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const h = await hint(c, w.presenter, w.w2, w.buA);
      expect(h.final_locked).toBe(false);
      expect(h.tasks).toHaveLength(2);
      expect(h.undefined_tasks).toBe(0);
    });
  });

  it("is limited to the caller's scope and cannot be widened by parameters", async () => {
    await withTx(async (c) => {
      const w = await world(c); await finalise(c, w);
      expect((await hint(c, w.leadA, w.w2, w.buA)).tasks).toHaveLength(2);                          // own unit
      await c.expectError("PERMISSION_DENIED", () => hint(c, w.leadB, w.w2, w.buA));               // another unit by crafted parameter
      await c.expectError("PERMISSION_DENIED", () => hint(c, w.hr, w.w2, w.buA));                  // a role with no report scope
      await c.expectError("NOT_FOUND", () => hint(c, w.presenter, w.w2, "11111111-1111-4111-8111-111111111111"));
      await c.expectError("NOT_FOUND", () => hint(c, w.presenter, "11111111-1111-4111-8111-111111111111", w.buA));
      expect((await hint(c, w.presenter, w.w2, w.buB)).tasks).toHaveLength(1);                      // presenting roles may look at any unit
    });
  });

  it("changes nothing: tasks, reports, scores, compliance and audit are identical before and after", async () => {
    await withTx(async (c) => {
      const w = await world(c); await finalise(c, w);
      const fingerprint = async () => JSON.stringify([
        await c.q("select id, status, updated_at from tasks order by id"),
        await c.q("select id, submission_status, version, updated_at from weekly_reports order by id"),
        await c.q("select id, final_score, version_number from weekly_score_snapshots order by id"),
        await c.q("select id, status from weekly_compliance order by id"),
        (await c.q<{ n: number }>("select count(*)::int n from audit_logs"))[0].n,
      ]);
      const before = await fingerprint();
      for (let i = 0; i < 3; i++) await hint(c, w.presenter, w.w2, w.buA);
      expect(await fingerprint()).toBe(before);
    });
  });
});

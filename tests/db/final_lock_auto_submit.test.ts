import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * Every Business Unit must submit a weekly report. At the final lock a report nobody submitted is submitted by the system and flagged (owner rule, 25 November 2026),
 * but only when it meets the minimum of a manual submission; a Business Unit with no report stays a zero, and a unit's own submission is never flagged.
 */
async function world(c: Ctx) {
  const tag = Math.random().toString(36).slice(2, 5).toUpperCase();
  const [self, auto, empty, none] = [await c.bu(`SF${tag}`), await c.bu(`AU${tag}`), await c.bu(`EM${tag}`), await c.bu(`NO${tag}`)];
  const admin = await c.user(["ADMIN"], self, "admin");
  const leads = { self: await c.user(["BU_LEAD"], self, "self"), auto: await c.user(["BU_LEAD"], auto, "auto"), empty: await c.user(["BU_LEAD"], empty, "empty") };
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  return { self, auto, empty, none, leads, strat, wk };
}
const row = async (c: Ctx, wk: string, bu: string) => (await c.q<{ status: string; submission_status: string; auto_submitted: boolean; submitted_by: string | null }>(
  "select status, submission_status, auto_submitted, submitted_by from weekly_reports where reporting_week_id = $1 and business_unit_id = $2", [wk, bu]))[0];
const compliance = async (c: Ctx, wk: string, bu: string) => (await c.q<{ status: string; reason: string }>("select status, reason from weekly_compliance where reporting_week_id = $1 and business_unit_id = $2", [wk, bu]))[0];

describe("the final lock submits reports nobody submitted", () => {
  it("submits a complete draft and flags it, leaves the unit's own submission unflagged, and does not submit an empty draft or invent a report", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // a unit that submits on its own
      const mine = await draftGoal(c, w.leads.self, w.wk, w.strat.subKrIds[0], ["task one"], "Own goal by Friday");
      await c.rpc("submit_weekly_report", w.leads.self, mine.reportId, null, null);
      // a unit that filed goals and tasks but never pressed Submit
      const forgot = await draftGoal(c, w.leads.auto, w.wk, w.strat.subKrIds[0], ["task a", "task b"], "Filed but not submitted");
      // a unit that opened a report and added nothing
      await c.rpc("get_or_create_weekly_report", w.leads.empty, w.wk);

      await c.setNow(W1.afterContentLock);
      await c.rpc("run_scheduled_jobs");                      // the content lock first, as the scheduler does
      await c.setNow(W1.finalLock);
      await c.rpc("run_scheduled_jobs");

      // the unit's own submission: submitted by the person, not flagged, compliant for the usual reason
      expect(await row(c, w.wk, w.self)).toMatchObject({ status: "FINAL_LOCKED", submission_status: "SUBMITTED", auto_submitted: false });
      expect((await row(c, w.wk, w.self)).submitted_by).not.toBeNull();
      expect(await compliance(c, w.wk, w.self)).toEqual({ status: "COMPLIANT", reason: "REPORT_SUBMITTED" });

      // the forgotten one: submitted by the system, flagged, no submitter, its Undefined tasks are Not done, compliant with its own reason
      expect(await row(c, w.wk, w.auto)).toMatchObject({ status: "FINAL_LOCKED", submission_status: "SUBMITTED", auto_submitted: true, submitted_by: null });
      expect(await compliance(c, w.wk, w.auto)).toEqual({ status: "COMPLIANT", reason: "AUTO_SUBMITTED_AT_FINAL_LOCK" });
      const tasks = await c.q<{ status: string }>("select t.status from tasks t join smart_goals g on g.id = t.smart_goal_id where g.weekly_report_id = $1", [forgot.reportId]);
      expect(tasks.map((t) => t.status)).toEqual(["NOT_DONE", "NOT_DONE"]);
      expect((await c.q("select 1 from audit_logs where action = 'REPORT_AUTO_SUBMITTED' and entity_id = $1", [forgot.reportId])).length).toBe(1);

      // an empty draft does not meet the minimum of a submission: it stays unsubmitted and non-compliant
      expect(await row(c, w.wk, w.empty)).toMatchObject({ status: "FINAL_LOCKED", submission_status: "NOT_SUBMITTED", auto_submitted: false });
      expect(await compliance(c, w.wk, w.empty)).toEqual({ status: "NON_COMPLIANT", reason: "NOT_SUBMITTED_AT_FINAL_LOCK" });

      // a unit with no report at all gets no report invented: it stays a missing report
      expect((await c.q("select 1 from weekly_reports where reporting_week_id = $1 and business_unit_id = $2", [w.wk, w.none])).length).toBe(0);
      expect(await compliance(c, w.wk, w.none)).toEqual({ status: "NON_COMPLIANT", reason: "NO_REPORT_AT_FINAL_LOCK" });

      // the week's record says how many the system submitted
      const summary = await c.q<{ new_values: { auto_submitted: number } }>("select new_values from audit_logs where action = 'REPORTING_WEEK_FINAL_LOCKED' and entity_id = $1", [w.wk]);
      expect(summary[0].new_values.auto_submitted).toBeGreaterThanOrEqual(1);
    });
  });
});

import { describe, expect, it } from "vitest";
import { W1, draftGoal, evalJson, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const buA = await c.bu("ALPHA");
  const buB = await c.bu("BRAVO");
  const admin = await c.user(["ADMIN"], buA, "admin");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA");
  const leadA2 = await c.user(["BU_LEAD"], buA, "leadA2");
  const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  return { buA, buB, admin, leadA, leadA2, leadB, strat, wk };
}

describe("weekly report lifecycle and locks", () => {
  it("content edits are allowed at 17:59:59 and rejected at 18:00:00 Tuesday WAT (AC-WR-004/005)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { reportId, goalId, version } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0]);
      await c.setNow(W1.beforeContentLock);
      await c.rpc("acquire_edit_lease", w.leadA, reportId, 300);
      const v2 = (await c.rpc<{ version: number }>("create_task", w.leadA, goalId, "Late but in time", version)).version;
      expect(v2).toBe(version + 1);
      await c.setNow(W1.contentLock);
      await c.expectError("REPORT_CONTENT_LOCKED", () => c.rpc("delete_goal", w.leadA, goalId, null));
      await c.expectError("REPORT_CONTENT_LOCKED", () => c.rpc("create_task", w.leadA, goalId, "x", null));
      await c.expectError("REPORT_CONTENT_LOCKED", () => c.rpc("acquire_edit_lease", w.leadA, reportId, 300));
      await c.setNow(W1.afterContentLock);
      const t = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 limit 1", [goalId]))[0].id;
      await c.expectError("REPORT_CONTENT_LOCKED", () => c.rpc("update_task", w.leadA, t, "rename", null));
    });
  });

  it("execution: only UNDEFINED -> DONE/NOT_DONE, only after content lock, never reversible, never after final lock", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { goalId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0], ["a", "b"]);
      const [t1, t2] = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1 order by position", [goalId])).map((r) => r.id);
      await c.expectError("EXECUTION_NOT_OPEN", () => c.rpc("execute_task", w.leadA, t1, "DONE")); // before lock
      await c.setNow(W1.afterContentLock);
      expect((await c.rpc<{ goal_done: boolean }>("execute_task", w.leadA, t1, "DONE")).goal_done).toBe(false); // derived: not all tasks done
      expect((await c.rpc<{ goal_done: boolean }>("execute_task", w.leadA, t2, "DONE")).goal_done).toBe(true);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("execute_task", w.leadA, t1, "NOT_DONE")); // DONE -> NOT_DONE prohibited
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("execute_task", w.leadA, t1, "UNDEFINED"));
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("execute_task", w.leadB, t1, "NOT_DONE"));
      await c.setNow(W1.finalLock);
      await c.expectError("REPORT_FINAL_LOCKED", () => c.rpc("execute_task", w.leadA, t1, "NOT_DONE"));
    });
  });

  it("database trigger blocks task reversal even for direct SQL (defence in depth)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { goalId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0]);
      await c.setNow(W1.afterContentLock);
      const t = (await c.q<{ id: string }>("select id from tasks where smart_goal_id = $1", [goalId]))[0].id;
      await c.rpc("execute_task", w.leadA, t, "DONE");
      await c.expectError("INVALID_STATE_TRANSITION", () => c.q("update tasks set status = 'NOT_DONE' where id = $1", [t]));
    });
  });

  it("submission: needs >= 1 goal (GOAL_MINIMUM_REQUIRED); weak SMART never blocks; submit does not lock content", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const reportId = await c.rpc<string>("get_or_create_weekly_report", w.leadA, w.wk);
      await c.expectError("SUBMISSION_BLOCKED", () => c.rpc("submit_weekly_report", w.leadA, reportId, null, null));
      await c.rpc("acquire_edit_lease", w.leadA, reportId, 300);
      const weak = { ...evalJson, specific: 5, measurable: 0, achievable: 5, relevant: 0, timeBound: 0, overall: 2, warnings: ["weak"] };
      await c.rpc("create_goal", w.leadA, reportId, "STRETCH", null, "x", null, [{ description: "t" }], weak, null);
      const res = await c.rpc<{ already_submitted: boolean }>("submit_weekly_report", w.leadA, reportId, null, null);
      expect(res.already_submitted).toBe(false);
      // still editable before 18:00 after submission
      const g = (await c.q<{ id: string }>("select id from smart_goals where weekly_report_id = $1", [reportId]))[0].id;
      await c.rpc("create_task", w.leadA, g, "added after submit", null);
      // idempotent re-submit
      expect((await c.rpc<{ already_submitted: boolean }>("submit_weekly_report", w.leadA, reportId, null, null)).already_submitted).toBe(true);
    });
  });

  it("goal/Sub-KR rules: aligned needs a Sub-KR of the report's quarter; stretch has none; every goal needs a task", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const reportId = await c.rpc<string>("get_or_create_weekly_report", w.leadA, w.wk);
      await c.rpc("acquire_edit_lease", w.leadA, reportId, 300);
      const tasks = [{ description: "t" }];
      await c.expectError("GOAL_SUB_KR_REQUIRED", () => c.rpc("create_goal", w.leadA, reportId, "KR_ALIGNED", null, "g", null, tasks, evalJson, null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("create_goal", w.leadA, reportId, "STRETCH", w.strat.subKrIds[0], "g", null, tasks, evalJson, null));
      await c.expectError("GOAL_TASK_REQUIRED", () => c.rpc("create_goal", w.leadA, reportId, "STRETCH", null, "g", null, [], evalJson, null));
      await c.expectError("GOAL_SUB_KR_INVALID", () => c.rpc("create_goal", w.leadA, reportId, "KR_ALIGNED", "00000000-0000-0000-0000-000000000001", "g", null, tasks, evalJson, null));
      await c.expectError("SMART_EVAL_PERSIST_FAILED", () => c.rpc("create_goal", w.leadA, reportId, "STRETCH", null, "g", null, tasks, { overall: 400 }, null));
      // failed evaluation persistence must not leave a goal behind
      expect((await c.q("select count(*)::int n from smart_goals where weekly_report_id = $1", [reportId]))[0].n).toBe(0);
    });
  });

  it("one BU report is shared; only one BU Lead holds the edit lease; stale versions are rejected", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const reportId = await c.rpc<string>("get_or_create_weekly_report", w.leadA, w.wk);
      expect(await c.rpc<string>("get_or_create_weekly_report", w.leadA2, w.wk)).toBe(reportId); // same BU, same report
      await c.rpc("acquire_edit_lease", w.leadA, reportId, 300);
      await c.expectError("EDIT_LEASE_CONFLICT", () => c.rpc("acquire_edit_lease", w.leadA2, reportId, 300));
      await c.expectError("EDIT_LEASE_REQUIRED", () => c.rpc("create_goal", w.leadA2, reportId, "STRETCH", null, "g", null, [{ description: "t" }], evalJson, null));
      await c.expectError("CONCURRENT_UPDATE", () => c.rpc("create_goal", w.leadA, reportId, "STRETCH", null, "g", null, [{ description: "t" }], evalJson, 99));
      await c.setNow("2031-01-06T09:06:00+01:00"); // lease (5 min) expired
      await c.rpc("acquire_edit_lease", w.leadA2, reportId, 300);
      await c.expectError("EDIT_LEASE_REQUIRED", () => c.rpc("create_goal", w.leadA, reportId, "STRETCH", null, "g", null, [{ description: "t" }], evalJson, null));
    });
  });

  it("BU isolation: another BU cannot read the report, create goals in it, or submit it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { reportId } = await draftGoal(c, w.leadA, w.wk, w.strat.subKrIds[0]);
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("acquire_edit_lease", w.leadB, reportId, 300));
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("submit_weekly_report", w.leadB, reportId, null, null));
      const own = await c.asUser(w.leadB, () => c.q("select id from weekly_reports"));
      expect(own).toEqual([]); // SEC-RLS-001
      const mine = await c.asUser(w.leadA, () => c.q("select id from weekly_reports where id = $1", [reportId]));
      expect(mine).toHaveLength(1);
    });
  });

  it("reports cannot be created before the week opens or after content lock", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow("2031-01-05T12:00:00+01:00");
      await c.expectError("REPORTING_WEEK_NOT_OPEN", () => c.rpc("get_or_create_weekly_report", w.leadA, w.wk));
      await c.setNow(W1.contentLock);
      await c.expectError("REPORT_CONTENT_LOCKED", () => c.rpc("get_or_create_weekly_report", w.leadA, w.wk));
    });
  });
});

describe("Business Units that do not report weekly", () => {
  it("a BU flagged reports_weekly=false cannot file, gets no missing-report zero or compliance row, and is not ranked", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const buHq = await c.bu("HQX");
      const hqLead = await c.user(["BU_LEAD"], buHq, "hqLead");
      const sa = await c.user(["SUPER_ADMIN"], w.buA, "sa");
      await c.rpc("update_business_unit", sa, buHq, "Headquarters", "ACTIVE", false);
      await c.expectError("REPORTING_NOT_REQUIRED", () => c.rpc("get_or_create_weekly_report", hqLead, w.wk));
      await c.setNow(W1.finalLock);
      await c.rpc("finalize_reporting_week", w.wk);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where business_unit_id = $1", [buHq]))[0].n).toBe(0);
      expect((await c.q("select count(*)::int n from weekly_compliance where business_unit_id = $1", [buHq]))[0].n).toBe(0);
      expect((await c.q("select count(*)::int n from quarterly_score_snapshots where business_unit_id = $1", [buHq]))[0].n).toBe(0);
      // the reporting BUs still receive their missing-report zeros
      expect((await c.q("select count(*)::int n from weekly_compliance where business_unit_id = $1 and status = 'NON_COMPLIANT'", [w.buB]))[0].n).toBe(1);
      const overview = await c.asUser(w.admin, () => c.rpc<{ business_unit: { id: string } }[]>("read_week_overview", w.wk));
      expect(overview.some((o) => o.business_unit.id === buHq)).toBe(false);
    });
  });
});

describe("skipped OKR week and organisation holiday", () => {
  it("a SKIPPED session requires a manually authored summary before submit, and does not waive the report", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const wkId = w.wk;
      await c.q("insert into governance_sessions (reporting_week_id, session_date, outcome) values ($1, '2031-01-07', 'SKIPPED')", [wkId]);
      const { reportId } = await draftGoal(c, w.leadA, wkId, w.strat.subKrIds[0]);
      await c.expectError("SUBMISSION_BLOCKED", () => c.rpc("submit_weekly_report", w.leadA, reportId, "   ", null));
      await c.rpc("submit_weekly_report", w.leadA, reportId, "We shipped the pricing sheets and closed 2 renewals.", null);
      expect((await c.q("select skipped_session_summary_comment c from weekly_reports where id = $1", [reportId]))[0].c).toContain("pricing sheets");
    });
  });

  it("holiday: permission-gated, reason required, idempotent, audited, notifies BU Leads, blocks reporting, no zero/NON_COMPLIANT, excluded from quarter", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const hr = await c.user(["HR"], w.buA, "hr");
      const wk2 = await weekId(c, "2031-01-13");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("declare_organization_holiday", w.leadA, [wk2], "Closure", "k1"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("declare_organization_holiday", hr, [wk2], " ", "k1"));
      const r1 = await c.rpc<{ replayed: boolean }>("declare_organization_holiday", hr, [wk2], "Office closure", "k1");
      const r2 = await c.rpc<{ replayed: boolean }>("declare_organization_holiday", hr, [wk2], "Office closure", "k1");
      expect(r1.replayed).toBe(false);
      expect(r2.replayed).toBe(true);
      expect((await c.q("select count(*)::int n from reporting_week_state_events where reporting_week_id = $1", [wk2]))[0].n).toBe(1);
      expect((await c.q("select count(*)::int n from notifications where event_type = 'ORGANIZATION_HOLIDAY' and user_id = $1", [w.leadA]))[0].n).toBe(1);
      expect((await c.q("select count(*)::int n from audit_logs where action = 'ORGANIZATION_HOLIDAY_DECLARED'"))[0].n).toBe(1);
      await c.expectError("PERMISSION_DENIED", () => c.q("update reporting_weeks set reporting_state = 'NORMAL' where id = $1", [wk2])); // direct write blocked
      await c.expectError("IMMUTABLE_RECORD", () => c.q("delete from reporting_week_state_events"));
      await c.setNow("2031-01-14T09:00:00+01:00");
      await c.expectError("REPORTING_NOT_REQUIRED", () => c.rpc("get_or_create_weekly_report", w.leadA, wk2));
      // week 2 final lock: nothing generated for a holiday week
      await c.setNow("2031-01-21T11:00:00+01:00");
      await c.rpc("finalize_reporting_week", wk2);
      expect((await c.q("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [wk2]))[0].n).toBe(0);
      expect((await c.q("select count(*)::int n from weekly_compliance where reporting_week_id = $1", [wk2]))[0].n).toBe(0);
      const qs = await c.rpc<{ denominator_count: number; excluded_holiday_count: number }>("calculate_quarterly_score", w.strat.quarterId, w.buA);
      expect(qs.denominator_count).toBe(12); // 13 weeks - 1 holiday
      expect(qs.excluded_holiday_count).toBe(1);
    });
  });
});

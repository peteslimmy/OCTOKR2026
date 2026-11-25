import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

// The organisation-wide Off/On switch for the content locks (migration 20261112000001).
// OFF holds open the weeks that are open, reuses the single-week suspension, never touches the final lock, ends by itself at its resume time, and is a Super Admin's switch.
async function world(c: Ctx) {
  const bu = await c.bu("PAUSE");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const strat = await seedStrategy(c, admin);
  const wk = await weekId(c);
  await c.setNow(W1.open);
  return { bu, admin, sa, lead, strat, wk };
}

const REASON = "Business Unit Leads are finishing their reports by hand";
type Switched = { replayed: boolean; paused: boolean; weeks_held_open?: number; weeks_restored?: number; resume_at?: string | null };
const setPause = (c: Ctx, who: string, paused: boolean, reason: string = REASON, resumeAt: string | null = null) =>
  c.rpc<Switched>("set_reporting_locks_paused", who, paused, reason, resumeAt);
const phase = async (c: Ctx, wk: string) => (await c.q<{ p: string }>("select report_phase($1) p", [wk]))[0].p;
const week = async (c: Ctx, wk: string) => (await c.q<{ locks_suspended_at: string | null; locks_paused_by_org: boolean; locks_suspended_by: string | null; status: string }>(
  "select locks_suspended_at, locks_paused_by_org, locks_suspended_by, status from reporting_weeks where id = $1", [wk]))[0];
const audits = async (c: Ctx, action: string) => Number((await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = $1", [action]))[0].n);
const reportStatus = async (c: Ctx, id: string) => (await c.q<{ status: string }>("select status from weekly_reports where id = $1", [id]))[0].status;

describe("pausing the locks for the whole organisation", () => {
  it("holds the open week open, reopens a report the clock had locked, audits it, and switching on gives the week back to the clock", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["task one"], "Goal one by Friday");
      await c.rpc("submit_weekly_report", w.lead, g.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      await c.rpc("run_scheduled_jobs");
      expect(await phase(c, w.wk)).toBe("CONTENT_LOCKED");
      expect(await reportStatus(c, g.reportId)).toBe("CONTENT_LOCKED");

      const pausedBefore = await audits(c, "REPORTING_LOCKS_PAUSED");
      const suspendedBefore = await audits(c, "REPORTING_WEEK_LOCKS_SUSPENDED");
      const on = await setPause(c, w.sa, true);
      expect([on.replayed, on.paused]).toEqual([false, true]);
      expect(on.weeks_held_open).toBeGreaterThanOrEqual(1);
      expect(await phase(c, w.wk)).toBe("OPEN");
      expect(await reportStatus(c, g.reportId)).toBe("OPEN");
      expect(await week(c, w.wk)).toMatchObject({ locks_paused_by_org: true, locks_suspended_by: w.sa });
      expect(await audits(c, "REPORTING_LOCKS_PAUSED")).toBe(pausedBefore + 1);
      expect(await audits(c, "REPORTING_WEEK_LOCKS_SUSPENDED")).toBeGreaterThan(suspendedBefore);

      const off = await setPause(c, w.sa, false, "The corrections are finished");
      expect([off.replayed, off.paused]).toEqual([false, false]);
      expect(off.weeks_restored).toBeGreaterThanOrEqual(1);
      expect(await week(c, w.wk)).toMatchObject({ locks_suspended_at: null, locks_paused_by_org: false, locks_suspended_by: null });
      expect(await phase(c, w.wk)).toBe("CONTENT_LOCKED");                                         // the clock is in charge again
      expect(await audits(c, "REPORTING_LOCKS_RESUMED")).toBeGreaterThanOrEqual(1);
    });
  });

  it("restores only what the pause suspended: a week a Super Admin suspended on its own stays suspended", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("set_week_locks_suspended", w.sa, w.wk, true, "Held open on its own for one unit");
      await setPause(c, w.sa, true);
      expect(await week(c, w.wk)).toMatchObject({ locks_paused_by_org: false });                  // already suspended: not taken over
      await setPause(c, w.sa, false, "Pause over");
      expect((await week(c, w.wk)).locks_suspended_at).not.toBeNull();
      expect(await phase(c, w.wk)).toBe("OPEN");
    });
  });

  it("is a Super Admin's switch: other roles and direct database access are refused, a reason is required, and the resume time is kept to 30 days", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => setPause(c, w.admin, true));
      await c.expectError("PERMISSION_DENIED", () => setPause(c, w.lead, true));
      await c.expectError("REASON_REQUIRED", () => setPause(c, w.sa, true, "   "));
      await c.expectError("VALIDATION_ERROR", () => setPause(c, w.sa, true, REASON, "2031-01-05T09:00:00+01:00"));      // in the past
      await c.expectError("VALIDATION_ERROR", () => setPause(c, w.sa, true, REASON, "2031-03-01T09:00:00+01:00"));      // more than 30 days away
      await c.expectError("permission denied", () => c.asUser(w.sa, () => setPause(c, w.sa, true)));                      // not callable straight from the browser
      expect((await c.rpc<{ paused: boolean }>("read_lock_pause")).paused).toBe(false);                                   // nothing changed

      const first = await setPause(c, w.sa, true);
      const again = await setPause(c, w.sa, true);
      expect([first.replayed, again.replayed]).toEqual([false, true]);                            // a repeat changes nothing and is not audited twice
      expect(await audits(c, "REPORTING_LOCKS_PAUSED")).toBeGreaterThanOrEqual(1);
    });
  });

  it("never touches the final lock: the week is still finalised and scored on time while the locks are paused", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["task one"], "Goal one by Friday");
      await c.rpc("submit_weekly_report", w.lead, g.reportId, null, null);
      await c.setNow(W1.afterContentLock);
      await setPause(c, w.sa, true);
      expect(await phase(c, w.wk)).toBe("OPEN");
      await c.setNow(W1.finalLock);
      expect(await phase(c, w.wk)).toBe("FINAL_LOCKED");
      await c.rpc("run_scheduled_jobs");
      expect((await week(c, w.wk)).status).toBe("FINAL_LOCKED");
      expect((await c.q<{ n: number }>("select count(*)::int n from weekly_score_snapshots where reporting_week_id = $1", [w.wk]))[0].n).toBeGreaterThan(0);
    });
  });

  it("holds open a week that opens while the pause lasts, and not before it opens", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const wk2 = await weekId(c, "2031-01-13");
      await setPause(c, w.sa, true);
      expect(await week(c, wk2)).toMatchObject({ locks_suspended_at: null });                     // not open yet: left to the clock
      await c.setNow("2031-01-13T09:00:00+01:00");                                                // reporting for week 2 opens on its Monday (opens_at = week start, 00:00 WAT)
      await c.rpc("run_scheduled_jobs");
      expect(await week(c, wk2)).toMatchObject({ locks_paused_by_org: true });
      expect(await phase(c, wk2)).toBe("OPEN");
    });
  });

  it("switches itself back on at the resume time and returns the weeks to the clock", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await setPause(c, w.sa, true, REASON, "2031-01-08T09:00:00+01:00");
      const state = await c.rpc<{ paused: boolean; resume_at: string }>("read_lock_pause");
      expect(state.paused).toBe(true);
      expect(new Date(state.resume_at).toISOString()).toBe("2031-01-08T08:00:00.000Z");
      await c.setNow("2031-01-07T12:00:00+01:00");
      await c.rpc("run_scheduled_jobs");
      expect((await c.rpc<{ paused: boolean }>("read_lock_pause")).paused).toBe(true);            // not yet
      await c.setNow("2031-01-08T10:00:00+01:00");
      await c.rpc("run_scheduled_jobs");
      expect((await c.rpc<{ paused: boolean }>("read_lock_pause")).paused).toBe(false);
      expect(await week(c, w.wk)).toMatchObject({ locks_suspended_at: null, locks_paused_by_org: false });
      expect(await phase(c, w.wk)).toBe("CONTENT_LOCKED");
      const auto = await c.q<{ n: number }>("select count(*)::int n from audit_logs where action = 'REPORTING_LOCKS_RESUMED' and actor_user_id is null and new_values->>'automatic' = 'true'");
      expect(auto[0].n).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows everyone whether the locks are paused, but only managers why and by whom", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await setPause(c, w.sa, true);
      const asLead = await c.asUser(w.lead, () => c.rpc<{ paused: boolean; reason: string | null; paused_by_email: string | null }>("read_lock_pause"));
      expect(asLead.paused).toBe(true);
      expect(asLead.reason).toBeNull();
      expect(asLead.paused_by_email).toBeNull();
      const asSa = await c.asUser(w.sa, () => c.rpc<{ reason: string | null; paused_by_email: string | null }>("read_lock_pause"));
      expect(asSa.reason).toBe(REASON);
      expect(asSa.paused_by_email).toContain("sa-");
    });
  });
});

describe("while the locks are paused the report is fully open (owner, 25 November 2026)", () => {
  it("the BU Lead edits goals and tasks and sets and changes every task's status freely, even on a draft report; when the clock returns the one-way rule and the final lock apply again", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const g = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["task one", "task two"], "Goal one by Friday");
      const tasks = await c.q<{ id: string }>("select t.id from tasks t join smart_goals s on s.id = t.smart_goal_id where s.weekly_report_id = $1 order by t.position", [g.reportId]);
      const [t1, t2] = [tasks[0].id, tasks[1].id];
      const status = async (id: string) => (await c.q<{ status: string }>("select status from tasks where id = $1", [id]))[0].status;

      // not paused: a draft report in an open week cannot have its statuses set (they are set after the content lock)
      await c.expectError("EXECUTION_NOT_OPEN", () => c.rpc("execute_task", w.lead, t1, "DONE"));

      await setPause(c, w.sa, true);
      // paused: any status in any direction, on a report that was never submitted
      await c.rpc("execute_task", w.lead, t1, "DONE");
      await c.rpc("execute_task", w.lead, t1, "NOT_DONE");
      await c.rpc("execute_task", w.lead, t1, "DONE");
      expect(await status(t1)).toBe("DONE");
      expect(await c.rpc<{ unchanged?: boolean }>("execute_task", w.lead, t1, "DONE")).toMatchObject({ unchanged: true });     // the same status again changes nothing
      const history = await c.q<{ from_status: string; to_status: string }>("select from_status, to_status from task_status_history where task_id = $1", [t1]);
      expect(history.map((h) => `${h.from_status}>${h.to_status}`).sort()).toEqual(["DONE>NOT_DONE", "NOT_DONE>DONE", "UNDEFINED>DONE"]);    // the real previous status is kept
      // the content is open too: another goal can be added while paused
      const g2 = await draftGoal(c, w.lead, w.wk, w.strat.subKrIds[0], ["task three"], "A second goal added during the pause");
      expect(g2.goalId).toBeTruthy();

      // the clock returns: the content lock applies, and a status already set can no longer be flipped (Undefined to Done or Not done only)
      await setPause(c, w.sa, false, "The corrections are finished");
      await c.setNow(W1.afterContentLock);
      await c.rpc("run_scheduled_jobs");
      expect(await phase(c, w.wk)).toBe("CONTENT_LOCKED");
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("execute_task", w.lead, t1, "NOT_DONE"));
      await c.rpc("execute_task", w.lead, t2, "DONE");                                                                      // an Undefined one can still be settled once
      // at the final lock whatever is still Undefined becomes Not done
      await c.setNow(W1.finalLock);
      await c.rpc("run_scheduled_jobs");
      const left = await c.q<{ status: string }>("select t.status from tasks t join smart_goals s on s.id = t.smart_goal_id where s.weekly_report_id = $1 and t.deleted_at is null", [g.reportId]);
      expect(left.every((x) => x.status !== "UNDEFINED")).toBe(true);
    });
  });
});

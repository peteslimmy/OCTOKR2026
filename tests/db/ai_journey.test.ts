import { describe, expect, it } from "vitest";
import { aiWorld } from "./ai-world";
import { withTx } from "./helpers";

/**
 * The journey from docs/38 and the brief, as far as the database carries it (the assistant's own steps are tested with a scripted model in src/lib/ai):
 * an activity stays open, the monthly review asks, the unit answers, management is engaged and escalated to, a plan is drafted, submitted and approved by a different
 * person, the case is resolved and closed, and the executive counts move accordingly. Nothing in it changes a goal, a task, a target or a score.
 */
describe("from an unresolved activity to a closed case", () => {
  it("runs end to end, each step recorded and attributable", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      type Counts = { cases: { open: number; highOpen: number; escalated: number; resolvedLast30: number }; closureRequests: { open: number }; approvalsPending: number; awaitingClosureConfirmation: number; plans: { inProgress: number } };
      const counts = (who = w.exec) => c.asUser(who, () => c.rpc<Counts>("read_ai_executive_counts"));
      const frozen = JSON.stringify(await c.q("select id, title, deleted_at from smart_goals order by id")) + JSON.stringify(await c.q("select id, status from tasks order by id")) + JSON.stringify(await c.q("select id, final_score from weekly_score_snapshots order by id"));

      // 5, 6: the agent finds the carried-forward activities and, on the last day of the month, asks the unit about them
      await c.setNow("2031-01-31T09:00:00+01:00");
      const ran = await c.rpc<{ ran: string; monthly: { requested: number; cases: number } }>("ai_run_jobs");
      expect(ran).toMatchObject({ ran: "daily", monthly: { requested: 1, cases: 1 } });
      const req = (await c.q<{ id: string; goal_count: number }>("select id, goal_count from ai_closure_requests"))[0];
      expect(req.goal_count).toBe(3);
      const carry = (await c.q<{ id: string; severity: string }>("select id, severity from ai_cases where fingerprint like 'carry:%'"))[0];
      expect((await counts()).closureRequests.open).toBe(1);

      // the unit is asked for remarks on the tasks that were not done, and answers some
      const remarkReq = (await c.q<{ id: string }>("select id from ai_remark_requests where business_unit_id = $1 and reporting_week_id = $2", [w.buA, w.weeks[2]]))[0];
      const tasks = await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2) order by task_id", [w.buA, w.weeks[2]]);
      await c.rpc("ai_submit_remarks", w.leadA, remarkReq.id, [{ taskId: tasks[0].task_id, reasonCode: "RESOURCES", remark: "No designer" }, { taskId: tasks[1].task_id, reasonCode: "DEPENDENCY", remark: "Waiting on finance" }]);

      // 7, 8: the employee submits dispositions; the answers are recorded as proposals, not applied
      const goals = await c.q<{ subject_goal_id: string }>("select subject_goal_id from ai_closure_items where request_id = $1 order by title", [req.id]);
      const sub = await c.rpc<{ status: string; proposed: number }>("ai_submit_dispositions", w.leadA, req.id, [
        { goalId: goals[0].subject_goal_id, option: "NO_LONGER_REQUIRED", explanation: "Replaced by the new onboarding project" },
        { goalId: goals[1].subject_goal_id, option: "BLOCKED", explanation: "Waiting on finance for the figures" },
        { goalId: goals[2].subject_goal_id, option: "STEPPED_DOWN", explanation: "Reduced to the first two sheets" }]);
      expect(sub).toMatchObject({ status: "ANSWERED", proposed: 2 });
      expect((await counts()).awaitingClosureConfirmation).toBe(2);

      // 10, 11: a serious case engages the unit, and when nobody answers it is escalated to the executives
      const hot = await c.rpc<string>("ai_open_case", "journey-high", "Alpha fell sharply", "UNDERPERFORMING_BU", "Alpha scored far lower than the week before.", w.buA, "HIGH", "Found by the daily review.", [{ text: "The unit recorded RESOURCES for 1 task.", status: "HYPOTHESIS" }], "Ask the unit lead what changed.", [{ kind: "SCORE", summary: "Score fell" }], null, null, null, null);
      await c.rpc("ai_engagement_tick");
      expect((await c.q<{ status: string }>("select status from ai_cases where id = $1", [hot]))[0].status).toBe("AWAITING_RESPONSE");
      await c.setNow("2031-02-03T12:00:00+01:00");
      await c.rpc("ai_engagement_tick");
      expect((await c.q<{ status: string }>("select status from ai_cases where id = $1", [hot]))[0].status).toBe("ESCALATED");
      expect((await counts()).cases.escalated).toBeGreaterThanOrEqual(1);       // Alpha's case, and the case for the unit that filed nothing

      // 9: a corrective plan is drafted by the agent, submitted by a person, approved by a different one
      const plan = await c.rpc<string>("ai_draft_corrective_plan", hot);
      expect(plan).toBeTruthy();
      await c.rpc("ai_add_corrective_action", w.admin, plan, "Review the low weeks with the unit lead and agree three changes", w.buA, "2031-02-14");
      const appr = await c.rpc<string>("ai_submit_plan", w.admin, plan);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_decide_approval", w.admin, appr, true, null));          // the person who submitted it cannot decide it
      expect(await c.rpc("ai_decide_approval", w.sa, appr, true, "Agreed")).toBe("APPROVED");
      expect((await counts()).plans.inProgress).toBe(1);

      // the proposals are decided by a different person
      for (const a of await c.q<{ id: string }>("select id from ai_approvals where subject_type = 'disposition' and status = 'PENDING'")) await c.rpc("ai_decide_approval", w.sa, a.id, true, "Recorded");
      expect((await counts()).awaitingClosureConfirmation).toBe(0);
      expect((await counts(w.sa)).approvalsPending).toBe(0);

      // 12, 13: management reviews, the unit responds, the case is resolved and closed
      await c.rpc("ai_respond_case", w.leadA, hot, "We have asked for cover and agreed three changes.");
      await c.rpc("ai_case_update", w.admin, hot, "RESOLVED", "Cover arranged and the plan is in hand");
      await c.rpc("ai_case_update", w.admin, hot, "CLOSED", null);
      for (const k of await c.q<{ id: string }>("select id from ai_cases where status not in ('RESOLVED', 'CLOSED')")) await c.rpc("ai_case_update", w.admin, k.id, "RESOLVED", "Handled as agreed in the monthly review");
      expect(carry.id).toBeTruthy();

      // 14: the executive view reflects the outcome
      const end = await counts();
      const total = (await c.q<{ n: number }>("select count(*)::int n from ai_cases"))[0].n;
      expect(total).toBeGreaterThanOrEqual(3);
      expect(end.cases.open).toBe(0);
      expect(end.cases.resolvedLast30).toBe(total);
      expect(end.closureRequests.open).toBe(0);

      // every step is on the record: the timeline of the case, and the audit log, name who did what
      const events = (await c.q<{ event_type: string }>("select event_type from ai_case_events where case_id = $1 order by seq", [hot])).map((e) => e.event_type);
      expect(events).toEqual(expect.arrayContaining(["CREATED", "COMMUNICATION", "ESCALATION", "ACTION", "APPROVAL", "RESPONSE", "STATUS_CHANGE"]));
      const audit = (await c.q<{ action: string }>("select action from audit_logs where action like 'AI\\_%'")).map((a) => a.action);
      expect(audit).toEqual(expect.arrayContaining(["AI_CLOSURE_REQUESTED", "AI_REMARK_REQUESTED", "AI_REMARKS_SUBMITTED", "AI_DISPOSITIONS_SUBMITTED", "AI_CASE_OPENED", "AI_CASE_RESPONDED", "AI_CASE_RESOLVED", "AI_CASE_CLOSED", "AI_PLAN_SUBMITTED", "AI_APPROVAL_APPROVED"]));

      // and through all of it no goal, task or score was changed
      expect(JSON.stringify(await c.q("select id, title, deleted_at from smart_goals order by id")) + JSON.stringify(await c.q("select id, status from tasks order by id")) + JSON.stringify(await c.q("select id, final_score from weekly_score_snapshots order by id"))).toBe(frozen);
    });
  });
});

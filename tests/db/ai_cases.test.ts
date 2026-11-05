import { describe, expect, it } from "vitest";
import { W1, draftGoal, evalJson, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * Unit ALPHA sets the same three goals in weeks 1 to 3 of 2031 and finishes none of them; unit BRAVO files and finishes its goal each week; CHARLIE files nothing.
 * Weeks 1 to 3 are finalised. 4COREPAL is on. "Now" is the end of week 3 (28 Jan 2031).
 */
const GOALS = ["Publish the pricing sheets by Friday", "Run one customer interview by Thursday", "Send the onboarding guide to finance"];
async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"), buB = await c.bu("BRAVO"), buC = await c.bu("CHARLIE");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa"), sa2 = await c.user(["SUPER_ADMIN"], buA, "sa2"), admin = await c.user(["ADMIN"], buA, "admin"), exec = await c.user(["EXECUTIVE"], buA, "exec");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"), leadA2 = await c.user(["BU_LEAD"], buA, "leadA2"), leadB = await c.user(["BU_LEAD"], buB, "leadB"), leadC = await c.user(["BU_LEAD"], buC, "leadC");
  const strat = await seedStrategy(c, admin);
  const weeks = [["2031-01-06", W1.open, W1.afterContentLock, W1.finalLock], ["2031-01-13", "2031-01-13T09:00:00+01:00", "2031-01-14T18:00:01+01:00", "2031-01-21T11:00:00+01:00"], ["2031-01-20", "2031-01-20T09:00:00+01:00", "2031-01-21T18:00:01+01:00", "2031-01-28T11:00:00+01:00"]];
  const ids: string[] = [];
  for (const [monday, open, locked, final] of weeks) {
    const wk = await weekId(c, monday); ids.push(wk);
    await c.setNow(open);
    const a = await draftGoal(c, leadA, wk, strat.subKrIds[0], ["Do the first part", "Do the second part"], GOALS[0]);
    let v = a.version;
    for (const t of GOALS.slice(1)) v = (await c.rpc<{ version: number }>("create_goal", leadA, a.reportId, "STRETCH", null, t, null, [{ description: "Do the work" }], evalJson, v)).version;
    const b = await draftGoal(c, leadB, wk, strat.subKrIds[1], ["Close the BRAVO proposal"], "Close two open proposals by Friday");
    await c.rpc("submit_weekly_report", leadA, a.reportId, null, null); await c.rpc("submit_weekly_report", leadB, b.reportId, null, null);
    await c.setNow(locked);
    const tasks = await c.q<{ id: string; bu: string }>("select t.id, t.business_unit_id bu from tasks t join smart_goals g on g.id = t.smart_goal_id join weekly_reports r on r.id = g.weekly_report_id where r.reporting_week_id = $1", [wk]);
    for (const t of tasks) await c.rpc("execute_task", t.bu === buB ? leadB : leadA, t.id, t.bu === buB ? "DONE" : "NOT_DONE");
    await c.setNow(final); await c.rpc("finalize_reporting_week", wk);
  }
  await c.rpc("ai_set_setting", sa, "enabled", true);
  return { buA, buB, buC, sa, sa2, admin, exec, leadA, leadA2, leadB, leadC, weeks: ids };
}
type W = Awaited<ReturnType<typeof world>>;
const notes = (c: Ctx, event: string) => c.q<{ user_id: string }>("select user_id from notifications where event_type = $1", [event]).then((r) => r.map((x) => x.user_id));
const mkCase = (c: Ctx, bu: string | null, severity = "MEDIUM", fp: string | null = null) =>
  c.rpc<string>("ai_open_case", fp, "A test case", "OTHER", "Something to look at", bu, severity, "assessment", "[]", "recommendation", [{ kind: "OTHER", summary: "evidence" }], null, null, null, null);
const status = (c: Ctx, id: string) => c.q<{ status: string; responded_at: string | null }>("select status, responded_at from ai_cases where id = $1", [id]).then((r) => r[0]);

describe("cases", () => {
  it("opens once per observation, with its evidence, a reference and a timeline entry", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const a = await mkCase(c, w.buA, "MEDIUM", "same-observation"), b = await mkCase(c, w.buA, "MEDIUM", "same-observation");
      expect(b).toBe(a);
      const row = (await c.q<{ reference: string; created_by_agent: boolean }>("select reference, created_by_agent from ai_cases where id = $1", [a]))[0];
      expect(row.reference).toMatch(/^PIC-\d{4}-\d{6}$/);
      expect(row.created_by_agent).toBe(true);
      expect((await c.q("select 1 from ai_case_evidence where case_id = $1", [a])).length).toBe(1);
      expect((await c.q<{ event_type: string }>("select event_type from ai_case_events where case_id = $1", [a])).map((e) => e.event_type)).toEqual(["CREATED"]);
    });
  });

  it("is not opened while the module is off or opening cases is not automatic; a manager may open one by hand", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_set_policy", w.sa, "OPEN_CASE", "NEEDS_APPROVAL");
      expect(await mkCase(c, w.buA)).toBeNull();
      const manual = await c.rpc<string>("ai_open_case", null, "By hand", "OTHER", "d", w.buA, "LOW", "a", "[]", "r", "[]", null, null, null, w.admin);
      expect(manual).toBeTruthy();
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_open_case", null, "By a lead", "OTHER", "d", w.buA, "LOW", "a", "[]", "r", "[]", null, null, null, w.leadA));
      expect((await c.q<{ created_by_agent: boolean }>("select created_by_agent from ai_cases where id = $1", [manual]))[0].created_by_agent).toBe(false);
    });
  });

  it("a high finding becomes one case with the unit's own reasons as hypotheses, not as confirmed causes", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("insert into ai_findings (kind, business_unit_id, reporting_week_id, severity, summary, fingerprint) values ('SCORE_DROP', $1, $2, 'HIGH', 'ALPHA fell sharply', 'drop-test')", [w.buA, w.weeks[2]]);
      expect(await c.rpc<number>("ai_cases_from_findings")).toBe(1);
      expect(await c.rpc<number>("ai_cases_from_findings")).toBe(0);
      const k = (await c.q<{ category: string; hypotheses: { status: string }[]; severity: string }>("select category, hypotheses, severity from ai_cases where fingerprint like 'finding:%'"))[0];
      expect(k).toMatchObject({ category: "UNDERPERFORMING_BU", severity: "HIGH" });
      expect((await c.q<{ state: string }>("select state from ai_findings where fingerprint = 'drop-test'"))[0].state).toBe("CASE_OPENED");
      expect(k.hypotheses.every((h) => h.status === "HYPOTHESIS")).toBe(true);
    });
  });

  it("a lower-severity finding opens no case", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("insert into ai_findings (kind, business_unit_id, severity, summary, fingerprint) values ('MISSED_REPORT', $1, 'MEDIUM', 'x', 'm1')", [w.buC]);
      expect(await c.rpc<number>("ai_cases_from_findings")).toBe(0);
    });
  });
});

describe("who is asked, and when", () => {
  it("a medium case asks the unit's leads first; executives only after the policy's hours without a response; nobody twice", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await mkCase(c, w.buA, "MEDIUM");
      expect(await c.rpc("ai_engagement_tick")).toMatchObject({ asked: 1, escalated: 0 });
      expect((await notes(c, "AI_CASE")).sort()).toEqual([w.leadA, w.leadA2].sort());
      expect((await status(c, id)).status).toBe("AWAITING_RESPONSE");
      expect(await notes(c, "AI_CASE_ESCALATION")).toHaveLength(0);
      await c.rpc("ai_engagement_tick");
      expect(await notes(c, "AI_CASE")).toHaveLength(2);
      await c.setNow("2031-02-01T12:00:00+01:00");           // 4+ days later: past the 96 hours
      expect(await c.rpc("ai_engagement_tick")).toMatchObject({ escalated: 1 });
      const to = await notes(c, "AI_CASE_ESCALATION");
      expect(to).toEqual(expect.arrayContaining([w.exec, w.sa]));
      expect(to).not.toContain(w.leadA);
      expect((await status(c, id)).status).toBe("ESCALATED");
      await c.rpc("ai_engagement_tick");
      expect(await notes(c, "AI_CASE_ESCALATION")).toHaveLength(to.length);
      expect((await c.q<{ event_type: string }>("select event_type from ai_case_events where case_id = $1 order by seq", [id])).map((e) => e.event_type)).toEqual(["CREATED", "COMMUNICATION", "ESCALATION"]);
    });
  });

  it("a response from the unit stops the escalation", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await mkCase(c, w.buA, "MEDIUM");
      await c.rpc("ai_engagement_tick");
      await c.rpc("ai_respond_case", w.leadA, id, "We are short of a designer; we have asked for cover.");
      expect(await status(c, id)).toMatchObject({ status: "UNDER_INVESTIGATION" });
      expect((await status(c, id)).responded_at).not.toBeNull();
      await c.setNow("2031-02-10T12:00:00+01:00");
      expect(await c.rpc("ai_engagement_tick")).toMatchObject({ asked: 0, escalated: 0 });
      expect(await notes(c, "AI_CASE_ESCALATION")).toHaveLength(0);
      expect((await c.q<{ response: string; follow_up_status: string }>("select response, follow_up_status from ai_communications where case_id = $1 and recipient_user_id = $2", [id, w.leadA]))[0]).toMatchObject({ follow_up_status: "DONE" });
    });
  });

  it("a critical case goes to the unit and the executives at once", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await mkCase(c, w.buA, "CRITICAL");
      expect(await c.rpc("ai_engagement_tick")).toMatchObject({ asked: 1, escalated: 1 });
      expect(await notes(c, "AI_CASE")).toHaveLength(2);
      expect((await notes(c, "AI_CASE_ESCALATION")).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("an organisation-wide case has no unit lead to ask, so it goes to the executives", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await mkCase(c, null, "CRITICAL");
      await c.rpc("ai_engagement_tick");
      expect(await notes(c, "AI_CASE")).toHaveLength(0);
      expect(await notes(c, "AI_CASE_ESCALATION")).toEqual(expect.arrayContaining([w.exec]));
      expect((await status(c, id)).status).toBe("ESCALATED");
    });
  });

  it("does nothing while asking for explanations is not automatic", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await mkCase(c, w.buA, "CRITICAL");
      await c.rpc("ai_set_policy", w.sa, "REQUEST_EXPLANATION", "NEEDS_APPROVAL");
      expect(await c.rpc("ai_engagement_tick")).toHaveProperty("skipped");
      expect(await notes(c, "AI_CASE")).toHaveLength(0);
    });
  });
});

describe("responding and managing", () => {
  it("only a person of the case's unit responds; not another unit, not an executive; not on a resolved case; not with nothing", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await mkCase(c, w.buA, "MEDIUM");
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_respond_case", w.leadB, id, "not mine"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_respond_case", w.exec, id, "I am an executive"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_respond_case", w.leadA, id, "   "));
      await c.rpc("ai_case_update", w.admin, id, "RESOLVED", "Fixed by the unit");
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("ai_respond_case", w.leadA, id, "too late"));
    });
  });

  it("managers move a case along; a lead cannot; resolving needs a written resolution; closing only follows resolving; the unit is told", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await mkCase(c, w.buA, "MEDIUM");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_case_update", w.leadA, id, "RESOLVED", "I fixed it myself"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_case_update", w.exec, id, "UNDER_INVESTIGATION", null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_case_update", w.admin, id, "RESOLVED", " "));
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("ai_case_update", w.admin, id, "CLOSED", null));
      await c.rpc("ai_case_update", w.admin, id, "INTERVENTION_REQUIRED", "Needs the director");
      await c.rpc("ai_case_update", w.admin, id, "RESOLVED", "Cover arranged; two goals retired by agreement");
      expect((await notes(c, "AI_CASE_RESOLVED")).sort()).toEqual([w.leadA, w.leadA2].sort());
      await c.rpc("ai_case_update", w.admin, id, "CLOSED", null);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("ai_case_update", w.admin, id, "UNDER_INVESTIGATION", null));
      const k = (await c.q<{ resolution: string; closed_at: string | null }>("select resolution, closed_at from ai_cases where id = $1", [id]))[0];
      expect(k.resolution).toContain("Cover arranged");
      expect(k.closed_at).not.toBeNull();
      expect((await c.q<{ event_type: string }>("select event_type from ai_case_events where case_id = $1 and event_type = 'STATUS_CHANGE'", [id])).length).toBe(3);
      expect((await c.q("select 1 from audit_logs where action in ('AI_CASE_RESOLVED', 'AI_CASE_CLOSED')")).length).toBe(2);
    });
  });

  it("a lead sees their unit's cases and its timeline, not another unit's", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const a = await mkCase(c, w.buA), b = await mkCase(c, w.buB);
      expect((await c.asUser(w.leadA, () => c.q<{ id: string }>("select id from ai_cases"))).map((r) => r.id)).toEqual([a]);
      expect(await c.asUser(w.leadA, () => c.q("select 1 from ai_case_events where case_id = $1", [b]))).toHaveLength(0);
      expect((await c.asUser(w.exec, () => c.q("select id from ai_cases"))).length).toBe(2);
    });
  });
});

describe("corrective plans", () => {
  const plan = async (c: Ctx, w: W, severity = "HIGH") => {
    const id = await mkCase(c, w.buA, severity);
    const p = await c.rpc<string>("ai_draft_corrective_plan", id);
    return { id, p };
  };
  it("are drafted only for high and critical cases of a unit, once, with a baseline and an honest root-cause note", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const low = await mkCase(c, w.buA, "MEDIUM");
      expect(await c.rpc("ai_draft_corrective_plan", low)).toBeNull();
      const { id, p } = await plan(c, w);
      expect(p).toBeTruthy();
      expect(await c.rpc("ai_draft_corrective_plan", id)).toBeNull();
      const row = (await c.q<{ status: string; root_cause_assessment: string; baseline_score: string | null; created_by_agent: boolean }>("select status, root_cause_assessment, baseline_score, created_by_agent from ai_corrective_plans where id = $1", [p]))[0];
      expect(row.status).toBe("DRAFT");
      expect(row.root_cause_assessment).toMatch(/^Not established/);
      expect(row.baseline_score).not.toBeNull();
    });
  });

  it("a person submits it, a different person approves it, and only then do the unit's actions begin", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { id, p } = await plan(c, w);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_submit_plan", w.admin, p));                                    // no action yet
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_add_corrective_action", w.leadA, p, "Do it", w.buA, null));
      const act = await c.rpc<string>("ai_add_corrective_action", w.admin, p, "Agree a named person to file the weekly report", w.buA, "2031-02-10");
      const appr = await c.rpc<string>("ai_submit_plan", w.admin, p);
      expect((await c.q<{ status: string }>("select status from ai_corrective_plans where id = $1", [p]))[0].status).toBe("PROPOSED");
      expect(await notes(c, "AI_APPROVAL_REQUEST")).toEqual(expect.arrayContaining([w.sa, w.sa2]));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_decide_approval", w.admin, appr, true, null));                // the submitter lacks the permission
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("ai_set_action_status", w.leadA, act, "DONE", null));      // not approved yet
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_decide_approval", w.sa, appr, false, " "));
      expect(await c.rpc("ai_decide_approval", w.sa, appr, true, "Agreed")).toBe("APPROVED");
      expect((await c.q<{ status: string }>("select status from ai_corrective_plans where id = $1", [p]))[0].status).toBe("IN_PROGRESS");
      expect((await status(c, id)).status).toBe("CORRECTIVE_ACTION_IN_PROGRESS");
      expect((await notes(c, "AI_PLAN_DECIDED")).sort()).toEqual([w.leadA, w.leadA2].sort());
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("ai_decide_approval", w.sa2, appr, true, null));          // decided once
    });
  });

  it("nobody approves their own submission, and a rejection ends the plan with its reason", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { p } = await plan(c, w);
      await c.rpc("ai_add_corrective_action", w.sa, p, "Review the low weeks with the unit lead", w.buA, null);
      const appr = await c.rpc<string>("ai_submit_plan", w.sa, p);
      await c.expectError("SEPARATION_OF_DUTIES", () => c.rpc("ai_decide_approval", w.sa, appr, true, null));
      expect(await c.rpc("ai_decide_approval", w.sa2, appr, false, "The unit has asked for a different approach")).toBe("REJECTED");
      expect((await c.q<{ status: string; decision_note: string }>("select status, decision_note from ai_corrective_plans where id = $1", [p]))[0]).toMatchObject({ status: "REJECTED", decision_note: "The unit has asked for a different approach" });
    });
  });

  it("the unit marks its own actions done or blocked (blocked needs a reason); others cannot", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { p } = await plan(c, w);
      const act = await c.rpc<string>("ai_add_corrective_action", w.admin, p, "Name a person to file the weekly report", w.buA, null);
      await c.rpc("ai_decide_approval", w.sa, await c.rpc<string>("ai_submit_plan", w.admin, p), true, null);
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_set_action_status", w.leadB, act, "DONE", null));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_action_status", w.leadA, act, "BLOCKED", " "));
      await c.rpc("ai_set_action_status", w.leadA, act, "BLOCKED", "Waiting for the director's decision");
      await c.rpc("ai_set_action_status", w.leadA, act, "DONE", null);
      expect((await c.q<{ status: string; completed_at: string | null }>("select status, completed_at from ai_corrective_actions where id = $1", [act]))[0].completed_at).not.toBeNull();
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_set_action_status", w.leadA, act, "CANCELLED", null));
    });
  });

  it("effectiveness is judged on the unit's scores after the plan started, never on the actions being ticked done", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { p } = await plan(c, w);
      const act = await c.rpc<string>("ai_add_corrective_action", w.admin, p, "Fix it", w.buA, null);
      await c.rpc("ai_decide_approval", w.sa, await c.rpc<string>("ai_submit_plan", w.admin, p), true, null);
      await c.rpc("ai_set_action_status", w.leadA, act, "DONE", null);                   // every action is done...
      const recent = (await c.q<{ score: string; weeks: number }>("select score, weeks from ai_unit_scores($1, null, 3)", [w.buA]))[0];
      expect(recent.weeks).toBe(3);
      await c.q("update ai_corrective_plans set started_at = $2, baseline_score = 90, review_date = '2031-01-01' where id = $1", [p, "2031-01-01T00:00:00Z"]);
      expect(await c.rpc<number>("ai_review_plans")).toBe(1);
      const r = (await c.q<{ effectiveness: string; status: string; review_score: string }>("select effectiveness, status, review_score from ai_corrective_plans where id = $1", [p]))[0];
      expect(Number(r.review_score)).toBeLessThan(90);
      expect(r).toMatchObject({ effectiveness: "WORSE", status: "COMPLETED" });          // ...and the scores still say it did not work
      expect(await c.rpc<number>("ai_review_plans")).toBe(0);
    });
  });

  it("with fewer than two weeks of scores since it started, the verdict waits and then says there is not enough data", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { p } = await plan(c, w);
      await c.rpc("ai_add_corrective_action", w.admin, p, "Fix it", w.buA, null);
      await c.rpc("ai_decide_approval", w.sa, await c.rpc<string>("ai_submit_plan", w.admin, p), true, null);
      await c.q("update ai_corrective_plans set started_at = '2031-02-01T00:00:00Z', review_date = '2031-02-01' where id = $1", [p]);
      await c.setNow("2031-02-05T09:00:00+01:00");
      expect(await c.rpc<number>("ai_review_plans")).toBe(0);
      await c.setNow("2031-03-10T09:00:00+01:00");
      expect(await c.rpc<number>("ai_review_plans")).toBe(1);
      expect((await c.q<{ effectiveness: string }>("select effectiveness from ai_corrective_plans where id = $1", [p]))[0].effectiveness).toBe("INSUFFICIENT_DATA");
    });
  });
});

describe("the monthly closure of open activities", () => {
  const request = async (c: Ctx, w: W) => {
    await c.setNow("2031-01-31T09:00:00+01:00");
    const r = await c.rpc<{ monthly: { requested: number; cases: number } }>("ai_run_jobs");
    const req = (await c.q<{ id: string; goal_count: number }>("select id, goal_count from ai_closure_requests"))[0];
    return { r, req, w };
  };

  it("finds the goals set in three finished weeks and never finished, matched on their exact wording", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const rows = await c.q<{ business_unit_id: string; title: string; weeks_set: number }>("select business_unit_id, title, weeks_set from ai_closure_candidates() order by title");
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.business_unit_id === w.buA && r.weeks_set === 3)).toBe(true);
    });
  });

  it("asks on the last day of the month: one request per unit, to its leads, and a case when three or more goals are carried", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { r, req } = await request(c, w);
      expect(r.monthly).toMatchObject({ requested: 1, cases: 1 });
      expect(req.goal_count).toBe(3);
      expect((await notes(c, "AI_CLOSURE_REQUEST")).sort()).toEqual([w.leadA, w.leadA2].sort());
      expect((await c.q<{ category: string; severity: string }>("select category, severity from ai_cases where fingerprint like 'carry:%'"))[0]).toMatchObject({ category: "REPEATED_DELAYS", severity: "MEDIUM" });
      await c.rpc("ai_closure_tick", "2031-01-01");                                      // run again: nothing new
      expect((await c.q("select 1 from ai_closure_requests")).length).toBe(1);
      expect(await notes(c, "AI_CLOSURE_REQUEST")).toHaveLength(2);
    });
  });

  it("is not asked on an ordinary day of the month", async () => {
    await withTx(async (c) => {
      await world(c);
      await c.setNow("2031-01-29T09:00:00+01:00");
      const r = await c.rpc<Record<string, unknown>>("ai_run_jobs");
      expect(r).not.toHaveProperty("monthly");
      expect(await c.q("select 1 from ai_closure_requests")).toHaveLength(0);
    });
  });

  it("answers become proposals that wait for a different person; only two options need no decision; nothing official changes", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { req } = await request(c, w);
      const goals = await c.q<{ subject_goal_id: string; title: string }>("select subject_goal_id, title from ai_closure_items where request_id = $1 order by title", [req.id]);
      const before = JSON.stringify(await c.q("select id, title, deleted_at from smart_goals order by id")) + JSON.stringify(await c.q("select id, status from tasks order by id"));
      const first = await c.rpc<{ answered: number; status: string; proposed: number }>("ai_submit_dispositions", w.leadA, req.id, [
        { goalId: goals[0].subject_goal_id, option: "IN_PROGRESS", explanation: "" }, { goalId: goals[1].subject_goal_id, option: "NO_LONGER_REQUIRED", explanation: "Replaced by the new onboarding project" }]);
      expect(first).toMatchObject({ answered: 2, status: "PARTIAL", proposed: 1 });
      const ds = await c.q<{ option_code: string; status: string }>("select option_code, status from ai_dispositions order by option_code");
      expect(ds).toEqual([{ option_code: "IN_PROGRESS", status: "APPLIED" }, { option_code: "NO_LONGER_REQUIRED", status: "PROPOSED" }]);
      const appr = (await c.q<{ id: string; requested_by: string }>("select id, requested_by from ai_approvals where subject_type = 'disposition'"))[0];
      expect(appr.requested_by).toBe(w.leadA);
      expect(await notes(c, "AI_APPROVAL_REQUEST")).toEqual(expect.arrayContaining([w.sa]));
      const last = await c.rpc<{ status: string }>("ai_submit_dispositions", w.leadA2, req.id, [{ goalId: goals[2].subject_goal_id, option: "BLOCKED", explanation: "Waiting on finance to supply the figures" }]);
      expect(last.status).toBe("ANSWERED");
      expect(JSON.stringify(await c.q("select id, title, deleted_at from smart_goals order by id")) + JSON.stringify(await c.q("select id, status from tasks order by id"))).toBe(before);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_decide_approval", w.leadA, appr.id, true, null));
      expect(await c.rpc("ai_decide_approval", w.sa, appr.id, true, "Agreed: the project replaces it")).toBe("APPROVED");
      expect((await c.q<{ status: string }>("select status from ai_dispositions where option_code = 'NO_LONGER_REQUIRED'"))[0].status).toBe("APPROVED");
    });
  });

  it("refuses a goal that is not on the review, a bad option, a missing explanation, another unit's lead and a second answer, all or none", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { req } = await request(c, w);
      const goals = await c.q<{ subject_goal_id: string }>("select subject_goal_id from ai_closure_items where request_id = $1", [req.id]);
      const g = goals[0].subject_goal_id;
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_submit_dispositions", w.leadB, req.id, [{ goalId: g, option: "IN_PROGRESS" }]));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_submit_dispositions", w.exec, req.id, [{ goalId: g, option: "IN_PROGRESS" }]));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_submit_dispositions", w.leadA, req.id, [{ goalId: g, option: "IN_PROGRESS" }, { goalId: "11111111-1111-4111-8111-111111111111", option: "IN_PROGRESS" }]));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_submit_dispositions", w.leadA, req.id, [{ goalId: g, option: "WHATEVER", explanation: "because" }]));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_submit_dispositions", w.leadA, req.id, [{ goalId: g, option: "DEFERRED", explanation: "" }]));
      expect(await c.q("select 1 from ai_dispositions")).toHaveLength(0);
      await c.rpc("ai_submit_dispositions", w.leadA, req.id, [{ goalId: g, option: "IN_PROGRESS" }]);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_submit_dispositions", w.leadA2, req.id, [{ goalId: g, option: "BLOCKED", explanation: "second answer" }]));
    });
  });

  it("an answered goal is not asked about again next month, but an unanswered one is", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { req } = await request(c, w);
      const goals = await c.q<{ subject_goal_id: string }>("select subject_goal_id from ai_closure_items where request_id = $1 order by title", [req.id]);
      await c.rpc("ai_submit_dispositions", w.leadA, req.id, [{ goalId: goals[0].subject_goal_id, option: "IN_PROGRESS" }]);
      expect(await c.q("select 1 from ai_closure_candidates()")).toHaveLength(2);
    });
  });

  it("an unanswered review is reminded once and escalated once to the executives", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await request(c, w);
      await c.setNow("2031-02-02T09:00:00+01:00");
      expect(await c.rpc("ai_closure_tick", "2031-01-01")).toMatchObject({ reminded: 1, escalated: 0 });
      await c.setNow("2031-02-06T09:00:00+01:00");
      expect(await c.rpc("ai_closure_tick", "2031-01-01")).toMatchObject({ reminded: 0, escalated: 1 });
      expect(await notes(c, "AI_ESCALATION")).toEqual(expect.arrayContaining([w.exec]));
      expect((await c.q<{ status: string }>("select status from ai_closure_requests"))[0].status).toBe("ESCALATED");
    });
  });

  it("the form reads the review with each goal's history, and only its own unit and executives can read it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const { req } = await request(c, w);
      type V = { unit: string; items: { title: string; weeksSet: number; history: unknown[] }[] } | null;
      const mine = await c.asUser(w.leadA, () => c.rpc<V>("read_ai_closure_request", req.id));
      expect(mine?.items).toHaveLength(3);
      expect(mine?.items[0]).toMatchObject({ weeksSet: 3 });
      expect(mine?.items[0].history).toHaveLength(3);
      expect(await c.asUser(w.leadB, () => c.rpc<V>("read_ai_closure_request", req.id))).toBeNull();
      expect((await c.asUser(w.exec, () => c.rpc<V>("read_ai_closure_request", req.id)))?.items).toHaveLength(3);
    });
  });
});

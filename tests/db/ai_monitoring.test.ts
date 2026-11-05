import { describe, expect, it } from "vitest";
import { W1, draftGoal, evalJson, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

/**
 * Week 1 (6 Jan 2031): unit ALPHA files one goal with three tasks (one Done, two Not Done) and a second goal with one task (Not Done); unit BRAVO files one goal
 * with one task, Done; unit CHARLIE files nothing. Week 1 is then finalised. 4COREPAL is switched on.
 */
async function world(c: Ctx, opts: { finalise?: boolean } = { finalise: true }) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA"), buB = await c.bu("BRAVO"), buC = await c.bu("CHARLIE");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa"), admin = await c.user(["ADMIN"], buA, "admin"), exec = await c.user(["EXECUTIVE"], buA, "exec");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"), leadA2 = await c.user(["BU_LEAD"], buA, "leadA2"), leadB = await c.user(["BU_LEAD"], buB, "leadB"), leadC = await c.user(["BU_LEAD"], buC, "leadC");
  const strat = await seedStrategy(c, admin);
  const w1 = await weekId(c, "2031-01-06");
  await c.setNow(W1.open);
  const a = await draftGoal(c, leadA, w1, strat.subKrIds[0], ["Ship the pricing sheet", "Review it with sales", "Send it to finance"], "Publish the pricing sheets by Friday");
  await c.rpc("create_goal", leadA, a.reportId, "STRETCH", null, "Run one customer interview by Thursday", null, [{ description: "Interview one customer" }], evalJson, a.version);
  const b = await draftGoal(c, leadB, w1, strat.subKrIds[1], ["Close the BRAVO proposal"], "Close two open proposals by Friday");
  await c.rpc("submit_weekly_report", leadA, a.reportId, null, null);
  await c.rpc("submit_weekly_report", leadB, b.reportId, null, null);
  await c.setNow(W1.afterContentLock);
  const rows = (rid: string) => c.q<{ id: string; description: string }>("select t.id, t.description from tasks t join smart_goals g on g.id = t.smart_goal_id where g.weekly_report_id = $1 order by g.position, t.position", [rid]);
  const ta = await rows(a.reportId), tb = await rows(b.reportId);
  await c.rpc("execute_task", leadA, ta[0].id, "DONE");
  for (const t of ta.slice(1)) await c.rpc("execute_task", leadA, t.id, "NOT_DONE");
  await c.rpc("execute_task", leadB, tb[0].id, "DONE");
  await c.rpc("ai_set_setting", sa, "enabled", true);
  if (opts.finalise) { await c.setNow(W1.finalLock); await c.rpc("finalize_reporting_week", w1); }
  return { buA, buB, buC, sa, admin, exec, leadA, leadA2, leadB, leadC, w1, ta, tb, aReport: a.reportId };
}
type W = Awaited<ReturnType<typeof world>>;
const requests = (c: Ctx) => c.q<{ id: string; business_unit_id: string; task_count: number; status: string; reminded_at: string | null; escalated_at: string | null }>("select * from ai_remark_requests order by business_unit_id");
const notes = (c: Ctx, event: string) => c.q<{ user_id: string; dedupe_key: string }>("select user_id, dedupe_key from notifications where event_type = $1", [event]);
const tick = (c: Ctx) => c.rpc<{ requested: number; reminded: number; escalated: number; skipped?: string }>("ai_remark_tick");
const submit = (c: Ctx, who: string, req: string, items: { taskId: string; reasonCode: string; remark?: string }[]) => c.rpc<{ answered: number; outstanding: number; status: string }>("ai_submit_remarks", who, req, items);

describe("which tasks need a remark", () => {
  it("only Not Done tasks of a finalised week of a unit that reports, counted per unit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const cand = await c.q<{ business_unit_id: string; tasks: number }>("select business_unit_id, tasks from ai_remark_candidates()");
      expect(cand).toEqual([{ business_unit_id: w.buA, tasks: 3 }]);      // BRAVO's only task is Done; CHARLIE filed nothing, so it has no tasks
    });
  });
  it("nothing is asked about a week that is not final yet", async () => {
    await withTx(async (c) => {
      await world(c, { finalise: false });
      expect(await c.q("select * from ai_remark_candidates()")).toHaveLength(0);
    });
  });
  it("an old week, beyond the look-back, is not asked about on the first run", async () => {
    await withTx(async (c) => {
      await world(c);
      await c.setNow("2031-03-20T09:00:00+01:00");
      expect(await c.q("select * from ai_remark_candidates()")).toHaveLength(0);
    });
  });
  it("a unit that does not report weekly, and an organisation holiday week, are never asked", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("update business_units set reports_weekly = false where id = $1", [w.buA]);
      expect(await c.q("select * from ai_remark_candidates()")).toHaveLength(0);
      await c.q("update business_units set reports_weekly = true where id = $1", [w.buA]);
      await c.q("alter table reporting_weeks disable trigger reporting_weeks_guard");      // a holiday on a closed week is made by a two-person amendment; this test only needs the state
      await c.q("update reporting_weeks set reporting_state = 'ORGANIZATION_HOLIDAY' where id = $1", [w.w1]);
      expect(await c.q("select * from ai_remark_candidates()")).toHaveLength(0);
    });
  });
});

describe("the request: once per unit and week, to the unit's own people", () => {
  it("asks every lead of the unit once, with an in-app message the email service picks up, and records it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await tick(c)).toMatchObject({ requested: 1, reminded: 0, escalated: 0 });
      const req = await requests(c);
      expect(req).toHaveLength(1);
      expect(req[0]).toMatchObject({ business_unit_id: w.buA, task_count: 3, status: "PENDING" });
      expect((await notes(c, "AI_REMARK_REQUEST")).map((n) => n.user_id).sort()).toEqual([w.leadA, w.leadA2].sort());
      const comms = await c.q<{ recipient_user_id: string; kind: string; follow_up_status: string; notification_id: string | null }>("select recipient_user_id, kind, follow_up_status, notification_id from ai_communications where kind = 'REMARK_REQUEST'");
      expect(comms).toHaveLength(2);
      expect(comms.every((x) => x.follow_up_status === "PENDING" && x.notification_id)).toBe(true);
      expect((await c.q<{ n: number }>("select count(*)::int n from email_outbox o join notifications n on n.id = o.notification_id where n.event_type = 'AI_REMARK_REQUEST'"))[0].n).toBe(2);
      expect((await c.q("select 1 from audit_logs where action = 'AI_REMARK_REQUESTED'")).length).toBe(1);
    });
  });

  it("running again, or many times, asks nobody twice", async () => {
    await withTx(async (c) => {
      await world(c);
      await tick(c); await tick(c); await tick(c);
      expect(await requests(c)).toHaveLength(1);
      expect((await notes(c, "AI_REMARK_REQUEST")).length).toBe(2);
      expect((await c.q("select 1 from ai_communications where kind = 'REMARK_REQUEST'")).length).toBe(2);
    });
  });

  it("does nothing while the module is off, or while the action is not automatic", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_set_policy", w.sa, "REQUEST_REMARK", "NEEDS_APPROVAL");
      expect(await tick(c)).toHaveProperty("skipped");
      await c.rpc("ai_set_policy", w.sa, "REQUEST_REMARK", "AUTO");
      await c.rpc("ai_set_setting", w.sa, "enabled", false);
      expect(await c.rpc("ai_run_jobs")).toEqual({ skipped: "disabled" });
      expect(await tick(c)).toHaveProperty("skipped");
      expect(await requests(c)).toHaveLength(0);
    });
  });

  it("changes no task, no score and no locked week", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const before = JSON.stringify(await c.q("select id, status, updated_at from tasks order by id")) + JSON.stringify(await c.q("select id, status, final_locked_at from weekly_reports order by id"))
        + JSON.stringify(await c.q("select id, final_score from weekly_score_snapshots order by id"));
      await tick(c);
      const after = JSON.stringify(await c.q("select id, status, updated_at from tasks order by id")) + JSON.stringify(await c.q("select id, status, final_locked_at from weekly_reports order by id"))
        + JSON.stringify(await c.q("select id, final_score from weekly_score_snapshots order by id"));
      expect(after).toBe(before);
      expect(w.w1).toBeTruthy();
    });
  });
});

describe("reminder and escalation", () => {
  it("one reminder after the reminder days, and never another", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      await c.setNow("2031-01-15T09:00:00+01:00");
      expect(await tick(c)).toMatchObject({ reminded: 0 });
      await c.setNow("2031-01-17T12:00:00+01:00");
      expect(await tick(c)).toMatchObject({ reminded: 1 });
      expect((await notes(c, "AI_REMARK_REMINDER")).map((n) => n.user_id).sort()).toEqual([w.leadA, w.leadA2].sort());
      await c.setNow("2031-01-18T12:00:00+01:00");
      expect(await tick(c)).toMatchObject({ reminded: 0 });
    });
  });

  it("an unanswered request goes to the executives once, after the escalation days, and is marked escalated", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      await c.setNow("2031-01-20T12:00:00+01:00");
      expect(await tick(c)).toMatchObject({ escalated: 1 });
      const to = (await notes(c, "AI_ESCALATION")).map((n) => n.user_id);
      expect(to).toEqual(expect.arrayContaining([w.exec, w.sa]));
      expect(to).not.toContain(w.leadA);
      expect((await requests(c))[0].status).toBe("ESCALATED");
      await c.setNow("2031-01-25T12:00:00+01:00");
      expect(await tick(c)).toMatchObject({ escalated: 0 });
      expect(await notes(c, "AI_ESCALATION")).toHaveLength(to.length);
    });
  });

  it("an answered request is neither reminded nor escalated", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      const r = (await requests(c))[0];
      await submit(c, w.leadA, r.id, w.ta.slice(1).map((t) => ({ taskId: t.id, reasonCode: "DEPENDENCY", remark: "Waiting on finance" })).concat([]));
      // the third Not Done task is the stretch goal's
      const rest = await c.q<{ id: string }>("select task_id id from ai_unresolved_tasks($1, $2) x where not exists (select 1 from ai_task_remarks m where m.task_id = x.task_id)", [w.buA, w.w1]);
      if (rest.length) await submit(c, w.leadA, r.id, rest.map((t) => ({ taskId: t.id, reasonCode: "PRIORITY_CHANGE" })));
      expect((await requests(c))[0].status).toBe("ANSWERED");
      await c.setNow("2031-01-25T12:00:00+01:00");
      expect(await tick(c)).toMatchObject({ reminded: 0, escalated: 0 });
    });
  });
});

describe("giving remarks", () => {
  it("records a remark per task, keeps the request open until every task has one, then closes it and acknowledges the message", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      const r = (await requests(c))[0];
      const open = await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2) order by task_id", [w.buA, w.w1]);
      expect(open).toHaveLength(3);
      const first = await submit(c, w.leadA, r.id, [{ taskId: open[0].task_id, reasonCode: "RESOURCES", remark: "No designer this week" }]);
      expect(first).toEqual({ answered: 1, outstanding: 2, status: "PARTIAL" });
      expect((await c.q<{ follow_up_status: string; acknowledged_at: string | null }>("select follow_up_status, acknowledged_at from ai_communications where recipient_user_id = $1 and kind = 'REMARK_REQUEST'", [w.leadA]))[0].acknowledged_at).not.toBeNull();
      const last = await submit(c, w.leadA, r.id, open.slice(1).map((t) => ({ taskId: t.task_id, reasonCode: "AWAITING_DECISION" })));
      expect(last).toEqual({ answered: 3, outstanding: 0, status: "ANSWERED" });
      expect((await requests(c))[0].status).toBe("ANSWERED");
      expect((await c.q("select 1 from ai_communications where kind = 'REMARK_REQUEST' and follow_up_status = 'DONE'")).length).toBe(2);
      expect((await c.q("select 1 from audit_logs where action = 'AI_REMARKS_SUBMITTED'")).length).toBe(2);
    });
  });

  it("only a person of the unit can answer for it; executives and other units cannot", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      const r = (await requests(c))[0];
      const t = (await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2)", [w.buA, w.w1]))[0].task_id;
      await c.expectError("BU_SCOPE_DENIED", () => submit(c, w.leadB, r.id, [{ taskId: t, reasonCode: "OTHER", remark: "not mine" }]));
      await c.expectError("PERMISSION_DENIED", () => submit(c, w.exec, r.id, [{ taskId: t, reasonCode: "EXECUTION" }]));
      await c.expectError("PERMISSION_DENIED", () => submit(c, w.admin, r.id, [{ taskId: t, reasonCode: "EXECUTION" }]));
      await c.expectError("NOT_FOUND", () => submit(c, w.leadA, "00000000-0000-4000-8000-000000000000", [{ taskId: t, reasonCode: "EXECUTION" }]));
      expect(await c.q("select 1 from ai_task_remarks")).toHaveLength(0);
    });
  });

  it("refuses a task that is not on the request (another unit's, a Done one), a bad reason, a missing explanation for Other, and a second remark, all or none", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      const r = (await requests(c))[0];
      const open = await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2) order by task_id", [w.buA, w.w1]);
      const done = w.ta[0].id, theirs = w.tb[0].id;
      await c.expectError("VALIDATION_ERROR", () => submit(c, w.leadA, r.id, [{ taskId: open[0].task_id, reasonCode: "EXECUTION" }, { taskId: done, reasonCode: "EXECUTION" }]));
      await c.expectError("VALIDATION_ERROR", () => submit(c, w.leadA, r.id, [{ taskId: theirs, reasonCode: "EXECUTION" }]));
      await c.expectError("VALIDATION_ERROR", () => submit(c, w.leadA, r.id, [{ taskId: open[0].task_id, reasonCode: "BECAUSE" }]));
      await c.expectError("VALIDATION_ERROR", () => submit(c, w.leadA, r.id, [{ taskId: open[0].task_id, reasonCode: "OTHER", remark: "  " }]));
      await c.expectError("VALIDATION_ERROR", () => submit(c, w.leadA, r.id, []));
      expect(await c.q("select 1 from ai_task_remarks")).toHaveLength(0);           // none of the failed attempts, including the first, left a remark behind
      await submit(c, w.leadA, r.id, [{ taskId: open[0].task_id, reasonCode: "EXECUTION" }]);
      await c.expectError("VALIDATION_ERROR", () => submit(c, w.leadA2, r.id, [{ taskId: open[0].task_id, reasonCode: "TECHNICAL" }]));
    });
  });

  it("the form reads the request with its tasks and remarks, for the unit's own lead and for executives, and not for another unit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await tick(c);
      const r = (await requests(c))[0];
      const t = (await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2) order by task_id", [w.buA, w.w1]))[0].task_id;
      await submit(c, w.leadA, r.id, [{ taskId: t, reasonCode: "DEPENDENCY", remark: "Waiting on finance" }]);
      type View = { unit: string; weekNumber: number; tasks: { id: string; reasonCode: string | null; remark: string | null }[] } | null;
      const lead = await c.asUser(w.leadA2, () => c.rpc<View>("read_ai_remark_request", r.id));
      expect(lead?.unit).toBe("BU ALPHA");
      expect(lead?.tasks).toHaveLength(3);
      expect(lead?.tasks.find((x) => x.id === t)).toMatchObject({ reasonCode: "DEPENDENCY", remark: "Waiting on finance" });
      expect((await c.asUser(w.exec, () => c.rpc<View>("read_ai_remark_request", r.id)))?.tasks).toHaveLength(3);
      expect(await c.asUser(w.leadB, () => c.rpc<View>("read_ai_remark_request", r.id))).toBeNull();
      expect(await c.asUser(w.leadC, () => c.q("select id from ai_task_remarks"))).toHaveLength(0);
    });
  });
});

describe("findings", () => {
  it("a unit that filed nothing is found once, however often the scan runs", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const first = await c.rpc<number>("ai_scan_findings");
      expect(first).toBeGreaterThanOrEqual(1);
      expect(await c.rpc<number>("ai_scan_findings")).toBe(0);
      const rows = await c.q<{ kind: string; business_unit_id: string; severity: string }>("select kind, business_unit_id, severity from ai_findings where kind = 'MISSED_REPORT'");
      expect(rows.map((r) => r.business_unit_id)).toEqual([w.buC]);
      expect(rows[0].severity).toBe("MEDIUM");
    });
  });
});

describe("the scheduler", () => {
  it("runs the daily review once a day, after the daily time, and a rerun does nothing", async () => {
    await withTx(async (c) => {
      await world(c);
      await c.setNow("2031-01-14T05:00:00+01:00");           // 05:00 Lagos: before 07:00
      expect(await c.rpc("ai_run_jobs")).toEqual({ waiting: "before the daily time" });
      await c.setNow("2031-01-14T08:00:00+01:00");
      const ran = await c.rpc<{ ran: string; findings: number; remarks: { requested: number } }>("ai_run_jobs");
      expect(ran.ran).toBe("daily");
      expect(ran.remarks.requested).toBe(1);
      expect(await c.rpc("ai_run_jobs")).toEqual({ skipped: "SUCCEEDED" });
      const job = (await c.q<{ status: string; result: { remarks: { requested: number } } }>("select status, result from ai_jobs where idempotency_key = 'daily:2031-01-14'"))[0];
      expect(job.status).toBe("SUCCEEDED");
      await c.setNow("2031-01-15T08:00:00+01:00");
      expect(await c.rpc<{ ran: string }>("ai_run_jobs")).toMatchObject({ ran: "daily" });         // the next day runs
    });
  });

  it("the existing scheduler calls it, and its work is the same through run_scheduled_jobs", async () => {
    await withTx(async (c) => {
      await world(c);
      await c.setNow("2031-01-14T12:00:00+01:00");
      await c.rpc("run_scheduled_jobs");
      expect(await requests(c)).toHaveLength(1);
      expect((await c.q("select 1 from ai_jobs where kind = 'daily'")).length).toBe(1);
    });
  });

  it("a crashed run does not block the day: a job stuck running for over half an hour is taken again", async () => {
    await withTx(async (c) => {
      const a = await c.rpc<{ id: string; run: boolean }>("ai_job_begin", "daily", "daily:stuck", null);
      expect(a.run).toBe(true);
      expect((await c.rpc<{ run: boolean }>("ai_job_begin", "daily", "daily:stuck", null)).run).toBe(false);
      await c.q("update ai_jobs set started_at = clock_timestamp() - interval '31 minutes' where id = $1", [a.id]);
      expect((await c.rpc<{ run: boolean }>("ai_job_begin", "daily", "daily:stuck", null)).run).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { W1, draftGoal, seedStrategy, weekId, withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("AIA"); const buB = await c.bu("AIB");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa"); const admin = await c.user(["ADMIN"], buA, "admin");
  const exec = await c.user(["EXECUTIVE"], buA, "exec");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA"); const leadB = await c.user(["BU_LEAD"], buB, "leadB");
  return { buA, buB, sa, admin, exec, leadA, leadB };
}
const finding = (c: Ctx, bu: string, fp: string) => c.q<{ id: string }>("insert into ai_findings (kind, business_unit_id, severity, summary, fingerprint) values ('TEST', $1, 'LOW', 'a finding', $2) returning id", [bu, fp]).then((r) => r[0].id);

describe("4COREPAL foundation: the module is off and cannot reach beyond its permissions", () => {
  it("ships switched off, and the scheduler hook does nothing while it is", async () => {
    await withTx(async (c) => {
      expect(await c.rpc<boolean>("ai_enabled")).toBe(false);
      expect(await c.rpc<Record<string, unknown>>("ai_run_jobs")).toEqual({ skipped: "disabled" });
      expect(await c.rpc<string | null>("ai_action_mode", "OPEN_CASE")).toBeNull();
    });
  });

  it("only a holder of ai.config.manage (the Super Admin) can change a setting, and the change is audited", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_set_setting", w.admin, "enabled", true));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_set_setting", w.leadA, "enabled", true));
      await c.rpc("ai_set_setting", w.sa, "enabled", true);
      expect(await c.rpc<boolean>("ai_enabled")).toBe(true);
      const audit = await c.q<{ action: string }>("select action from audit_logs where entity_type = 'ai_setting' and entity_id = 'enabled'");
      expect(audit.map((a) => a.action)).toEqual(["AI_SETTING_CHANGED"]);
    });
  });

  it("checks a setting's value against its kind, and refuses an unknown setting or a negative number", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_setting", w.sa, "enabled", '"yes"'));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_setting", w.sa, "remark_deadline_days", -1));
      await c.expectError("NOT_FOUND", () => c.rpc("ai_set_setting", w.sa, "no_such_setting", 1));
      await c.rpc("ai_set_setting", w.sa, "remark_deadline_days", 4);
      expect(await c.rpc<number>("ai_setting", "remark_deadline_days")).toBe(4);
    });
  });

  it("a high-impact action can never be made automatic, by the function or by the table", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const a of ["CHANGE_GOAL", "CHANGE_KR_TARGET", "MODIFY_SCORE", "CHANGE_HISTORY", "REASSIGN_OWNERSHIP", "CANCEL_COMMITMENT", "EMPLOYEE_DECISION"]) {
        await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_policy", w.sa, a, "AUTO"));
        await c.client.query("savepoint chk");
        await expect(c.q("update ai_action_policies set mode = 'AUTO' where action_type = $1", [a])).rejects.toThrow(/high_never_auto/);
        await c.client.query("rollback to savepoint chk");
      }
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_set_policy", w.admin, "OPEN_CASE", "DISABLED"));
      await c.rpc("ai_set_policy", w.sa, "OPEN_CASE", "NEEDS_APPROVAL");
      await c.rpc("ai_set_setting", w.sa, "enabled", true);
      expect(await c.rpc<string>("ai_action_mode", "OPEN_CASE")).toBe("NEEDS_APPROVAL");
      await c.rpc("ai_set_policy", w.sa, "OPEN_CASE", "DISABLED");
      expect(await c.rpc<string | null>("ai_action_mode", "OPEN_CASE")).toBeNull();
    });
  });

  it("every medium and low action starts where the design says, and every high action needs approval", async () => {
    await withTx(async (c) => {
      const rows = await c.q<{ risk: string; mode: string }>("select risk, mode from ai_action_policies");
      expect(rows.filter((r) => r.risk === "HIGH").every((r) => r.mode === "NEEDS_APPROVAL")).toBe(true);
      expect(rows.filter((r) => r.risk === "MEDIUM").every((r) => r.mode === "NEEDS_APPROVAL")).toBe(true);
      expect(rows.filter((r) => r.risk === "LOW").every((r) => r.mode === "AUTO")).toBe(true);
    });
  });

  it("nobody approves their own proposal", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.client.query("savepoint own");
      await expect(c.q("insert into ai_approvals (action_type, subject_type, proposal, requested_by, by_agent, status, decided_by) values ('CHANGE_GOAL', 'goal', '{}', $1, false, 'APPROVED', $1)", [w.sa])).rejects.toThrow();
      await c.client.query("rollback to savepoint own");
      await c.q("insert into ai_approvals (action_type, subject_type, proposal, requested_by, by_agent, status, decided_by) values ('CHANGE_GOAL', 'goal', '{}', $1, false, 'APPROVED', $2)", [w.leadA, w.sa]);
    });
  });
});

describe("4COREPAL foundation: jobs run once per period and fail safely", () => {
  it("a period's job runs once; a rerun of the same period does nothing", async () => {
    await withTx(async (c) => {
      const a = await c.rpc<{ id: string; run: boolean }>("ai_job_begin", "daily", "daily:2031-01-07", null);
      expect(a.run).toBe(true);
      await c.rpc("ai_job_finish", a.id, true, null, { findings: 2 });
      const b = await c.rpc<{ run: boolean; status: string }>("ai_job_begin", "daily", "daily:2031-01-07", null);
      expect(b.run).toBe(false);
      expect(b.status).toBe("SUCCEEDED");
      expect((await c.q("select 1 from ai_jobs where idempotency_key = 'daily:2031-01-07'")).length).toBe(1);
    });
  });

  it("a running job is not started twice, and a failing one is retried then given up on", async () => {
    await withTx(async (c) => {
      const first = await c.rpc<{ id: string; run: boolean }>("ai_job_begin", "weekly", "weekly:2031-W02", null);
      expect(first.run).toBe(true);
      expect((await c.rpc<{ run: boolean }>("ai_job_begin", "weekly", "weekly:2031-W02", null)).run).toBe(false);   // still running
      let id = first.id;
      for (let i = 0; i < 3; i++) {
        await c.rpc("ai_job_finish", id, false, "provider down");
        const next = await c.rpc<{ id: string; run: boolean; status: string }>("ai_job_begin", "weekly", "weekly:2031-W02", null);
        if (!next.run) { expect(next.status).toBe("DEAD"); break; }
        id = next.id;
      }
      expect((await c.q<{ status: string; attempts: number }>("select status, attempts from ai_jobs where idempotency_key = 'weekly:2031-W02'"))[0]).toMatchObject({ status: "DEAD", attempts: 3 });
    });
  });
});

describe("4COREPAL foundation: usage and cost", () => {
  it("records each call, reports the daily total and says when the ceiling is reached", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_set_setting", w.sa, "daily_cost_ceiling_usd", 1);
      const a = await c.rpc<{ ceilingReached: boolean; todayUsd: number }>("ai_record_usage", w.leadA, null, "assistant", "anthropic", "model-x", 1000, 200, 0.4, 900, "OK");
      expect(a.ceilingReached).toBe(false);
      const b = await c.rpc<{ ceilingReached: boolean; todayUsd: number }>("ai_record_usage", w.leadA, null, "assistant", "anthropic", "model-x", 1000, 200, 0.7, 900, "OK");
      expect(b.ceilingReached).toBe(true);
      expect(Number(b.todayUsd)).toBeCloseTo(1.1, 5);
    });
  });

  it("usage records cannot be changed or deleted", async () => {
    await withTx(async (c) => {
      await c.rpc("ai_record_usage", null, null, "assistant", "anthropic", "model-x", 10, 10, 0.01, 100, "OK");
      await c.client.query("savepoint u");
      await expect(c.q("update ai_usage set cost_usd = 0")).rejects.toThrow();
      await c.client.query("rollback to savepoint u");
      await expect(c.q("delete from ai_usage")).rejects.toThrow();
    });
  });
});

describe("4COREPAL foundation: what each person can read", () => {
  it("a BU Lead sees the findings and remarks of their own unit only; an executive sees every unit", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const fa = await finding(c, w.buA, "fp-a"); const fb = await finding(c, w.buB, "fp-b");
      const seenByLeadA = await c.asUser(w.leadA, () => c.q<{ id: string }>("select id from ai_findings"));
      expect(seenByLeadA.map((r) => r.id)).toEqual([fa]);
      const seenByLeadB = await c.asUser(w.leadB, () => c.q<{ id: string }>("select id from ai_findings"));
      expect(seenByLeadB.map((r) => r.id)).toEqual([fb]);
      const seenByExec = await c.asUser(w.exec, () => c.q<{ id: string }>("select id from ai_findings order by fingerprint"));
      expect(seenByExec.map((r) => r.id)).toEqual([fa, fb]);
    });
  });

  it("a person without any ai.insights permission sees nothing, and a client cannot write", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const hr = await c.user(["HR"], w.buA, "hr");
      await finding(c, w.buA, "fp-hr");
      expect(await c.asUser(hr, () => c.q("select id from ai_findings"))).toHaveLength(0);
      await c.client.query("savepoint w");
      await expect(c.asUser(w.sa, () => c.q("insert into ai_findings (kind, severity, summary, fingerprint) values ('X', 'LOW', 's', 'fp-write')"))).rejects.toThrow();
      await c.client.query("rollback to savepoint w");
      await expect(c.asUser(w.sa, () => c.q("update ai_settings set value = 'true'::jsonb where key = 'enabled'"))).rejects.toThrow();
    });
  });

  it("settings, policies and usage are readable only by those who manage or audit the module", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await c.asUser(w.leadA, () => c.q("select key from ai_settings"))).toHaveLength(0);
      expect((await c.asUser(w.sa, () => c.q("select key from ai_settings"))).length).toBeGreaterThan(10);
      expect(await c.asUser(w.leadA, () => c.q("select action_type from ai_action_policies"))).toHaveLength(0);
      expect((await c.asUser(w.admin, () => c.q("select action_type from ai_action_policies"))).length).toBe(19);
    });
  });

  it("a conversation is private to the person who had it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const conv = (await c.q<{ id: string }>("insert into ai_conversations (user_id) values ($1) returning id", [w.leadA]))[0].id;
      await c.q("insert into ai_messages (conversation_id, role, content) values ($1, 'user', 'How are we doing?')", [conv]);
      expect(await c.asUser(w.leadA, () => c.q("select id from ai_messages"))).toHaveLength(1);
      expect(await c.asUser(w.leadB, () => c.q("select id from ai_messages"))).toHaveLength(0);
      expect(await c.asUser(w.sa, () => c.q("select id from ai_messages"))).toHaveLength(0);   // even a Super Admin does not read someone else's conversation
    });
  });

  it("read_ai_status tells the screen whether to show the module, without leaking configuration", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      expect(await c.asUser(w.leadA, () => c.rpc<{ enabled: boolean; canUse: boolean }>("read_ai_status"))).toEqual({ enabled: false, canUse: false });
      await c.rpc("ai_set_setting", w.sa, "enabled", true);
      expect(await c.asUser(w.leadA, () => c.rpc<{ enabled: boolean; canUse: boolean }>("read_ai_status"))).toEqual({ enabled: true, canUse: true });
      const hr = await c.user(["HR"], w.buA, "hr");
      expect(await c.asUser(hr, () => c.rpc<{ enabled: boolean; canUse: boolean }>("read_ai_status"))).toEqual({ enabled: true, canUse: false });
    });
  });
});

describe("4COREPAL foundation: remarks sit beside tasks and never change them", () => {
  it("a remark is saved once per task and request, cannot be edited or deleted, and leaves the task and a final-locked week untouched", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const strat = await seedStrategy(c, w.admin);
      const wk = await weekId(c, W1.monday);
      await c.setNow(W1.open);
      const g = await draftGoal(c, w.leadA, wk, strat.subKrIds[0], ["Ship the pricing sheet", "Review it with sales"], "Publish the pricing sheets by Friday");
      const tasks = await c.q<{ id: string; status: string; updated_at: string }>("select t.id, t.status, t.updated_at from tasks t join smart_goals s on s.id = t.smart_goal_id where s.weekly_report_id = $1 order by t.position", [g.reportId]);
      const req = (await c.q<{ id: string }>("insert into ai_remark_requests (business_unit_id, reporting_week_id, task_count, due_at) values ($1, $2, 2, now() + interval '3 days') returning id", [w.buA, wk]))[0].id;
      await c.q("insert into ai_task_remarks (request_id, task_id, business_unit_id, reason_code, remark, author_user_id) values ($1, $2, $3, 'DEPENDENCY', 'Waiting on the finance team', $4)", [req, tasks[0].id, w.buA, w.leadA]);
      // one remark per task and request
      await c.client.query("savepoint dup");
      await expect(c.q("insert into ai_task_remarks (request_id, task_id, business_unit_id, reason_code, author_user_id) values ($1, $2, $3, 'OTHER', $4)", [req, tasks[0].id, w.buA, w.leadA])).rejects.toThrow();
      await c.client.query("rollback to savepoint dup");
      // append-only
      await c.client.query("savepoint ro");
      await expect(c.q("update ai_task_remarks set remark = 'changed'")).rejects.toThrow();
      await c.client.query("rollback to savepoint ro");
      await c.client.query("savepoint rd");
      await expect(c.q("delete from ai_task_remarks")).rejects.toThrow();
      await c.client.query("rollback to savepoint rd");
      // the task is exactly as it was
      const after = await c.q<{ id: string; status: string; updated_at: string }>("select id, status, updated_at from tasks where id = any($1)", [tasks.map((t) => t.id)]);
      expect(after.map((t) => [t.id, t.status, String(t.updated_at)]).sort()).toEqual(tasks.map((t) => [t.id, t.status, String(t.updated_at)]).sort());
      // the other unit cannot read it
      expect(await c.asUser(w.leadB, () => c.q("select id from ai_task_remarks"))).toHaveLength(0);
      expect(await c.asUser(w.leadA, () => c.q("select id from ai_task_remarks"))).toHaveLength(1);
    });
  });

  it("a unit has one batched remark request per week, however often the job runs", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const strat = await seedStrategy(c, w.admin);
      const wk = await weekId(c, W1.monday);
      await c.q("insert into ai_remark_requests (business_unit_id, reporting_week_id, task_count, due_at) values ($1, $2, 3, now())", [w.buA, wk]);
      await c.client.query("savepoint r");
      await expect(c.q("insert into ai_remark_requests (business_unit_id, reporting_week_id, task_count, due_at) values ($1, $2, 3, now())", [w.buA, wk])).rejects.toThrow();
      await c.client.query("rollback to savepoint r");
      expect(strat.quarterId).toBeTruthy();
    });
  });
});

describe("4COREPAL foundation: findings, cases and communications are never duplicated", () => {
  it("the same observation is one finding, one case and one message however many times it is seen", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await finding(c, w.buA, "same-observation");
      await c.client.query("savepoint f");
      await expect(finding(c, w.buA, "same-observation")).rejects.toThrow();
      await c.client.query("rollback to savepoint f");
      await c.q("insert into ai_cases (title, category, business_unit_id, severity, risk_level, fingerprint) values ('Repeated goal', 'REPEATED_DELAYS', $1, 'MEDIUM', 'MEDIUM', 'case-fp')", [w.buA]);
      await c.client.query("savepoint cs");
      await expect(c.q("insert into ai_cases (title, category, business_unit_id, severity, risk_level, fingerprint) values ('Repeated goal', 'REPEATED_DELAYS', $1, 'MEDIUM', 'MEDIUM', 'case-fp')", [w.buA])).rejects.toThrow();
      await c.client.query("rollback to savepoint cs");
      await c.q("insert into ai_communications (recipient_user_id, channel, kind, subject, body, dedupe_key) values ($1, 'IN_APP', 'REMINDER', 's', 'b', 'k1')", [w.leadA]);
      await c.client.query("savepoint cm");
      await expect(c.q("insert into ai_communications (recipient_user_id, channel, kind, subject, body, dedupe_key) values ($1, 'IN_APP', 'REMINDER', 's', 'b', 'k1')", [w.leadA])).rejects.toThrow();
      await c.client.query("rollback to savepoint cm");
    });
  });

  it("a case gets a reference and its history cannot be rewritten", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = (await c.q<{ id: string; reference: string }>("insert into ai_cases (title, category, business_unit_id, severity, risk_level) values ('A case', 'OTHER', $1, 'LOW', 'LOW') returning id, reference", [w.buA]))[0];
      expect(id.reference).toMatch(/^PIC-\d{4}-\d{6}$/);
      await c.q("insert into ai_case_events (case_id, event_type, by_agent) values ($1, 'CREATED', true)", [id.id]);
      await c.client.query("savepoint e");
      await expect(c.q("update ai_case_events set event_type = 'NOTE'")).rejects.toThrow();
      await c.client.query("rollback to savepoint e");
      await c.client.query("savepoint ed");
      await expect(c.q("delete from ai_case_events")).rejects.toThrow();
      await c.client.query("rollback to savepoint ed");
    });
  });

  it("a BU Lead sees cases of their own unit (as owner or assignee) and not another's", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.q("insert into ai_cases (title, category, business_unit_id, severity, risk_level) values ('A', 'OTHER', $1, 'LOW', 'LOW')", [w.buA]);
      await c.q("insert into ai_cases (title, category, business_unit_id, assigned_bu_id, severity, risk_level) values ('B shared', 'CROSS_BU_DEPENDENCY', $1, $2, 'LOW', 'LOW')", [w.buB, w.buA]);
      await c.q("insert into ai_cases (title, category, business_unit_id, severity, risk_level) values ('B only', 'OTHER', $1, 'LOW', 'LOW')", [w.buB]);
      const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();
      expect(titles(await c.asUser(w.leadA, () => c.q<{ title: string }>("select title from ai_cases")))).toEqual(["A", "B shared"]);
      expect(titles(await c.asUser(w.leadB, () => c.q<{ title: string }>("select title from ai_cases")))).toEqual(["B shared", "B only"].sort());
      expect(titles(await c.asUser(w.exec, () => c.q<{ title: string }>("select title from ai_cases")))).toEqual(["A", "B only", "B shared"]);
    });
  });
});

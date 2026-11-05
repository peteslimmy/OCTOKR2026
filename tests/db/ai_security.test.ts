import { describe, expect, it } from "vitest";
import { aiWorld } from "./ai-world";
import { withTx } from "./helpers";

/**
 * Security of the whole 4COREPAL schema, tested as an attacker with a valid sign-in would try it (docs/38, sections 17 and 22): no client can write any ai_ table or
 * call any function that changes state; no unit can read another unit's records; nothing at all is open to an anonymous caller.
 */
describe("no client can write, and anonymous callers can read nothing", () => {
  it("every ai_ table has row-level security on and gives signed-in users read access only", async () => {
    await withTx(async (c) => {
      const tables = (await c.q<{ tablename: string; rowsecurity: boolean }>("select c.relname tablename, c.relrowsecurity rowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ai\\_%'"));
      expect(tables.length).toBeGreaterThanOrEqual(20);
      expect(tables.filter((t) => !t.rowsecurity).map((t) => t.tablename)).toEqual([]);
      const grants = await c.q<{ table_name: string; grantee: string; privilege_type: string }>("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'ai\\_%' and grantee in ('anon', 'authenticated')");
      expect(grants.filter((g) => g.grantee === "anon")).toEqual([]);
      expect(grants.filter((g) => g.grantee === "authenticated" && g.privilege_type !== "SELECT")).toEqual([]);
    });
  });

  it("an anonymous caller cannot read any ai_ table", async () => {
    await withTx(async (c) => {
      const tables = (await c.q<{ t: string }>("select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ai\\_%'")).map((r) => r.t);
      for (const t of tables) {
        await c.client.query("savepoint s"); await c.client.query("set local role anon");
        await expect(c.q(`select 1 from ${t} limit 1`), t).rejects.toThrow(/permission denied/);
        await c.client.query("rollback to savepoint s");
      }
    });
  });

  it("a signed-in user cannot call any function that changes state: only the read_ functions are open to them", async () => {
    await withTx(async (c) => {
      const fns = await c.q<{ proname: string; auth: boolean; anon: boolean }>("select p.proname, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'ai\\_%' or p.proname like 'read\\_ai%')");
      expect(fns.length).toBeGreaterThan(35);
      expect(fns.filter((f) => f.anon).map((f) => f.proname)).toEqual([]);
      expect(fns.filter((f) => f.auth && !f.proname.startsWith("read_ai")).map((f) => f.proname)).toEqual([]);
      expect(fns.filter((f) => f.proname.startsWith("read_ai")).every((f) => f.auth)).toBe(true);
    });
  });

  it("calling a state-changing function as a signed-in user is refused outright, whatever the arguments", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      for (const [fn, args] of [["ai_set_setting", [w.sa, "enabled", false]], ["ai_set_policy", [w.sa, "OPEN_CASE", "DISABLED"]], ["ai_decide_approval", [w.sa, "00000000-0000-4000-8000-000000000000", true, null]],
        ["ai_submit_remarks", [w.leadA, "00000000-0000-4000-8000-000000000000", "[]"]], ["ai_case_update", [w.sa, "00000000-0000-4000-8000-000000000000", "CLOSED", null]], ["ai_record_usage", [w.leadA, null, "x", "p", "m", 0, 0, 0, null, "OK"]]] as const) {
        await expect(c.asUser(w.sa, () => c.rpc(fn, ...args)), fn).rejects.toThrow(/permission denied for function/);
      }
    });
  });
});

describe("no unit can read another unit's records", () => {
  it("every table that holds a unit's records is empty for a unit with none of its own and for people without the permission, and not empty for the unit itself", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      await c.setNow("2031-01-31T09:00:00+01:00");
      await c.rpc("ai_run_jobs");
      const remarkReq = (await c.q<{ id: string }>("select id from ai_remark_requests where business_unit_id = $1 and reporting_week_id = $2", [w.buA, w.weeks[2]]))[0].id;
      const t = (await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2) limit 1", [w.buA, w.weeks[2]]))[0].task_id;
      await c.rpc("ai_submit_remarks", w.leadA, remarkReq, [{ taskId: t, reasonCode: "RESOURCES", remark: "SECRET REMARK OF ALPHA" }]);
      const closure = (await c.q<{ id: string }>("select id from ai_closure_requests"))[0].id;
      const g = (await c.q<{ subject_goal_id: string }>("select subject_goal_id from ai_closure_items where request_id = $1 limit 1", [closure]))[0].subject_goal_id;
      await c.rpc("ai_submit_dispositions", w.leadA, closure, [{ goalId: g, option: "NO_LONGER_REQUIRED", explanation: "SECRET DISPOSITION OF ALPHA" }]);
      const hot = await c.rpc<string>("ai_open_case", "sec-case", "SECRET CASE OF ALPHA", "UNDERPERFORMING_BU", "d", w.buA, "HIGH", "a", "[]", "r", [{ kind: "OTHER", summary: "SECRET EVIDENCE" }], null, null, null, null);
      await c.rpc("ai_engagement_tick"); await c.rpc("ai_draft_corrective_plan", hot);
      await c.q("insert into ai_findings (kind, business_unit_id, severity, summary, fingerprint) values ('X', $1, 'LOW', 'SECRET FINDING', 'sec-finding')", [w.buA]);
      const tables = ["ai_findings", "ai_cases", "ai_case_evidence", "ai_case_events", "ai_remark_requests", "ai_task_remarks", "ai_closure_requests", "ai_closure_items", "ai_dispositions", "ai_corrective_plans", "ai_communications"];
      const hr = await c.user(["HR"], w.buA, "hr");
      for (const tbl of tables) {
        expect((await c.asUser(w.leadA, () => c.q(`select 1 from ${tbl}`))).length, `${tbl} visible to the unit itself`).toBeGreaterThan(0);
        expect(await c.asUser(w.leadB, () => c.q(`select 1 from ${tbl}`)), `${tbl} visible to another unit's lead`).toHaveLength(0);
        expect(await c.asUser(hr, () => c.q(`select 1 from ${tbl}`)), `${tbl} visible to a person without any ai permission`).toHaveLength(0);
      }
      for (const fn of ["read_ai_executive_counts", "read_ai_communications", "read_ai_activity"]) {
        const b = JSON.stringify(await c.asUser(w.leadB, () => c.rpc(fn)));
        expect(b, fn).not.toMatch(/SECRET/);
      }
      expect(JSON.stringify(await c.asUser(w.leadB, () => c.rpc("read_ai_remark_request", remarkReq)))).toBe("null");
      expect(JSON.stringify(await c.asUser(w.leadB, () => c.rpc("read_ai_closure_request", closure)))).toBe("null");
    });
  });

  it("a unit lead cannot answer for, respond to or act on another unit's requests, cases or actions", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      await c.setNow("2031-01-31T09:00:00+01:00");
      await c.rpc("ai_run_jobs");
      const remarkReq = (await c.q<{ id: string }>("select id from ai_remark_requests where business_unit_id = $1 and reporting_week_id = $2", [w.buA, w.weeks[2]]))[0].id;
      const t = (await c.q<{ task_id: string }>("select task_id from ai_unresolved_tasks($1, $2) limit 1", [w.buA, w.weeks[2]]))[0].task_id;
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_submit_remarks", w.leadB, remarkReq, [{ taskId: t, reasonCode: "OTHER", remark: "not mine" }]));
      const closure = (await c.q<{ id: string }>("select id from ai_closure_requests"))[0].id;
      const g = (await c.q<{ subject_goal_id: string }>("select subject_goal_id from ai_closure_items where request_id = $1 limit 1", [closure]))[0].subject_goal_id;
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_submit_dispositions", w.leadB, closure, [{ goalId: g, option: "IN_PROGRESS" }]));
      const hot = await c.rpc<string>("ai_open_case", null, "Case", "OTHER", "d", w.buA, "HIGH", "a", "[]", "r", "[]", null, null, null, null);
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_respond_case", w.leadB, hot, "I will answer for Alpha"));
      const plan = await c.rpc<string>("ai_draft_corrective_plan", hot);
      const act = await c.rpc<string>("ai_add_corrective_action", w.admin, plan, "Do the thing", w.buA, null);
      await c.rpc("ai_decide_approval", w.sa, await c.rpc<string>("ai_submit_plan", w.admin, plan), true, null);
      await c.expectError("BU_SCOPE_DENIED", () => c.rpc("ai_set_action_status", w.leadB, act, "DONE", null));
    });
  });

  it("conversations are private to their owner, even from a Super Admin and an executive", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      const conv = await c.rpc<string>("ai_start_conversation", w.leadA, null);
      await c.rpc("ai_add_message", w.leadA, conv, "user", "SECRET CONVERSATION");
      for (const who of [w.sa, w.exec, w.admin, w.leadB]) {
        expect(await c.asUser(who, () => c.q("select 1 from ai_messages"))).toHaveLength(0);
        expect(await c.asUser(who, () => c.q("select 1 from ai_conversations"))).toHaveLength(0);
      }
    });
  });
});

describe("approval workflows cannot be abused", () => {
  it("nobody decides their own proposal; nobody without the permission decides anything; a decided proposal cannot be decided again", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      const hot = await c.rpc<string>("ai_open_case", null, "Case", "OTHER", "d", w.buA, "HIGH", "a", "[]", "r", "[]", null, null, null, null);
      const plan = await c.rpc<string>("ai_draft_corrective_plan", hot);
      await c.rpc("ai_add_corrective_action", w.sa, plan, "Do the thing", w.buA, null);
      const appr = await c.rpc<string>("ai_submit_plan", w.sa, plan);
      await c.expectError("SEPARATION_OF_DUTIES", () => c.rpc("ai_decide_approval", w.sa, appr, true, null));
      for (const who of [w.admin, w.exec, w.leadA, w.leadB]) await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_decide_approval", who, appr, true, null));
      await c.rpc("ai_decide_approval", w.sa2, appr, true, null);
      await c.expectError("INVALID_STATE_TRANSITION", () => c.rpc("ai_decide_approval", w.sa2, appr, false, "changed my mind"));
    });
  });

  it("high-impact actions cannot be made automatic by any route, and the agent's own action list holds no high-impact action that can run", async () => {
    await withTx(async (c) => {
      const w = await aiWorld(c);
      for (const a of (await c.q<{ action_type: string }>("select action_type from ai_action_policies where risk = 'HIGH'")).map((r) => r.action_type)) {
        await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_policy", w.sa, a, "AUTO"));
        expect(await c.rpc("ai_action_mode", a)).toBe("NEEDS_APPROVAL");
      }
      // no ai_ function mentions an official goal, target, score or role as something it writes
      const fns = await c.q<{ proname: string; def: string }>("select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ai\\_%'");
      const writes = (re: RegExp) => fns.filter((f) => re.test(f.def)).map((f) => f.proname);
      expect(writes(/(insert\s+into|update|delete\s+from)\s+(smart_goals|tasks|weekly_reports|weekly_score_snapshots|quarterly_score_snapshots|key_results|sub_key_results|objectives|bu_goals|reporting_weeks|quarters)\b/i)).toEqual([]);
    });
  });
});

import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const buA = await c.bu("ALPHA");
  const sa = await c.user(["SUPER_ADMIN"], buA, "sa"), admin = await c.user(["ADMIN"], buA, "admin"), exec = await c.user(["EXECUTIVE"], buA, "exec");
  const leadA = await c.user(["BU_LEAD"], buA, "leadA");
  await c.rpc("ai_set_setting", sa, "enabled", true);
  return { buA, sa, admin, exec, leadA };
}
const steps = (c: Ctx, sev: string) => c.q<{ step: number; audience: string; after_hours: number }>("select step, audience, after_hours from ai_escalation_policies where severity = $1 order by step", [sev]);

describe("the escalation policy", () => {
  it("only someone with ai.escalation.manage can change it; the change is audited with what it was and what it became", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_set_escalation", w.admin, "MEDIUM", 2, "EXECUTIVES", 48));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_set_escalation", w.leadA, "MEDIUM", 2, "EXECUTIVES", 48));
      await c.rpc("ai_set_escalation", w.sa, "MEDIUM", 2, "EXECUTIVES", 48);
      expect((await steps(c, "MEDIUM")).find((s) => s.step === 2)).toMatchObject({ audience: "EXECUTIVES", after_hours: 48 });
      const a = await c.q<{ old_values: { after_hours: number }; new_values: { after_hours: number } }>("select old_values, new_values from audit_logs where action = 'AI_ESCALATION_POLICY_CHANGED'");
      expect(a).toHaveLength(1);
      expect(a[0].old_values.after_hours).toBe(96);
      expect(a[0].new_values.after_hours).toBe(48);
    });
  });

  it("checks what it is given", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      for (const bad of [["NOPE", 2, "EXECUTIVES", 48], ["MEDIUM", 0, "EXECUTIVES", 48], ["MEDIUM", 6, "EXECUTIVES", 48], ["MEDIUM", 2, "EVERYONE", 48], ["MEDIUM", 2, "EXECUTIVES", -1], ["MEDIUM", 2, "EXECUTIVES", 721]] as const)
        await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_escalation", w.sa, ...bad));
    });
  });

  it("every severity must keep a step that reaches the executives, however it is edited", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_set_escalation", w.sa, "CRITICAL", 2, "BU_LEAD", 0));        // would leave critical with no executive step
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_delete_escalation", w.sa, "HIGH", 2));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_delete_escalation", w.sa, "LOW", 1).then(() => c.rpc("ai_delete_escalation", w.sa, "LOW", 2)));
      expect(await steps(c, "CRITICAL")).toHaveLength(2);
      expect(await steps(c, "HIGH")).toHaveLength(2);
      await c.rpc("ai_set_escalation", w.sa, "HIGH", 3, "EXECUTIVES", 120);                                                    // adding a further step is fine
      await c.rpc("ai_delete_escalation", w.sa, "HIGH", 2);                                                                   // and now step 2 is not the only executive step
      expect((await steps(c, "HIGH")).map((s) => s.step)).toEqual([1, 3]);
      await c.expectError("NOT_FOUND", () => c.rpc("ai_delete_escalation", w.sa, "HIGH", 2));
    });
  });

  it("the engagement run follows the edited policy", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.setNow("2031-01-10T09:00:00+01:00");
      const id = await c.rpc<string>("ai_open_case", null, "A case", "OTHER", "d", w.buA, "MEDIUM", "a", "[]", "r", "[]", null, null, null, null);
      await c.rpc("ai_set_escalation", w.sa, "MEDIUM", 2, "EXECUTIVES", 24);
      await c.rpc("ai_engagement_tick");
      await c.setNow("2031-01-11T12:00:00+01:00");                                       // 27 hours later: past the new 24, short of the old 96
      expect(await c.rpc("ai_engagement_tick")).toMatchObject({ escalated: 1 });
      expect((await c.q<{ status: string }>("select status from ai_cases where id = $1", [id]))[0].status).toBe("ESCALATED");
    });
  });
});

describe("retention", () => {
  it("deletes conversation messages older than the retention, with their empty conversations, and keeps newer ones", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_set_setting", w.sa, "retention_days_messages", 30);
      await c.setNow("2031-01-01T09:00:00+01:00");
      const old = await c.rpc<string>("ai_start_conversation", w.leadA, "Old one");
      await c.rpc("ai_add_message", w.leadA, old, "user", "an old question");
      await c.setNow("2031-03-01T09:00:00+01:00");
      const fresh = await c.rpc<string>("ai_start_conversation", w.leadA, "Fresh one");
      await c.rpc("ai_add_message", w.leadA, fresh, "user", "a new question");
      expect(await c.rpc("ai_purge")).toMatchObject({ messages: 1, conversations: 1 });
      expect((await c.q<{ title: string }>("select title from ai_conversations")).map((r) => r.title)).toEqual(["Fresh one"]);
      expect(await c.q("select 1 from ai_messages")).toHaveLength(1);
      const a = await c.q<{ new_values: { messages: number } }>("select new_values from audit_logs where action = 'AI_PURGED'");
      expect(a[0].new_values.messages).toBe(1);
      expect(await c.rpc("ai_purge")).toMatchObject({ messages: 0, conversations: 0 });
      expect(await c.q("select 1 from audit_logs where action = 'AI_PURGED'")).toHaveLength(1);        // nothing deleted, nothing logged
    });
  });

  it("a message can be deleted only by the purge: not directly, and not changed at all", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const conv = await c.rpc<string>("ai_start_conversation", w.leadA, null);
      await c.rpc("ai_add_message", w.leadA, conv, "user", "hello");
      await c.client.query("savepoint d");
      await expect(c.q("delete from ai_messages")).rejects.toThrow(/IMMUTABLE_RECORD/);
      await c.client.query("rollback to savepoint d");
      await expect(c.q("update ai_messages set content = 'x'")).rejects.toThrow(/IMMUTABLE_RECORD/);
    });
  });

  it("keeps cases, remarks, decisions, usage and the audit log: only messages, their empty conversations and old job records are purged", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_set_setting", w.sa, "retention_days_messages", 1);
      await c.rpc("ai_open_case", null, "A case", "OTHER", "d", w.buA, "LOW", "a", "[]", "r", "[]", null, null, null, null);
      await c.rpc("ai_record_usage", w.leadA, null, "assistant", "p", "m", 1, 1, 0.01, 10, "OK");
      await c.q("insert into ai_jobs (kind, idempotency_key, status, finished_at) values ('daily', 'old-job', 'SUCCEEDED', app_now() - interval '100 days')");
      await c.q("insert into ai_jobs (kind, idempotency_key, status, finished_at) values ('daily', 'recent-job', 'SUCCEEDED', app_now() - interval '2 days')");
      await c.setNow("2032-01-01T09:00:00+01:00");
      await c.rpc("ai_purge");
      expect(await c.q("select 1 from ai_cases")).toHaveLength(1);
      expect(await c.q("select 1 from ai_case_events")).toHaveLength(1);
      expect(await c.q("select 1 from ai_usage")).toHaveLength(1);
      expect((await c.q<{ idempotency_key: string }>("select idempotency_key from ai_jobs order by idempotency_key")).map((r) => r.idempotency_key)).not.toContain("old-job");
    });
  });

  it("is part of the daily run", async () => {
    await withTx(async (c) => {
      await world(c);
      await c.setNow("2031-01-14T08:00:00+01:00");
      expect(await c.rpc<{ purged: { messages: number } }>("ai_run_jobs")).toHaveProperty("purged");
    });
  });
});

describe("usage and activity", () => {
  it("the usage summary adds up calls, cost and problems, and only auditors and managers see it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_record_usage", w.leadA, null, "assistant", "p", "m", 100, 50, 0.25, 800, "OK");
      await c.rpc("ai_record_usage", w.leadA, null, "report_commentary", "p", "m", 200, 80, 0.5, 1200, "OK");
      await c.rpc("ai_record_usage", w.leadA, null, "assistant", "p", "m", 0, 0, 0, null, "TIMEOUT");
      await c.rpc("ai_record_usage", w.leadA, null, "assistant", "p", "m", 0, 0, 0, null, "BLOCKED");
      type S = { today: { calls: number; costUsd: number }; last7: { errors: number; blocked: number }; byPurpose: { purpose: string; calls: number }[] };
      const s = await c.asUser(w.admin, () => c.rpc<S>("read_ai_usage_summary"));
      expect(s.today.calls).toBe(4);
      expect(Number(s.today.costUsd)).toBeCloseTo(0.75, 6);
      expect(s.last7).toMatchObject({ errors: 1, blocked: 1 });
      expect(s.byPurpose.find((p) => p.purpose === "assistant")?.calls).toBe(3);
      const lead = await c.asUser(w.leadA, () => c.rpc<S>("read_ai_usage_summary"));
      expect(lead.today.calls).toBe(4);                                                  // a person sees their own usage rows (the policy allows own rows)
      const hr = await c.user(["HR"], w.buA, "hr");
      expect((await c.asUser(hr, () => c.rpc<S>("read_ai_usage_summary"))).today.calls).toBe(0);
    });
  });

  it("the activity list is for auditors, names who did what, shows configuration changes from and to, and never holds a question or an answer", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.rpc("ai_set_setting", w.sa, "remark_deadline_days", 7);
      const conv = await c.rpc<string>("ai_start_conversation", w.leadA, null);
      await c.rpc("ai_add_message", w.leadA, conv, "user", "SECRET QUESTION");
      await c.rpc("ai_add_message", w.leadA, conv, "assistant", "SECRET ANSWER", [{ tool: "get_bu_performance" }], "[]", "m");
      type A = { action: string; actor: string; detail: { from: { value: number }; to: { value: number } } | null }[];
      const rows = await c.asUser(w.admin, () => c.rpc<A>("read_ai_activity", 50));
      const change = rows.find((r) => r.action === "AI_SETTING_CHANGED" && r.detail?.to.value === 7);
      expect(change?.detail).toEqual({ from: { value: 3 }, to: { value: 7 } });
      expect(change?.actor).toMatch(/sa/i);
      expect(rows.some((r) => r.action === "AI_ANSWER")).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
      expect(await c.asUser(w.leadA, () => c.rpc<A>("read_ai_activity", 50))).toEqual([]);
      expect(await c.asUser(w.exec, () => c.rpc<A>("read_ai_activity", 50))).toEqual([]);
    });
  });
});

describe("the agent cannot change its own rules or anyone's access", () => {
  it("only the person-run setting, policy and escalation functions write them, and no agent function touches roles or permissions", async () => {
    await withTx(async (c) => {
      const fns = await c.q<{ proname: string; def: string }>("select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ai\\_%'");
      expect(fns.length).toBeGreaterThan(30);
      const writes = (re: RegExp) => fns.filter((f) => re.test(f.def)).map((f) => f.proname).sort();
      expect(writes(/update\s+ai_settings/i)).toEqual(["ai_set_setting"]);
      expect(writes(/update\s+ai_action_policies/i)).toEqual(["ai_set_policy"]);
      expect(writes(/(insert\s+into|update|delete\s+from)\s+ai_escalation_policies/i)).toEqual(["ai_delete_escalation", "ai_set_escalation"]);
      expect(writes(/(insert\s+into|update|delete\s+from)\s+(role_permissions|user_roles|user_permission_grants|permissions|roles)\b/i)).toEqual([]);
      for (const f of fns.filter((x) => ["ai_set_setting", "ai_set_policy", "ai_set_escalation", "ai_delete_escalation"].includes(x.proname))) expect(f.def, f.proname).toMatch(/require_permission\(p_actor/);
    });
  });
});

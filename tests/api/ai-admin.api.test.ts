/**
 * 4COREPAL administration over HTTP (phase 7): only people holding the matching permission can change a setting, a policy or the escalation steps; a high-impact
 * action cannot be made automatic; executives must stay reachable; every change is audited with old and new values; the pages open for those who manage the module.
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs ai-admin
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Session, loginAs } from "./session";

const db = new pg.Client({ connectionString: process.env.DB_URL });
beforeAll(async () => { await db.connect(); });
afterAll(async () => {
  await db.query("update ai_settings set value = 'false'::jsonb where key = 'enabled'");
  await db.query("update ai_settings set value = '3'::jsonb where key = 'remark_deadline_days'");
  await db.end();
});
const post = (s: Session, path: string, body: unknown) => s.request("POST", `/api/v1/ai/admin/${path}`, body);

describe("who can administer 4COREPAL", () => {
  it("an anonymous caller gets 401 on every administration route", async () => {
    const anon = new Session();
    for (const [m, p, b] of [["POST", "settings", { key: "enabled", value: true }], ["POST", "policies", { action: "OPEN_CASE", mode: "DISABLED" }], ["POST", "escalation", { severity: "LOW", step: 1, audience: "BU_LEAD", afterHours: 0 }], ["DELETE", "escalation", { severity: "LOW", step: 1 }]] as const)
      expect((await anon.request(m, `/api/v1/ai/admin/${p}`, b)).status, `${m} ${p}`).toBe(401);
  });

  it("an Admin, an executive and a unit lead are refused every change", async () => {
    for (const email of ["admin@4core.local", "exec@4core.local", "lead.eng@4core.local"]) {
      const s = await loginAs(email);
      expect((await post(s, "settings", { key: "remark_deadline_days", value: 9 })).json.error?.code, email).toBe("PERMISSION_DENIED");
      expect((await post(s, "policies", { action: "OPEN_CASE", mode: "DISABLED" })).json.error?.code, email).toBe("PERMISSION_DENIED");
      expect((await post(s, "escalation", { severity: "LOW", step: 2, audience: "EXECUTIVES", afterHours: 100 })).json.error?.code, email).toBe("PERMISSION_DENIED");
    }
    expect((await db.query("select value from ai_settings where key = 'remark_deadline_days'")).rows[0].value).toBe(3);
  });

  it("the pages are for those who manage or audit the module", async () => {
    expect((await (await loginAs("exec@4core.local")).request("GET", "/ai/admin")).text).toContain("Administration is for the people who manage 4COREPAL");
    const sa = await loginAs("superadmin@4core.local");
    for (const p of ["/ai/admin", "/ai/admin/policies", "/ai/admin/usage"]) { const r = await sa.request("GET", p); expect(r.status, p).toBe(200); expect(r.text, p).toMatch(/4COREPAL administration|What 4COREPAL may do|Usage and activity/); }
    expect((await (await loginAs("admin@4core.local")).request("GET", "/ai/admin/usage")).status).toBe(200);          // auditors may see usage, not change anything
  });
});

describe("what a Super Admin can and cannot set", () => {
  it("changes a setting, which is audited with the old and new value, and refuses bad ones", async () => {
    const sa = await loginAs("superadmin@4core.local");
    const r = await post(sa, "settings", { key: "remark_deadline_days", value: 4 });
    expect(r.status).toBe(200);
    expect((await db.query("select value from ai_settings where key = 'remark_deadline_days'")).rows[0].value).toBe(4);
    const a = (await db.query("select old_values, new_values from audit_logs where action = 'AI_SETTING_CHANGED' and entity_id = 'remark_deadline_days' order by seq desc limit 1")).rows[0];
    expect(a).toEqual({ old_values: { value: 3 }, new_values: { value: 4 } });
    expect((await post(sa, "settings", { key: "remark_deadline_days", value: "soon" })).status).toBe(422);
    expect((await post(sa, "settings", { key: "remark_deadline_days", value: -2 })).status).toBe(422);
    expect((await post(sa, "settings", { key: "no_such_setting", value: 1 })).status).toBe(404);
    expect((await post(sa, "settings", { key: "remark_deadline_days", value: 4, extra: true })).status).toBe(422);
  });

  it("switches the module on and off, and a high-impact action can never be made automatic", async () => {
    const sa = await loginAs("superadmin@4core.local");
    expect((await post(sa, "settings", { key: "enabled", value: true })).status).toBe(200);
    expect((await db.query("select value from ai_settings where key = 'enabled'")).rows[0].value).toBe(true);
    expect((await post(sa, "settings", { key: "enabled", value: false })).status).toBe(200);
    expect((await post(sa, "policies", { action: "CHANGE_GOAL", mode: "AUTO" })).status).toBe(422);
    expect((await db.query("select mode from ai_action_policies where action_type = 'CHANGE_GOAL'")).rows[0].mode).toBe("NEEDS_APPROVAL");
    expect((await post(sa, "policies", { action: "CHANGE_GOAL", mode: "DISABLED" })).status).toBe(200);
    expect((await post(sa, "policies", { action: "CHANGE_GOAL", mode: "NEEDS_APPROVAL" })).status).toBe(200);
  });

  it("an escalation step can be edited, but no severity may be left without a step that reaches the executives", async () => {
    const sa = await loginAs("superadmin@4core.local");
    expect((await post(sa, "escalation", { severity: "MEDIUM", step: 2, audience: "EXECUTIVES", afterHours: 120 })).status).toBe(200);
    expect((await post(sa, "escalation", { severity: "MEDIUM", step: 2, audience: "BU_LEAD", afterHours: 96 })).status).toBe(422);
    expect((await sa.request("DELETE", "/api/v1/ai/admin/escalation", { severity: "CRITICAL", step: 2 })).status).toBe(422);
    expect((await post(sa, "escalation", { severity: "MEDIUM", step: 2, audience: "EXECUTIVES", afterHours: 96 })).status).toBe(200);      // put back
    expect((await db.query("select after_hours from ai_escalation_policies where severity = 'MEDIUM' and step = 2")).rows[0].after_hours).toBe(96);
  });
});
